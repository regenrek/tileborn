import path from 'node:path';

import { BuildId } from '@tileborne/core';
import { HomeService, JobId, JobService } from '@tileborne/services-foundation';
import { Context, Effect, Layer, Option, PubSub, Stream } from 'effect';

import { BuildService } from '../build/index.js';
import {
  DeploymentId,
  DeploymentNotFoundError,
  BuildNotFoundError,
  IntegrityMismatchError,
  RuntimeDeployAuthError,
  RuntimeDeployCredentials,
  RuntimeDeployOperation,
  RuntimeDeployOperationError,
  RuntimeDeployOptions,
  RuntimeDeployTarget,
  RuntimeDeployment,
  RuntimeDeploymentTargetSummary,
  ServicesBuildError,
  emptyContentHash,
  makeDeploymentId,
} from '../model.js';
import {
  type AlchemyCloudflareExecutor,
  type LocalRuntimeDeploymentRunner,
  createRuntimeDeploymentAdapters,
  defaultRuntimeDeployAdapterId,
  type RuntimeDeploymentOperationResult,
  runtimeDeployTargetSummary,
} from './adapters.js';
import {
  deleteDirectory,
  ensureDirectory,
  listVerifiedJson,
  metadataFileName,
  readVerifiedJson,
  verifiedChildPath,
  writeVerifiedJson,
} from '../internal/persistence.js';

export class RuntimeDeployService extends Context.Service<
  RuntimeDeployService,
  {
    readonly plan: (
      buildId: BuildId,
      target: RuntimeDeployTarget,
    ) => Effect.Effect<
      RuntimeDeploymentOperationResult,
      | BuildNotFoundError
      | IntegrityMismatchError
      | RuntimeDeployAuthError
      | RuntimeDeployOperationError
      | ServicesBuildError
    >;
    readonly preview: (
      buildId: BuildId,
      target: RuntimeDeployTarget,
    ) => Effect.Effect<
      RuntimeDeploymentOperationResult,
      | BuildNotFoundError
      | IntegrityMismatchError
      | RuntimeDeployAuthError
      | RuntimeDeployOperationError
      | ServicesBuildError
    >;
    readonly deploy: (
      buildId: BuildId,
      target: RuntimeDeployTarget,
      options?: RuntimeDeployOptions,
    ) => Effect.Effect<JobId>;
    readonly status: (
      deploymentId: DeploymentId,
    ) => Effect.Effect<
      RuntimeDeploymentOperationResult,
      | BuildNotFoundError
      | RuntimeDeployAuthError
      | RuntimeDeployOperationError
      | ServicesBuildError
      | DeploymentNotFoundError
      | IntegrityMismatchError
    >;
    readonly logs: (
      deploymentId: DeploymentId,
    ) => Effect.Effect<
      RuntimeDeploymentOperationResult,
      | BuildNotFoundError
      | RuntimeDeployAuthError
      | RuntimeDeployOperationError
      | ServicesBuildError
      | DeploymentNotFoundError
      | IntegrityMismatchError
    >;
    readonly destroy: (
      deploymentId: DeploymentId,
    ) => Effect.Effect<
      void,
      | BuildNotFoundError
      | RuntimeDeployAuthError
      | RuntimeDeployOperationError
      | ServicesBuildError
      | DeploymentNotFoundError
      | IntegrityMismatchError
    >;
    readonly getDeployment: (
      deploymentId: DeploymentId,
    ) => Effect.Effect<
      RuntimeDeployment,
      ServicesBuildError | DeploymentNotFoundError | IntegrityMismatchError
    >;
    readonly listDeployments: (
      buildId: BuildId,
    ) => Effect.Effect<readonly RuntimeDeployment[], ServicesBuildError | IntegrityMismatchError>;
    readonly deleteDeployment: (
      deploymentId: DeploymentId,
    ) => Effect.Effect<void, ServicesBuildError>;
    readonly subscribe: Stream.Stream<void>;
  }
>()('@tileborne/services-build/RuntimeDeployService') {}

const deployRoot = (cachePath: string): string => path.join(cachePath, 'deployments');

export type RuntimeDeployCredentialResolver = (
  target: RuntimeDeploymentTargetSummary,
) => Option.Option<RuntimeDeployCredentials>;

export interface RuntimeDeployServiceRuntimeOptions {
  readonly alchemyExecutor?: AlchemyCloudflareExecutor;
  readonly localRunner?: LocalRuntimeDeploymentRunner;
  readonly credentialResolver?: RuntimeDeployCredentialResolver;
}

const envCredentialResolver: RuntimeDeployCredentialResolver = () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const profile = process.env.ALCHEMY_PROFILE ?? process.env.CLOUDFLARE_PROFILE;
  if (accountId && apiToken) {
    return Option.some(new RuntimeDeployCredentials({ accountId, apiToken }));
  }
  if (profile) {
    return Option.some(
      new RuntimeDeployCredentials({
        accountId: `alchemy-profile:${profile}`,
        apiToken: '',
        profile,
      }),
    );
  }
  return Option.none();
};

export const makeRuntimeDeployServiceLive = (
  runtimeOptions: RuntimeDeployServiceRuntimeOptions = {},
) =>
  Layer.effect(
    RuntimeDeployService,
    Effect.gen(function* () {
      const home = yield* HomeService;
      const jobs = yield* JobService;
      const builds = yield* BuildService;
      const events = yield* PubSub.unbounded<void>();
      const root = deployRoot(home.paths.cache);
      const adapters = createRuntimeDeploymentAdapters(
        runtimeOptions.alchemyExecutor,
        runtimeOptions.localRunner,
      );
      const credentialResolver = runtimeOptions.credentialResolver ?? envCredentialResolver;
      yield* ensureDirectory(root);

      const getDeployment = Effect.fn('RuntimeDeployService.getDeployment')(function* (
        deploymentId: DeploymentId,
      ) {
        const filePath = yield* verifiedChildPath(root, deploymentId, metadataFileName);
        return yield* readVerifiedJson(filePath, RuntimeDeployment).pipe(
          Effect.mapError((error) =>
            error._tag === 'ServicesBuildError'
              ? new DeploymentNotFoundError({
                  deploymentId,
                  message: `deployment not found: ${deploymentId}`,
                })
              : error,
          ),
        );
      });

      const resolveTarget = (target: RuntimeDeployTarget): RuntimeDeployTarget => {
        if (Option.isSome(target.credentials)) return target;
        const summary = runtimeDeployTargetSummary(target);
        if (summary.adapterId === 'local') return target;
        return new RuntimeDeployTarget({
          adapterId: Option.some(summary.adapterId),
          stage: summary.stage,
          workerName: summary.workerName,
          credentials: credentialResolver(summary),
        });
      };

      const deploymentTarget = (deployment: RuntimeDeployment): RuntimeDeployTarget =>
        new RuntimeDeployTarget({
          adapterId: Option.some(deployment.target.adapterId),
          stage: deployment.target.stage,
          workerName: deployment.target.workerName,
          credentials:
            deployment.target.adapterId === 'local'
              ? Option.none()
              : credentialResolver(deployment.target),
        });

      const runBuildOperation = Effect.fn('RuntimeDeployService.runBuildOperation')(function* (
        operation: RuntimeDeployOperation,
        buildId: BuildId,
        target: RuntimeDeployTarget,
      ) {
        const build = yield* builds.getBuild(buildId);
        const resolvedTarget = resolveTarget(target);
        const adapterId = defaultRuntimeDeployAdapterId(resolvedTarget);
        const adapter = adapters.find((candidate) => candidate.id === adapterId);
        if (adapter === undefined) {
          return yield* new RuntimeDeployAuthError({
            buildId,
            message: `runtime deployment adapter not registered: ${adapterId}`,
          });
        }
        return yield* adapter[operation]({
          buildId,
          artifactDirectory: build.directory,
          target: resolvedTarget,
        });
      });

      const plan = Effect.fn('RuntimeDeployService.plan')(function* (
        buildId: BuildId,
        target: RuntimeDeployTarget,
      ) {
        return yield* runBuildOperation('plan', buildId, target);
      });

      const preview = Effect.fn('RuntimeDeployService.preview')(function* (
        buildId: BuildId,
        target: RuntimeDeployTarget,
      ) {
        return yield* runBuildOperation('preview', buildId, target);
      });

      const writeDeployment = Effect.fn('RuntimeDeployService.writeDeployment')(function* (
        buildId: BuildId,
        target: RuntimeDeployTarget,
        options: RuntimeDeployOptions,
      ) {
        yield* Effect.sleep(Option.getOrElse(options.delayMs, () => 0));
        const resolvedTarget = resolveTarget(target);
        const deployed = yield* runBuildOperation('deploy', buildId, resolvedTarget);
        const deploymentId = makeDeploymentId();
        const directory = yield* verifiedChildPath(root, deploymentId);
        yield* ensureDirectory(directory);
        const manifestPath = yield* verifiedChildPath(directory, metadataFileName);
        const deployment = new RuntimeDeployment({
          id: deploymentId,
          buildId,
          target: runtimeDeployTargetSummary(resolvedTarget),
          createdAt: new Date().toISOString(),
          endpoint: deployed.endpoint,
          manifestPath,
          integrityHash: emptyContentHash,
        });
        const integrityHash = yield* writeVerifiedJson(manifestPath, RuntimeDeployment, deployment);
        yield* PubSub.publish(events, void 0);
        return new RuntimeDeployment({ ...deployment, integrityHash });
      });

      const deploy = Effect.fn('RuntimeDeployService.deploy')(function* (
        buildId: BuildId,
        target: RuntimeDeployTarget,
        options = new RuntimeDeployOptions({ delayMs: Option.none() }),
      ) {
        return yield* jobs.create({
          name: `deploy ${buildId}`,
          run: writeDeployment(buildId, target, options),
        });
      });

      const listDeployments = Effect.fn('RuntimeDeployService.listDeployments')(function* (
        buildId: BuildId,
      ) {
        const deployments = yield* listVerifiedJson(root, RuntimeDeployment);
        return deployments.filter((deployment) => deployment.buildId === buildId);
      });

      const runDeploymentOperation = Effect.fn('RuntimeDeployService.runDeploymentOperation')(
        function* (operation: 'status' | 'logs' | 'destroy', deploymentId: DeploymentId) {
          const deployment = yield* getDeployment(deploymentId);
          const adapter = adapters.find(
            (candidate) => candidate.id === deployment.target.adapterId,
          );
          if (adapter === undefined) {
            return yield* new RuntimeDeployAuthError({
              buildId: deployment.buildId,
              message: `runtime deployment adapter not registered: ${deployment.target.adapterId}`,
            });
          }
          const build = yield* builds.getBuild(deployment.buildId);
          return yield* adapter[operation]({
            buildId: deployment.buildId,
            artifactDirectory: build.directory,
            target: deploymentTarget(deployment),
          });
        },
      );

      const status = Effect.fn('RuntimeDeployService.status')(function* (
        deploymentId: DeploymentId,
      ) {
        return yield* runDeploymentOperation('status', deploymentId);
      });

      const logs = Effect.fn('RuntimeDeployService.logs')(function* (deploymentId: DeploymentId) {
        return yield* runDeploymentOperation('logs', deploymentId);
      });

      const destroy = Effect.fn('RuntimeDeployService.destroy')(function* (
        deploymentId: DeploymentId,
      ) {
        yield* runDeploymentOperation('destroy', deploymentId);
        yield* deleteDirectory(yield* verifiedChildPath(root, deploymentId));
        yield* PubSub.publish(events, void 0);
      });

      const deleteDeployment = Effect.fn('RuntimeDeployService.deleteDeployment')(function* (
        deploymentId: DeploymentId,
      ) {
        yield* destroy(deploymentId).pipe(
          Effect.mapError(
            (error) =>
              new ServicesBuildError({
                path: Option.none(),
                message: error.message,
              }),
          ),
        );
      });

      return {
        plan,
        preview,
        deploy,
        status,
        logs,
        destroy,
        getDeployment,
        listDeployments,
        deleteDeployment,
        subscribe: Stream.fromPubSub(events),
      };
    }),
  );

export const RuntimeDeployServiceLive = makeRuntimeDeployServiceLive();

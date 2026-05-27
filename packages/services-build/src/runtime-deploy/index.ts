import path from "node:path";

import { BuildId } from "@tileborne/core";
import { HomeService, JobId, JobService } from "@tileborne/services-foundation";
import { Context, Effect, Layer, Option, PubSub, Stream } from "effect";

import { BuildService } from "../build/index.js";
import {
  DeploymentId,
  DeploymentNotFoundError,
  IntegrityMismatchError,
  RuntimeDeployAuthError,
  RuntimeDeployOptions,
  RuntimeDeployTarget,
  RuntimeDeployment,
  emptyContentHash,
  type ServicesBuildError,
  makeDeploymentId,
} from "../model.js";
import {
  deleteDirectory,
  ensureDirectory,
  listVerifiedJson,
  metadataFileName,
  readVerifiedJson,
  verifiedChildPath,
  writeVerifiedJson,
} from "../internal/persistence.js";

export class RuntimeDeployService extends Context.Service<RuntimeDeployService, {
  readonly deploy: (
    buildId: BuildId,
    target: RuntimeDeployTarget,
    options?: RuntimeDeployOptions,
  ) => Effect.Effect<JobId>;
  readonly getDeployment: (
    deploymentId: DeploymentId,
  ) => Effect.Effect<RuntimeDeployment, ServicesBuildError | DeploymentNotFoundError | IntegrityMismatchError>;
  readonly listDeployments: (
    buildId: BuildId,
  ) => Effect.Effect<readonly RuntimeDeployment[], ServicesBuildError | IntegrityMismatchError>;
  readonly deleteDeployment: (deploymentId: DeploymentId) => Effect.Effect<void, ServicesBuildError>;
  readonly subscribe: Stream.Stream<void>;
}>()("@tileborne/services-build/RuntimeDeployService") {}

const deployRoot = (cachePath: string): string => path.join(cachePath, "deployments");

export const RuntimeDeployServiceLive = Layer.effect(
  RuntimeDeployService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const jobs = yield* JobService;
    const builds = yield* BuildService;
    const events = yield* PubSub.unbounded<void>();
    const root = deployRoot(home.paths.cache);
    yield* ensureDirectory(root);

    const getDeployment = Effect.fn("RuntimeDeployService.getDeployment")(function* (
      deploymentId: DeploymentId,
    ) {
      const filePath = yield* verifiedChildPath(root, deploymentId, metadataFileName);
      return yield* readVerifiedJson(filePath, RuntimeDeployment).pipe(
        Effect.mapError((error) =>
          error._tag === "ServicesBuildError"
            ? new DeploymentNotFoundError({
              deploymentId,
              message: `deployment not found: ${deploymentId}`,
            })
            : error,
        ),
      );
    });

    const writeDeployment = Effect.fn("RuntimeDeployService.writeDeployment")(function* (
      buildId: BuildId,
      target: RuntimeDeployTarget,
      options: RuntimeDeployOptions,
    ) {
      if (Option.isNone(target.credentials)) {
        yield* new RuntimeDeployAuthError({
          buildId,
          message: "runtime deployment requires Cloudflare credentials",
        });
      }
      yield* builds.getBuild(buildId);
      yield* Effect.sleep(Option.getOrElse(options.delayMs, () => 0));
      const deploymentId = makeDeploymentId();
      const directory = yield* verifiedChildPath(root, deploymentId);
      yield* ensureDirectory(directory);
      const manifestPath = yield* verifiedChildPath(directory, metadataFileName);
      const deployment = new RuntimeDeployment({
        id: deploymentId,
        buildId,
        target,
        createdAt: new Date().toISOString(),
        endpoint: `https://${target.workerName}.${target.stage}.workers.dev`,
        manifestPath,
        integrityHash: emptyContentHash,
      });
      const integrityHash = yield* writeVerifiedJson(manifestPath, RuntimeDeployment, deployment);
      yield* PubSub.publish(events, void 0);
      return new RuntimeDeployment({ ...deployment, integrityHash });
    });

    const deploy = Effect.fn("RuntimeDeployService.deploy")(function* (
      buildId: BuildId,
      target: RuntimeDeployTarget,
      options = new RuntimeDeployOptions({ delayMs: Option.none() }),
    ) {
      return yield* jobs.create({
        name: `deploy ${buildId}`,
        run: writeDeployment(buildId, target, options),
      });
    });

    const listDeployments = Effect.fn("RuntimeDeployService.listDeployments")(function* (
      buildId: BuildId,
    ) {
      const deployments = yield* listVerifiedJson(root, RuntimeDeployment);
      return deployments.filter((deployment) => deployment.buildId === buildId);
    });

    const deleteDeployment = Effect.fn("RuntimeDeployService.deleteDeployment")(function* (
      deploymentId: DeploymentId,
    ) {
      yield* deleteDirectory(yield* verifiedChildPath(root, deploymentId));
      yield* PubSub.publish(events, void 0);
    });

    return {
      deploy,
      getDeployment,
      listDeployments,
      deleteDeployment,
      subscribe: Stream.fromPubSub(events),
    };
  }),
);

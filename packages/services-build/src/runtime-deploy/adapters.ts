import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { BuildId } from '@tileborne/core';
import { createLocalGameHost, type LocalGameHost } from '@tileborne/game-host/local';
import { Effect, Option } from 'effect';

import {
  RuntimeDeployAuthError,
  RuntimeDeployCredentials,
  RuntimeDeployOperation,
  RuntimeDeployOperationError,
  RuntimeDeployTarget,
  RuntimeDeploymentTargetSummary,
  type RuntimeDeployAdapterId,
} from '../model.js';

const execFileAsync = promisify(execFile);
const DEFAULT_DEV_HANDOFF_SIGNING_KEY = 'tileborne-dev-handoff-signing-key-32chars-min';
const digestForPath = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

export interface RuntimeDeploymentAdapterContext {
  readonly buildId: BuildId;
  readonly artifactDirectory: string;
  readonly target: RuntimeDeployTarget;
}

export interface RuntimeDeploymentOperationResult {
  readonly endpoint: string;
  readonly status: 'planned' | 'previewed' | 'deployed' | 'running' | 'destroyed';
  readonly logs: readonly string[];
}

export interface LocalRuntimeDeploymentRunnerResult extends RuntimeDeploymentOperationResult {
  readonly stop?: (() => Promise<void>) | undefined;
}

export type LocalRuntimeDeploymentRunner = (
  operation: RuntimeDeployOperation,
  context: RuntimeDeploymentAdapterContext,
) => Promise<LocalRuntimeDeploymentRunnerResult>;

export interface RuntimeDeploymentAdapter {
  readonly id: RuntimeDeployAdapterId;
  readonly provider: 'local' | 'cloudflare';
  readonly plan: (
    context: RuntimeDeploymentAdapterContext,
  ) => Effect.Effect<
    RuntimeDeploymentOperationResult,
    RuntimeDeployAuthError | RuntimeDeployOperationError
  >;
  readonly preview: (
    context: RuntimeDeploymentAdapterContext,
  ) => Effect.Effect<
    RuntimeDeploymentOperationResult,
    RuntimeDeployAuthError | RuntimeDeployOperationError
  >;
  readonly deploy: (
    context: RuntimeDeploymentAdapterContext,
  ) => Effect.Effect<
    RuntimeDeploymentOperationResult,
    RuntimeDeployAuthError | RuntimeDeployOperationError
  >;
  readonly status: (
    context: RuntimeDeploymentAdapterContext,
  ) => Effect.Effect<
    RuntimeDeploymentOperationResult,
    RuntimeDeployAuthError | RuntimeDeployOperationError
  >;
  readonly logs: (
    context: RuntimeDeploymentAdapterContext,
  ) => Effect.Effect<
    RuntimeDeploymentOperationResult,
    RuntimeDeployAuthError | RuntimeDeployOperationError
  >;
  readonly destroy: (
    context: RuntimeDeploymentAdapterContext,
  ) => Effect.Effect<
    RuntimeDeploymentOperationResult,
    RuntimeDeployAuthError | RuntimeDeployOperationError
  >;
}

export interface AlchemyCloudflareExecutorInput {
  readonly operation: RuntimeDeployOperation;
  readonly artifactDirectory: string;
  readonly workerName: string;
  readonly stage: RuntimeDeploymentTargetSummary['stage'];
  readonly credentials: RuntimeDeployCredentials;
}

export interface NodeAlchemyCloudflareRunnerInput extends AlchemyCloudflareExecutorInput {
  readonly stateDirectory: string;
  readonly handoffSigningKey: string;
  readonly alchemyPassword?: string | undefined;
}

export type NodeAlchemyCloudflareRunner = (
  input: NodeAlchemyCloudflareRunnerInput,
) => Promise<RuntimeDeploymentOperationResult>;

export type AlchemyCloudflareExecutor = (
  input: AlchemyCloudflareExecutorInput,
) => Promise<RuntimeDeploymentOperationResult>;

export const defaultRuntimeDeployAdapterId = (
  target: RuntimeDeployTarget,
): RuntimeDeployAdapterId =>
  Option.getOrElse(target.adapterId, () =>
    target.stage === 'local' ? 'local' : 'alchemy-cloudflare',
  );

export const runtimeDeployTargetSummary = (
  target: RuntimeDeployTarget,
): RuntimeDeploymentTargetSummary =>
  new RuntimeDeploymentTargetSummary({
    adapterId: defaultRuntimeDeployAdapterId(target),
    stage: target.stage,
    workerName: target.workerName,
  });

export const redactDeploymentText = (
  value: string,
  credentials: Option.Option<RuntimeDeployCredentials>,
): string => {
  let redacted = value
    .replace(/(CLOUDFLARE_API_TOKEN|ALCHEMY_PASSWORD|PASSWORD)=([^\s]+)/g, '$1=[redacted]')
    .replace(/(apiToken|password|secret|token)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[redacted]');
  if (Option.isSome(credentials)) {
    for (const secret of [
      credentials.value.accountId,
      credentials.value.apiToken,
      credentials.value.profile ?? '',
    ]) {
      if (secret.length > 0) {
        redacted = redacted.split(secret).join('[redacted]');
      }
    }
  }
  return redacted;
};

const operationError = (
  operation: RuntimeDeployOperation,
  adapterId: RuntimeDeployAdapterId,
  credentials: Option.Option<RuntimeDeployCredentials>,
  cause: unknown,
): RuntimeDeployOperationError =>
  new RuntimeDeployOperationError({
    operation,
    adapterId,
    code: 'adapter_operation_failed',
    message: redactDeploymentText(
      cause instanceof Error ? cause.message : String(cause),
      credentials,
    ),
  });

export const runtimeDeploymentOperationResult = (
  endpoint: string,
  status: RuntimeDeploymentOperationResult['status'],
  logs: readonly string[] = [],
): RuntimeDeploymentOperationResult => ({ endpoint, status, logs });

const redactDeploymentResult = (
  result: RuntimeDeploymentOperationResult,
  credentials: Option.Option<RuntimeDeployCredentials>,
): RuntimeDeploymentOperationResult => ({
  endpoint: redactDeploymentText(result.endpoint, credentials),
  status: result.status,
  logs: result.logs.map((entry) => redactDeploymentText(entry, credentials)),
});

const operationStatus = (
  operation: RuntimeDeployOperation,
): RuntimeDeploymentOperationResult['status'] => {
  if (operation === 'plan') return 'planned';
  if (operation === 'preview') return 'previewed';
  if (operation === 'destroy') return 'destroyed';
  if (operation === 'deploy') return 'deployed';
  return 'running';
};

const defaultLocalRunner: LocalRuntimeDeploymentRunner = async (operation, context) => {
  const host: LocalGameHost = await createLocalGameHost({
    workerPath: path.join(context.artifactDirectory, 'worker.js'),
  });
  const health = await host.fetch('/health');
  if (!health.ok) {
    await host.stop();
    throw new Error(`local runtime health probe failed: ${health.status}`);
  }
  if (operation !== 'deploy') {
    await host.stop();
    return runtimeDeploymentOperationResult(host.baseUrl, operationStatus(operation), [
      `local ${operation} health ${health.status}`,
    ]);
  }
  return {
    ...runtimeDeploymentOperationResult(host.baseUrl, 'deployed', [
      `local deploy health ${health.status}`,
    ]),
    stop: () => host.stop(),
  };
};

export const createLocalRuntimeDeploymentAdapter = (
  runner: LocalRuntimeDeploymentRunner = defaultLocalRunner,
): RuntimeDeploymentAdapter => {
  const active = new Map<string, LocalRuntimeDeploymentRunnerResult>();
  const run = (
    operation: RuntimeDeployOperation,
    context: RuntimeDeploymentAdapterContext,
  ): Effect.Effect<RuntimeDeploymentOperationResult, RuntimeDeployOperationError> =>
    Effect.tryPromise({
      try: async () => {
        if (operation === 'status' || operation === 'logs') {
          const deployed = active.get(context.target.workerName);
          if (deployed !== undefined) {
            return runtimeDeploymentOperationResult(deployed.endpoint, 'running', [
              ...deployed.logs,
              `local ${operation} active`,
            ]);
          }
        }
        if (operation === 'destroy') {
          const deployed = active.get(context.target.workerName);
          if (deployed !== undefined) {
            await deployed.stop?.();
            active.delete(context.target.workerName);
            return runtimeDeploymentOperationResult(deployed.endpoint, 'destroyed', [
              ...deployed.logs,
              'local destroy stopped runtime',
            ]);
          }
        }
        const result = await runner(operation, context);
        if (operation === 'deploy') active.set(context.target.workerName, result);
        return result;
      },
      catch: (cause) => operationError(operation, 'local', Option.none(), cause),
    });

  return {
    id: 'local',
    provider: 'local',
    plan: (context) => run('plan', context),
    preview: (context) => run('preview', context),
    deploy: (context) => run('deploy', context),
    status: (context) => run('status', context),
    logs: (context) => run('logs', context),
    destroy: (context) => run('destroy', context),
  };
};

const packagedElectronAppRoot = (): string | undefined => {
  const resourcesPath =
    typeof (process as NodeJS.Process & { readonly resourcesPath?: unknown }).resourcesPath === 'string'
      ? (process as NodeJS.Process & { readonly resourcesPath: string }).resourcesPath
      : undefined;
  if (process.versions.electron === undefined || resourcesPath === undefined) {
    return undefined;
  }
  return path.join(resourcesPath, 'app');
};

const requireBaseFile = (): string =>
  path.join(packagedElectronAppRoot() ?? process.cwd(), 'package.json');

const packageRequire = () => createRequire(requireBaseFile());

export const defaultAlchemyCloudflareStackEntrypoint = (): string => {
  const envEntrypoint = process.env.TILEBORNE_ALCHEMY_STACK_ENTRYPOINT;
  if (envEntrypoint !== undefined && envEntrypoint.length > 0) {
    return envEntrypoint;
  }

  const appRoot = packagedElectronAppRoot();
  const packagedStack =
    appRoot === undefined ? undefined : path.join(appRoot, 'runtime-deploy', 'alchemy-cloudflare-stack.js');
  if (packagedStack !== undefined && existsSync(packagedStack)) {
    return packagedStack;
  }

  const workspaceStack = path.resolve(
    process.cwd(),
    'packages/services-build/dist/runtime-deploy/alchemy-cloudflare-stack.js',
  );
  if (existsSync(workspaceStack)) {
    return workspaceStack;
  }

  const resolvedServicesBuild = packageRequire().resolve('@tileborne/services-build');
  return path.join(path.dirname(resolvedServicesBuild), 'runtime-deploy', 'alchemy-cloudflare-stack.js');
};

export const defaultAlchemyExecEntrypoint = (): string =>
  packageRequire().resolve('alchemy/bin/alchemy.js');

const ALCHEMY_RESULT_PREFIX = 'TILEBORNE_ALCHEMY_RESULT_JSON=';

export const createNodeAlchemyCloudflareRunner =
  (
    execute: typeof execFileAsync = execFileAsync,
    stackEntrypoint: string = defaultAlchemyCloudflareStackEntrypoint(),
    alchemyExecEntrypoint: string = defaultAlchemyExecEntrypoint(),
  ): NodeAlchemyCloudflareRunner =>
  async (input) => {
    const payload = {
      operation: input.operation,
      artifactDirectory: input.artifactDirectory,
      workerName: input.workerName,
      stage: input.stage,
      stateDirectory: input.stateDirectory,
      workerPath: path.join(input.artifactDirectory, 'worker.js'),
      behaviorWorkerPath: path.join(input.artifactDirectory, 'behavior-worker.js'),
    };
    const executed = await execute(process.execPath, [
      alchemyExecEntrypoint,
      ...alchemyCliArgs(input, stackEntrypoint),
    ], {
      cwd: input.stateDirectory,
      env: buildNodeAlchemyRunnerEnv(input, payload, process.env, undefined, stackEntrypoint),
      maxBuffer: 1024 * 1024,
    });
    const output = parseAlchemyExecOutput(String(executed.stdout ?? ''));
    return runtimeDeploymentOperationResult(output.endpoint ?? '', output.status ?? operationStatus(input.operation), [
      `alchemy-cloudflare ${input.operation} ${input.workerName}`,
      `alchemy cli ${alchemyExecEntrypoint}`,
      `alchemy stack ${stackEntrypoint}`,
      ...(output.logs ?? []),
    ]);
  };

const alchemyCliArgs = (
  input: NodeAlchemyCloudflareRunnerInput,
  stackEntrypoint: string,
): readonly string[] => {
  const command = input.operation === 'destroy' ? 'destroy' : 'deploy';
  return [
    command,
    ...(input.operation === 'plan' || input.operation === 'preview' ? ['--dry-run'] : []),
    '--stage',
    input.stage,
    '--yes',
    ...(input.credentials.profile === undefined ? [] : ['--profile', input.credentials.profile]),
    ...(input.operation === 'destroy' ? [] : ['--adopt']),
    stackEntrypoint,
  ];
};

const runtimeDeploymentStatuses: ReadonlySet<RuntimeDeploymentOperationResult['status']> =
  new Set(['planned', 'previewed', 'deployed', 'running', 'destroyed']);

const parseAlchemyExecOutput = (
  stdout: string,
): Partial<Pick<RuntimeDeploymentOperationResult, 'endpoint' | 'status' | 'logs'>> => {
  for (const line of stdout
    .split('\n')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .reverse()) {
    const jsonCandidate = line.startsWith(ALCHEMY_RESULT_PREFIX)
      ? line.slice(ALCHEMY_RESULT_PREFIX.length)
      : line;
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const status =
        typeof record.status === 'string' &&
        runtimeDeploymentStatuses.has(record.status as RuntimeDeploymentOperationResult['status'])
          ? (record.status as RuntimeDeploymentOperationResult['status'])
          : undefined;
      const logs = Array.isArray(record.logs)
        ? record.logs.filter((entry): entry is string => typeof entry === 'string')
        : undefined;
      return {
        ...(typeof record.endpoint === 'string' ? { endpoint: record.endpoint } : {}),
        ...(status === undefined ? {} : { status }),
        ...(logs === undefined ? {} : { logs }),
      };
    } catch {
      // Alchemy may print human-readable plan output; only consume explicit JSON result lines.
    }
  }
  return {};
};

export const buildNodeAlchemyRunnerEnv = (
  input: NodeAlchemyCloudflareRunnerInput,
  payload: Record<string, unknown>,
  baseEnv: NodeJS.ProcessEnv = process.env,
  isElectronProcess = process.versions.electron !== undefined,
  stackEntrypoint: string = defaultAlchemyCloudflareStackEntrypoint(),
): NodeJS.ProcessEnv => {
  const profile = input.credentials.profile;
  const {
    CLOUDFLARE_ACCOUNT_ID: _cloudflareAccountId,
    CLOUDFLARE_API_TOKEN: _cloudflareApiToken,
    ...profileBaseEnv
  } = baseEnv;
  const inheritedEnv = profile === undefined ? baseEnv : profileBaseEnv;
  return {
    ...inheritedEnv,
    ...(profile === undefined
      ? {
          CLOUDFLARE_ACCOUNT_ID: input.credentials.accountId,
          CLOUDFLARE_API_TOKEN: input.credentials.apiToken,
        }
      : {}),
    ...(input.alchemyPassword === undefined ? {} : { ALCHEMY_PASSWORD: input.alchemyPassword }),
    TILEBORNE_HANDOFF_SIGNING_KEY: input.handoffSigningKey,
    TILEBORNE_ALCHEMY_INPUT: JSON.stringify(payload),
    ALCHEMY_NO_TUI: '1',
    ...(isElectronProcess ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  };
};

const deploymentStateKey = (input: AlchemyCloudflareExecutorInput): string =>
  [
    `${input.stage}-${input.workerName}`.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48),
    digestForPath(
      JSON.stringify({
        stage: input.stage,
        workerName: input.workerName,
        accountId: input.credentials.accountId,
      }),
    ),
  ].join('-');

const deploymentStateDirectory = (input: AlchemyCloudflareExecutorInput): string =>
  path.join(tmpdir(), 'tileborne-alchemy-deployments', deploymentStateKey(input));

const operationLocks = new Map<string, Promise<void>>();

const runSerialized = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const prior = operationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prior.then(
    () => current,
    () => current,
  );
  operationLocks.set(key, chained);
  await prior;
  try {
    return await run();
  } finally {
    release();
    if (operationLocks.get(key) === chained) operationLocks.delete(key);
  }
};

export const createProductionAlchemyCloudflareExecutor =
  (runner?: NodeAlchemyCloudflareRunner): AlchemyCloudflareExecutor =>
  async (input) => {
    if (input.operation === 'status' || input.operation === 'logs') {
      throw new Error(
        `Cloudflare ${input.operation} is not supported until a provider status/logs client is wired`,
      );
    }
    const alchemyPassword = process.env.ALCHEMY_PASSWORD ?? process.env.PASSWORD;
    const handoffSigningKey = process.env.HANDOFF_SIGNING_KEY;
    if ((input.stage === 'staging' || input.stage === 'production') && !handoffSigningKey) {
      throw new Error(`HANDOFF_SIGNING_KEY is required for ${input.stage}`);
    }
    if ((input.stage === 'staging' || input.stage === 'production') && !alchemyPassword) {
      throw new Error(`ALCHEMY_PASSWORD is required for ${input.stage}`);
    }
    if (handoffSigningKey !== undefined && alchemyPassword === undefined) {
      throw new Error('ALCHEMY_PASSWORD is required when HANDOFF_SIGNING_KEY is provided');
    }
    const key = deploymentStateKey(input);
    return runSerialized(key, async () => {
      const stateDirectory = deploymentStateDirectory(input);
      await mkdir(stateDirectory, { recursive: true });
      const runAlchemy = runner ?? createNodeAlchemyCloudflareRunner();
      const result = await runAlchemy({
        ...input,
        stateDirectory,
        handoffSigningKey: handoffSigningKey ?? DEFAULT_DEV_HANDOFF_SIGNING_KEY,
        ...(alchemyPassword === undefined ? {} : { alchemyPassword }),
      });
      if (input.operation === 'destroy') {
        if (result.status !== 'destroyed') {
          throw new Error(`Cloudflare destroy did not confirm cleanup: ${result.status}`);
        }
        await rm(stateDirectory, { recursive: true, force: true });
      }
      return result;
    });
  };

export const createAlchemyCloudflareDeploymentAdapter = (
  executor: AlchemyCloudflareExecutor = createProductionAlchemyCloudflareExecutor(),
): RuntimeDeploymentAdapter => {
  const run = (
    operation: RuntimeDeployOperation,
    context: RuntimeDeploymentAdapterContext,
  ): Effect.Effect<
    RuntimeDeploymentOperationResult,
    RuntimeDeployAuthError | RuntimeDeployOperationError
  > =>
    Effect.gen(function* () {
      const credentials = context.target.credentials;
      if (Option.isNone(credentials)) {
        return yield* new RuntimeDeployAuthError({
          buildId: context.buildId,
          message: 'runtime deployment requires Cloudflare credentials',
        });
      }
      return yield* Effect.tryPromise({
        try: () =>
          executor({
            operation,
            artifactDirectory: context.artifactDirectory,
            workerName: context.target.workerName,
            stage: context.target.stage,
            credentials: credentials.value,
          }).then((result) => redactDeploymentResult(result, credentials)),
        catch: (cause) => operationError(operation, 'alchemy-cloudflare', credentials, cause),
      });
    });

  return {
    id: 'alchemy-cloudflare',
    provider: 'cloudflare',
    plan: (context) => run('plan', context),
    preview: (context) => run('preview', context),
    deploy: (context) => run('deploy', context),
    status: (context) => run('status', context),
    logs: (context) => run('logs', context),
    destroy: (context) => run('destroy', context),
  };
};

export const createRuntimeDeploymentAdapters = (
  alchemyExecutor?: AlchemyCloudflareExecutor,
  localRunner?: LocalRuntimeDeploymentRunner,
): readonly RuntimeDeploymentAdapter[] => [
  createLocalRuntimeDeploymentAdapter(localRunner),
  createAlchemyCloudflareDeploymentAdapter(alchemyExecutor),
];

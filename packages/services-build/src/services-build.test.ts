import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ProjectAssetPackRef,
  ProjectManifest,
  hashBytes,
} from '@tileborne/core';
import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { PluginManifest } from '@tileborne/plugin-api';
import { AuthoritativeBehaviorRuntimeHost } from '@tileborne/runtime/behavior';
import {
  AssetService,
  DirectoryAssetPackSource,
  MapService,
  ProjectAudioService,
  ProjectGameShellService,
  ProjectService,
} from '@tileborne/services-app';
import {
  ConfigLayer,
  HomeService,
  HomeServiceLive,
  JobService,
} from '@tileborne/services-foundation';
import { withTempHome } from '../../services-foundation/src/test-utils.js';
import {
  LocalPluginSource,
  PluginInstallerLayer,
  PluginInstallerService,
  PluginLoaderMainLayer,
  PluginLoaderService,
  PluginRegistryLayer,
  PluginRegistryService,
  materializePluginManifestInput,
} from '@tileborne/services-plugin';
import { describe, expect, it } from 'vitest';
import { Effect, Fiber, Layer, Option, Result, Schema, Stream } from 'effect';

import {
  BuildOptions,
  BuildService,
  GameBuildOptions,
  CloudflareWorkerExportTarget,
  ExportOptions,
  ExportService,
  NodeExportTarget,
  PlaytestOptions,
  PlaytestService,
  RuntimeDeployCredentials,
  RuntimeDeployOptions,
  RuntimeDeployService,
  RuntimeDeployOperationError,
  RuntimeDeployTarget,
  SupportBundleOptions,
  SupportService,
  WebExportTarget,
  ServicesBuildLayer,
  buildNodeAlchemyRunnerEnv,
  createAlchemyCloudflareDeploymentAdapter,
  createNodeAlchemyCloudflareRunner,
  createProductionAlchemyCloudflareExecutor,
  defaultAlchemyExecEntrypoint,
  defaultAlchemyCloudflareStackEntrypoint,
  makeServicesBuildLayer,
  runtimeDeploymentOperationResult,
  gameArtifactBuildId,
  type BuildPromotionOperations,
  type RuntimeDeployOperation,
  type RuntimeDeployServiceRuntimeOptions,
} from './index.js';
import {
  BATTLE_ROYALE_REFERENCE_PLUGIN_ID,
  bootstrapBattleRoyaleReferenceProject,
} from './reference-game/battle-royale.js';

const BATTLE_ROYALE_PLUGIN_ID = BATTLE_ROYALE_REFERENCE_PLUGIN_ID;
import { metadataFileName } from './internal/persistence.js';
import { createLocalGameHost } from './local-game-host.js';
import { makeNewBuildId } from './model.js';

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const battleRoyalePluginPackageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve('@tileborne/plugin-battle-royale'))),
  '..',
);
const tileborneCliEntrypoint = path.resolve(import.meta.dirname, '../../cli/dist/main.js');

const readJsonFile = async <A = unknown>(filePath: string): Promise<A> =>
  JSON.parse(await readFile(filePath, 'utf8')) as A;

const stageBattleRoyalePluginPackage = async (): Promise<string> => {
  const staged = await mkdtemp(path.join(tmpdir(), 'tileborne-br-plugin-package-'));
  await cp(battleRoyalePluginPackageRoot, staged, { recursive: true });
  return staged;
};

interface SpawnedTileborneCli {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly waitForOutput: (pattern: RegExp, timeoutMs?: number) => Promise<RegExpMatchArray>;
  readonly stop: () => Promise<number | null>;
}

const spawnTileborneCli = (
  args: readonly string[],
  options: { readonly cwd: string; readonly home: string },
): SpawnedTileborneCli => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const proc = spawn(process.execPath, [tileborneCliEntrypoint, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      TILEBORNE_HOME: options.home,
      TILEBORNE_LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => stdoutChunks.push(chunk));
  proc.stderr.on('data', (chunk: string) => stderrChunks.push(chunk));
  const exited = new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
  });
  const waitForOutput = (pattern: RegExp, timeoutMs = 15_000): Promise<RegExpMatchArray> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const combined = `${stdoutChunks.join('')}\n${stderrChunks.join('')}`;
        const match = combined.match(pattern);
        if (match) {
          clearInterval(timer);
          resolve(match);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(
            new Error(
              `timed out waiting for ${pattern}\nstdout:\n${stdoutChunks.join('')}\nstderr:\n${stderrChunks.join('')}`,
            ),
          );
        }
      }, 100);
    });
  return {
    proc,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
    waitForOutput,
    stop: async () => {
      proc.kill('SIGINT');
      return Promise.race([
        exited,
        new Promise<number | null>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `tileborne CLI did not exit within 5s\nstdout:\n${stdoutChunks.join('')}\nstderr:\n${stderrChunks.join('')}`,
                ),
              ),
            5_000,
          ),
        ),
      ]);
    },
  };
};

const connectExternalWebSocket = (url: string): Promise<WebSocket> => {
  const target = new URL(url);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`timed out connecting websocket: ${target.toString()}`));
    }, 5_000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error(`failed to connect websocket: ${target.toString()}`));
      },
      { once: true },
    );
  });
};

const encodeBattleRoyaleInputFrame = (input: {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: number;
  readonly aimDeg?: number;
  readonly shoot?: boolean;
}): Uint8Array =>
  BattleRoyaleProtocol.encodeClientMessage(
    new BattleRoyaleProtocol.PlayerInput({
      tick: input.tick,
      seq: input.seq,
      dir: input.dir === undefined ? Option.none() : Option.some(input.dir),
      shoot: input.shoot ?? false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
      aimDeg: input.aimDeg === undefined ? Option.none() : Option.some(input.aimDeg),
      swapSlot: Option.some(2),
    }),
  );

interface ReferenceLobbyPlayer {
  readonly playerId: string;
  readonly reconnectToken: string;
  readonly wsUrl: string;
}

interface ReferenceLobbyOwner extends ReferenceLobbyPlayer {
  readonly roomId: string;
  readonly joinCode: string;
}

const createReferenceLobby = async (
  baseUrl: string,
  mapId: string,
): Promise<ReferenceLobbyOwner> => {
  const response = await fetch(`${baseUrl}/lobbies/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mapId,
      displayName: 'Reference Battle Royale',
      visibility: 'private',
      reserveCreator: true,
      playerDisplayName: 'Ada',
      options: {
        countdownSeconds: 0,
      },
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as ReferenceLobbyOwner;
};

const joinReferenceLobby = async (
  baseUrl: string,
  joinCode: string,
  displayName: string,
): Promise<ReferenceLobbyPlayer> => {
  const response = await fetch(`${baseUrl}/lobbies/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ joinCode: joinCode.toLowerCase(), displayName }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as ReferenceLobbyPlayer;
};

const readyReferencePlayer = async (
  baseUrl: string,
  roomId: string,
  player: ReferenceLobbyPlayer,
): Promise<void> => {
  const response = await fetch(`${baseUrl}/lobbies/${roomId}/ready`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId: player.playerId,
      reconnectToken: player.reconnectToken,
      ready: true,
    }),
  });
  expect(response.status).toBe(200);
};

const startReferenceLobby = async (
  baseUrl: string,
  owner: ReferenceLobbyOwner,
): Promise<{ readonly phase: string; readonly playerCount: number }> => {
  const response = await fetch(`${baseUrl}/lobbies/${owner.roomId}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId: owner.playerId,
      reconnectToken: owner.reconnectToken,
    }),
  });
  if (response.status === 409) {
    const lobbyResponse = await fetch(`${baseUrl}/lobbies/${owner.roomId}`);
    expect(lobbyResponse.status).toBe(200);
    const lobby = (await lobbyResponse.json()) as {
      readonly phase: string;
      readonly playerCount: number;
    };
    expect(lobby.phase).toBe('active');
    return lobby;
  }
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    readonly lobby: { readonly phase: string; readonly playerCount: number };
  };
  return payload.lobby;
};

const driveBattleRoyaleGameplayToResults = async (
  baseUrl: string,
  ownerSocket: WebSocket,
  roomId: string,
): Promise<{
  readonly reason?: string;
  readonly winnerPlayerId?: string;
  readonly players: readonly { readonly playerId: string; readonly outcome: string }[];
}> => {
  let tick = 1;
  let seq = 1;
  const driver = setInterval(() => {
    if (ownerSocket.readyState === WebSocket.OPEN) {
      ownerSocket.send(
        encodeBattleRoyaleInputFrame({
          tick,
          seq,
          dir: 0,
          aimDeg: 0,
          shoot: tick === 1 || tick % 8 === 0,
        }),
      );
      tick += 1;
      seq += 1;
    }
  }, 50);
  try {
    const started = Date.now();
    let lastPayload: unknown;
    while (Date.now() - started < 60_000) {
      const response = await fetch(`${baseUrl}/rooms/${roomId}/results`);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        readonly results: {
          readonly reason?: string;
          readonly winnerPlayerId?: string;
          readonly players: readonly { readonly playerId: string; readonly outcome: string }[];
        } | null;
      };
      lastPayload = payload;
      if (payload.results?.reason === 'match complete') {
        return payload.results;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`timed out waiting for match complete results: ${JSON.stringify(lastPayload)}`);
  } finally {
    clearInterval(driver);
  }
};

// ServicesBuildLayer owns the canonical persistent JobService. Providing a
// second in-memory JobService here splits create from list/cancel and makes
// every async job appear permanently absent to the assertions.
const foundationLayer = Layer.mergeAll(HomeServiceLive, ConfigLayer);
const pluginLayer = Layer.mergeAll(PluginLoaderMainLayer, PluginInstallerLayer).pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(foundationLayer),
);
const testLayer = ServicesBuildLayer.pipe(
  Layer.provideMerge(pluginLayer),
  Layer.provideMerge(foundationLayer),
);

interface RuntimeDeployCall {
  readonly provider: 'local' | 'alchemy-cloudflare';
  readonly operation: RuntimeDeployOperation;
  readonly workerName: string;
  readonly artifactDirectory: string;
  readonly apiToken?: string | undefined;
  readonly profile?: string | undefined;
}

const operationStatus = (operation: RuntimeDeployOperation) =>
  operation === 'plan'
    ? 'planned'
    : operation === 'preview'
      ? 'previewed'
      : operation === 'destroy'
        ? 'destroyed'
        : operation === 'deploy'
          ? 'deployed'
          : 'running';

const deployTestLayer = (
  calls: RuntimeDeployCall[] = [],
  options: Partial<RuntimeDeployServiceRuntimeOptions> = {},
) =>
  makeServicesBuildLayer(
    undefined,
    {},
    {
      alchemyExecutor: async (input) => {
        calls.push({
          provider: 'alchemy-cloudflare',
          operation: input.operation,
          workerName: input.workerName,
          artifactDirectory: input.artifactDirectory,
          apiToken: input.credentials.apiToken,
          profile: input.credentials.profile,
        });
        return runtimeDeploymentOperationResult(
          `https://provider.example/${input.operation}/${input.workerName}`,
          operationStatus(input.operation),
          [`provider ${input.operation} ${input.workerName}`],
        );
      },
      localRunner: async (operation, context) => {
        calls.push({
          provider: 'local',
          operation,
          workerName: context.target.workerName,
          artifactDirectory: context.artifactDirectory,
        });
        return {
          ...runtimeDeploymentOperationResult(
            `http://local.example/${operation}/${context.target.workerName}`,
            operationStatus(operation),
            [`local ${operation} ${context.target.workerName}`],
          ),
          stop: async () => undefined,
        };
      },
      credentialResolver: (target) =>
        target.adapterId === 'alchemy-cloudflare'
          ? Option.some(
              new RuntimeDeployCredentials({
                accountId: 'acct-env-secret',
                apiToken: 'token-env-secret',
              }),
            )
          : Option.none(),
      ...options,
    },
  ).pipe(Layer.provideMerge(pluginLayer), Layer.provideMerge(foundationLayer));
const testLayerWithPromotion = (operations: BuildPromotionOperations) =>
  makeServicesBuildLayer(operations).pipe(
    Layer.provideMerge(pluginLayer),
    Layer.provideMerge(foundationLayer),
  );
const EXAMPLE_ARENA_PLUGIN_ID = '@tileborne-plugins/example-arena';
const tinyLicensedWav = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x2a, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f,
  0x00, 0x00,
]);

const waitForJob = (jobId: string) =>
  Effect.gen(function* () {
    const jobs = yield* JobService;
    const deadline = performance.now() + 5_000;
    let lastObserved: string | undefined;
    while (performance.now() < deadline) {
      const job = (yield* jobs.list()).find((entry) => entry.id === jobId);
      lastObserved = job?.status._tag;
      if (
        job &&
        (job.status._tag === 'Completed' ||
          job.status._tag === 'Failed' ||
          job.status._tag === 'Cancelled')
      ) {
        return job;
      }
      yield* Effect.sleep(10);
    }
    throw new Error(
      `job did not finish within 5000ms: ${jobId}; last status=${lastObserved ?? 'not listed'}`,
    );
  });

const seedProject = (name = 'Arena') =>
  Effect.gen(function* () {
    const projects = yield* ProjectService;
    const maps = yield* MapService;
    const projectId = yield* projects.create({ name });
    const mapId = yield* maps.create(projectId, { width: 16, height: 16 });
    return { projectId, mapId };
  });

const installFixtureAssetPack = (license: Record<string, unknown>) =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() =>
      mkdtemp(path.join(tmpdir(), 'tileborne-license-pack-')),
    );
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const manifest = {
      id: 'pack:550e8400-e29b-41d4-a716-446655440077',
      name: 'License Fixture Pack',
      version: '1.0.0',
      license,
      assets: [
        {
          id: 'asset:550e8400-e29b-41d4-a716-446655440078',
          path: 'tiles/terrain.png',
          mime: 'image/png',
          size: bytes.byteLength,
          hash: hashBytes(bytes),
          license,
        },
      ],
    };
    yield* Effect.promise(async () => {
      await mkdir(path.join(source, 'tiles'), { recursive: true });
      await writeFile(
        path.join(source, 'tileborne-asset-pack.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await writeFile(path.join(source, 'tiles', 'terrain.png'), bytes);
    });
    const assets = yield* AssetService;
    const packId = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
    return yield* assets.getPack(packId);
  });

const installFixtureAudioPack = () =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() =>
      mkdtemp(path.join(tmpdir(), 'tileborne-audio-pack-')),
    );
    const license = {
      spdxId: 'CC0-1.0',
      attribution: 'Tileborne audio fixture',
      sourceUrl: 'https://example.invalid/audio',
      sourcePath: 'packages/services-build/test-fixtures/audio',
      modifications: 'Generated test tone',
      notes: '',
      redistributable: true,
    };
    const manifest = {
      id: 'pack:550e8400-e29b-41d4-a716-446655440088',
      name: 'Licensed Audio Fixture Pack',
      version: '1.0.0',
      license,
      assets: [
        {
          id: 'asset:550e8400-e29b-41d4-a716-446655440089',
          path: 'audio/menu.wav',
          mime: 'audio/wav',
          size: tinyLicensedWav.byteLength,
          hash: hashBytes(tinyLicensedWav),
          license,
        },
      ],
    };
    yield* Effect.promise(async () => {
      await mkdir(path.join(source, 'audio'), { recursive: true });
      await writeFile(
        path.join(source, 'tileborne-asset-pack.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await writeFile(path.join(source, 'audio', 'menu.wav'), tinyLicensedWav);
    });
    const assets = yield* AssetService;
    const packId = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
    return yield* assets.getPack(packId);
  });

const installExportPlugin = (entryBody: string) =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() =>
      mkdtemp(path.join(tmpdir(), 'tileborne-export-plugin-')),
    );
    const manifestInput = materializePluginManifestInput({
      schemaVersion: 1,
      id: '@tileborne-plugins/export',
      name: '@tileborne-plugins/export',
      version: '0.1.0',
      displayName: 'Export Plugin',
      description: 'Export hook fixture',
      author: 'Tileborne',
      license: 'MIT',
      engines: { tileborne: '^0.1.0' },
      contributes: {
        editor: {
          exporters: [
            {
              _tag: 'ExecutableEditorExporterContribution',
              id: 'web-export',
              kind: 'executable',
              display: {
                label: 'Web Export',
                description: 'Fixture export hook',
                icon: 'lucide:download',
                order: 1,
              },
              entry: 'export.mjs',
            },
          ],
        },
      },
      permissions: [],
      dependsOn: [],
    });
    yield* Effect.promise(async () => {
      await mkdir(source, { recursive: true });
      await writeFile(
        path.join(source, 'tileborne-plugin.json'),
        `${JSON.stringify(manifestInput, null, 2)}\n`,
      );
      await writeFile(path.join(source, 'export.mjs'), entryBody);
      await writeFile(path.join(source, 'README.md'), 'export fixture\n');
    });
    const installer = yield* PluginInstallerService;
    yield* installer.install(new LocalPluginSource({ path: source }));
    Schema.decodeUnknownSync(PluginManifest)(manifestInput);
    return source;
  });

const installRuntimePlugin = (input: {
  readonly pluginId: string;
  readonly runtimeSystemId: string;
  readonly runtimeLabel: string;
}) =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() =>
      mkdtemp(path.join(tmpdir(), 'tileborne-runtime-plugin-')),
    );
    const manifest = Schema.decodeUnknownSync(PluginManifest)(
      materializePluginManifestInput({
        schemaVersion: 1,
        id: input.pluginId,
        name: input.pluginId,
        version: '0.0.1',
        displayName: input.runtimeLabel,
        description: 'Runtime fixture plugin',
        author: 'Tileborne',
        license: 'MIT',
        engines: { tileborne: '^0.1.0' },
        entry: { editor: './node.js', runtime: './runtime.js' },
        permissions: [],
        dependsOn: [],
        contributes: {
          gameModes: [
            {
              _tag: 'GameModeContribution',
              id: 'fixture-mode',
              kind: 'declarative',
              display: { label: input.runtimeLabel },
              runtimeSystemId: input.runtimeSystemId,
            },
          ],
          runtime: {
            systems: [
              {
                _tag: 'ExecutableRuntimeSystemContribution',
                id: input.runtimeSystemId,
                kind: 'executable',
                display: { label: input.runtimeLabel },
                entry: './runtime.js',
              },
            ],
          },
        },
      }),
    );
    yield* Effect.promise(async () => {
      await mkdir(source, { recursive: true });
      await writeFile(
        path.join(source, 'tileborne-plugin.json'),
        `${JSON.stringify(Schema.encodeSync(PluginManifest)(manifest), null, 2)}\n`,
      );
      await writeFile(path.join(source, 'node.js'), 'export {};\n');
      await writeFile(path.join(source, 'runtime.js'), 'export {};\n');
    });
    const installer = yield* PluginInstallerService;
    yield* installer.install(new LocalPluginSource({ path: source }));
    return source;
  });

const SHIP_PLUGIN_ID = '@tileborne-plugins/ship-mode';

/**
 * Mode plugin fixture for the M5 S1 ship build: declares a runtime system (so
 * it is discoverable as a game mode) and a node entry exposing the generic
 * `exportModeData` + `resolvePlayerModels` exports the build host discovers.
 */
const installShipModePlugin = () =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() =>
      mkdtemp(path.join(tmpdir(), 'tileborne-ship-plugin-')),
    );
    const manifest = Schema.decodeUnknownSync(PluginManifest)(
      materializePluginManifestInput({
        schemaVersion: 1,
        id: SHIP_PLUGIN_ID,
        name: SHIP_PLUGIN_ID,
        version: '0.0.1',
        displayName: 'Ship Mode',
        description: 'Ship pipeline fixture plugin',
        author: 'Tileborne',
        license: 'MIT',
        engines: { tileborne: '^0.1.0' },
        entry: { server: './server.mjs', runtime: './dist/runtime.js' },
        permissions: [],
        dependsOn: [],
        contributes: {
          gameModes: [
            {
              _tag: 'GameModeContribution',
              id: 'ship-mode',
              kind: 'declarative',
              display: { label: 'Ship Mode' },
              runtimeSystemId: 'ship-mode-runtime',
            },
          ],
          runtime: {
            systems: [
              {
                _tag: 'ExecutableRuntimeSystemContribution',
                id: 'ship-mode-runtime',
                kind: 'executable',
                display: { label: 'Ship Mode Runtime' },
                entry: './dist/runtime.js',
              },
            ],
          },
        },
      }),
    );
    yield* Effect.promise(async () => {
      await mkdir(path.join(source, 'dist'), { recursive: true });
      await writeFile(
        path.join(source, 'tileborne-plugin.json'),
        `${JSON.stringify(Schema.encodeSync(PluginManifest)(manifest), null, 2)}\n`,
      );
      await writeFile(
        path.join(source, 'dist', 'runtime.js'),
        'export const createRuntimeAdapter = () => ({});\n',
      );
      await writeFile(
        path.join(source, 'server.mjs'),
        "export const exportModeData = () => ({ _tag: 'Success', success: { fixture: true } });\nexport const resolvePlayerModels = () => [];\n",
      );
    });
    const installer = yield* PluginInstallerService;
    yield* installer.install(new LocalPluginSource({ path: source }));
    return source;
  });

const runBuild = (projectId: import('@tileborne/core').ProjectId, options?: BuildOptions) =>
  Effect.gen(function* () {
    const builds = yield* BuildService;
    const jobId = yield* builds.build(projectId, options);
    const job = yield* waitForJob(jobId);
    expect(job.status._tag).toBe('Completed');
    const [summary] = yield* builds.listBuilds(projectId);
    if (!summary) {
      throw new Error('missing build summary');
    }
    return yield* builds.getBuild(summary.id);
  });

describe('BuildService', () => {
  it('builds a project into the builds cache from services-app snapshots', () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          return yield* runBuild(
            projectId,
            new BuildOptions({ target: Option.some('cloudflare'), delayMs: Option.none() }),
          );
        }).pipe(Effect.provide(deployTestLayer())),
      );
      expect(artifact.project.name).toBe('Arena');
      expect(artifact.target).toBe('cloudflare');
    }));

  it('lists builds verified on read', () =>
    withTempHome(async () => {
      const summaries = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          yield* runBuild(projectId);
          const builds = yield* BuildService;
          return yield* builds.listBuilds(projectId);
        }).pipe(Effect.provide(deployTestLayer())),
      );
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.integrityHash.startsWith('sha256:')).toBe(true);
    }));

  it('reads a build by id', () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          return yield* runBuild(projectId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(artifact.maps).toHaveLength(1);
    }));

  it('reads project data from ProjectService instead of inline options', () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('From Services');
          return yield* runBuild(projectId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(artifact.project.name).toBe('From Services');
    }));

  it(
    'buildGame cloudflare --project assembles + bakes the runtime map package (M5 S1)',
    () =>
      withTempHome(async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const { projectId, mapId } = yield* seedProject('Ship Arena');
            yield* installShipModePlugin();
            const outDir = yield* Effect.promise(() =>
              mkdtemp(path.join(tmpdir(), 'tileborne-ship-out-')),
            );
            const builds = yield* BuildService;
            const artifact = yield* builds.buildGame(
              new GameBuildOptions({
                pluginId: SHIP_PLUGIN_ID,
                target: 'cloudflare',
                outputDirectory: Option.some(outDir),
                assetPackIds: Option.none(),
                siteName: Option.none(),
                projectId: Option.some(projectId),
                mapIds: Option.none(),
              }),
            );
            const mapDir = `maps/${mapId.replaceAll(':', '-')}`;
            expect(artifact.files).toContain(`${mapDir}/manifest.json`);
            expect(artifact.files).toContain(`${mapDir}/map.json`);
            const manifest = JSON.parse(
              yield* Effect.promise(() => readFile(path.join(outDir, 'manifest.json'), 'utf8')),
            ) as {
              readonly maps: readonly {
                readonly mapId: string;
                readonly packageId: string;
                readonly files: readonly {
                  readonly path: string;
                  readonly hash: string;
                  readonly size: number;
                }[];
              }[];
            };
            expect(manifest.maps).toHaveLength(1);
            expect(manifest.maps[0]?.mapId).toBe(mapId);
            expect(manifest.maps[0]?.packageId).toMatch(/^mappkg:/);
            expect(manifest.maps[0]?.files.length).toBeGreaterThan(0);
            for (const entry of manifest.maps[0]?.files ?? []) {
              expect(entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
              expect(entry.size).toBeGreaterThan(0);
            }
            // The mode's exporter section + the package id are baked into the
            // worker bundle for packageless /rooms/create resolution.
            const worker = yield* Effect.promise(() =>
              readFile(path.join(outDir, 'worker.js'), 'utf8'),
            );
            expect(worker).toContain(manifest.maps[0]!.packageId);
            const packageManifest = JSON.parse(
              yield* Effect.promise(() =>
                readFile(path.join(outDir, mapDir, 'manifest.json'), 'utf8'),
              ),
            ) as { readonly mapId: string; readonly entryHashes: Record<string, string> };
            expect(packageManifest.mapId).toBe(mapId);
            expect(Object.keys(packageManifest.entryHashes)).toContain('modeData');
          }).pipe(Effect.provide(testLayer)),
        );
      }),
    120_000,
  );

  it('buildGame cloudflare --project rejects non-redistributable project asset packs', () =>
    withTempHome(async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Unsafe Assets Arena');
          yield* installShipModePlugin();
          const pack = yield* installFixtureAssetPack({
            spdxId: 'UNKNOWN',
            attribution: 'Unknown upstream pack',
            redistributable: false,
          });
          const projects = yield* ProjectService;
          const project = yield* projects.open(projectId);
          yield* projects.save(
            new ProjectManifest({
              ...project,
              assetPacks: [new ProjectAssetPackRef({ id: pack.id, version: pack.version })],
            }),
          );
          const outDir = yield* Effect.promise(() =>
            mkdtemp(path.join(tmpdir(), 'tileborne-unsafe-ship-out-')),
          );
          const builds = yield* BuildService;
          return yield* Effect.result(
            builds.buildGame(
              new GameBuildOptions({
                pluginId: SHIP_PLUGIN_ID,
                target: 'cloudflare',
                outputDirectory: Option.some(outDir),
                assetPackIds: Option.none(),
                siteName: Option.none(),
                projectId: Option.some(projectId),
                mapIds: Option.none(),
              }),
            ),
          );
        }).pipe(Effect.provide(testLayer)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain('requires explicit user approval');
        expect(result.failure.message).toContain('Asset library > License Fixture Pack');
      }
    }));

  it('buildGame --project rejects an unresolved imported audio source', () =>
    withTempHome(async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Unresolved Audio Arena');
          yield* installShipModePlugin();
          const pack = yield* installFixtureAudioPack();
          const audio = yield* ProjectAudioService;
          yield* audio.apply(projectId, {
            type: 'import',
            label: 'Menu Loop',
            classification: 'music',
            source: {
              assetId: 'asset:missing',
              packId: String(pack.id),
              packVersion: pack.version,
              path: 'audio/missing.wav',
              mime: 'audio/wav',
            },
          });
          yield* audio.apply(projectId, {
            type: 'bind',
            binding: 'shell.menuMusic',
            label: 'Menu Loop',
          });
          const outDir = yield* Effect.promise(() =>
            mkdtemp(path.join(tmpdir(), 'tileborne-unresolved-audio-out-')),
          );
          const builds = yield* BuildService;
          return yield* Effect.result(
            builds.buildGame(
              new GameBuildOptions({
                pluginId: SHIP_PLUGIN_ID,
                target: 'local',
                outputDirectory: Option.some(outDir),
                assetPackIds: Option.none(),
                siteName: Option.none(),
                projectId: Option.some(projectId),
                mapIds: Option.none(),
              }),
            ),
          );
        }).pipe(Effect.provide(testLayer)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain('audio packaging failed');
        expect(result.failure.message).toContain('unresolved-packaged-source');
      }
    }));

  it('buildGame --project packages licensed authored audio bytes into the copied artifact', () =>
    withTempHome(async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Licensed Audio Arena');
          yield* installShipModePlugin();
          const pack = yield* installFixtureAudioPack();
          const audio = yield* ProjectAudioService;
          yield* audio.apply(projectId, {
            type: 'import',
            label: 'Menu Loop',
            classification: 'music',
            source: {
              assetId: String(pack.assets[0]!.id),
              packId: String(pack.id),
              packVersion: pack.version,
              path: pack.assets[0]!.path,
              mime: pack.assets[0]!.mime,
            },
          });
          yield* audio.apply(projectId, {
            type: 'bind',
            binding: 'shell.menuMusic',
            label: 'Menu Loop',
          });
          const shell = yield* ProjectGameShellService;
          yield* shell.apply(projectId, {
            type: 'set-screen-text',
            screenId: 'main-menu',
            title: 'Licensed Arena Shell',
            subtitle: 'Packaged through ship build',
          });
          const projects = yield* ProjectService;
          const saved = yield* projects.open(projectId);
          expect(saved.assetPacks).toContainEqual(
            new ProjectAssetPackRef({ id: String(pack.id), version: pack.version }),
          );

          const outDir = yield* Effect.promise(() =>
            mkdtemp(path.join(tmpdir(), 'tileborne-licensed-audio-out-')),
          );
          const builds = yield* BuildService;
          const artifact = yield* builds.buildGame(
            new GameBuildOptions({
              pluginId: SHIP_PLUGIN_ID,
              target: 'local',
              outputDirectory: Option.some(outDir),
              assetPackIds: Option.none(),
              siteName: Option.none(),
              projectId: Option.some(projectId),
              mapIds: Option.none(),
            }),
          );

          const mapDir = `maps/${mapId.replaceAll(':', '-')}`;
          const packagedAudioPath = `${mapDir}/assets/packs/${pack.id}-${pack.version}/${pack.assets[0]!.path}`;
          expect(artifact.files).toContain(`${mapDir}/audio.json`);
          expect(artifact.files).toContain(`${mapDir}/shell.json`);
          expect(artifact.files).toContain(packagedAudioPath);
          expect(
            yield* Effect.promise(() => readFile(path.join(outDir, packagedAudioPath))),
          ).toEqual(Buffer.from(tinyLicensedWav));

          const copiedDir = yield* Effect.promise(() =>
            mkdtemp(path.join(tmpdir(), 'tileborne-licensed-audio-copied-')),
          );
          yield* Effect.promise(() => cp(outDir, copiedDir, { recursive: true }));

          const audioJson = JSON.parse(
            yield* Effect.promise(() =>
              readFile(path.join(copiedDir, mapDir, 'audio.json'), 'utf8'),
            ),
          ) as {
            readonly cues: readonly {
              readonly id: string;
              readonly source?: { readonly url?: string; readonly packId?: string };
            }[];
            readonly settings: { readonly masterVolume: number };
          };
          const shellJson = JSON.parse(
            yield* Effect.promise(() =>
              readFile(path.join(copiedDir, mapDir, 'shell.json'), 'utf8'),
            ),
          ) as {
            readonly screens: readonly { readonly stableId: string; readonly title: string }[];
          };
          expect(shellJson.screens.find((screen) => screen.stableId === 'main-menu')?.title).toBe(
            'Licensed Arena Shell',
          );
          expect(
            audioJson.cues.find((cue) => cue.id === 'project.shell.menuMusic')?.source,
          ).toMatchObject({
            packId: String(pack.id),
            url: `assets/packs/${pack.id}-${pack.version}/${pack.assets[0]!.path}`,
          });
          expect(audioJson.settings.masterVolume).toBe(1);
        }).pipe(Effect.provide(testLayer)),
      );
    }));

  it(
    'buildGame local emits the canonical artifact plus serve README and boots a joinable room in miniflare (M5 S2)',
    () =>
      withTempHome(async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const { projectId, mapId } = yield* seedProject('Local Ship Arena');
            yield* installShipModePlugin();
            const outDir = yield* Effect.promise(() =>
              mkdtemp(path.join(tmpdir(), 'tileborne-local-out-')),
            );
            const builds = yield* BuildService;
            const artifact = yield* builds.buildGame(
              new GameBuildOptions({
                pluginId: SHIP_PLUGIN_ID,
                target: 'local',
                outputDirectory: Option.some(outDir),
                assetPackIds: Option.none(),
                siteName: Option.none(),
                projectId: Option.some(projectId),
                mapIds: Option.none(),
              }),
            );
            expect(artifact.target).toBe('local');
            // The local target is the SAME canonical export as cloudflare …
            expect(artifact.files).toContain('worker.js');
            expect(artifact.files).toContain('manifest.json');
            expect(artifact.files).toContain('deployment.json');
            expect(artifact.files).toContain(`maps/${mapId.replaceAll(':', '-')}/map.json`);
            expect(artifact.bundlePath).toBe(path.join(outDir, 'worker.js'));
            // … plus the local serve convention.
            expect(artifact.files).toContain('README.md');
            const readme = yield* Effect.promise(() =>
              readFile(path.join(outDir, 'README.md'), 'utf8'),
            );
            expect(readme).toContain('tileborne game serve --dir .');
            expect(readme).toContain('Deployment adapters are described in deployment.json');
            expect(readme).not.toContain('wrangler deploy');

            // The artifact boots locally into a joinable room (no Cloudflare).
            const host = yield* Effect.promise(() =>
              createLocalGameHost({ port: 18092, workerPath: path.join(outDir, 'worker.js') }),
            );
            try {
              const health = yield* Effect.promise(() => host.fetch(`${host.baseUrl}/health`));
              expect(health.status).toBe(200);
              const created = yield* Effect.promise(() =>
                host.fetch(`${host.baseUrl}/rooms/create`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ mapId }),
                }),
              );
              expect(created.status).toBe(201);
              const room = (yield* Effect.promise(() => created.json())) as {
                readonly roomId: string;
                readonly wsUrl: string;
              };
              expect(room.roomId.length).toBeGreaterThan(0);
              expect(room.wsUrl).toContain(`/rooms/${room.roomId}/connect`);
            } finally {
              yield* Effect.promise(() => host.stop());
            }
          }).pipe(Effect.provide(testLayer)),
        );
      }),
    180_000,
  );

  it(
    'dogfoods the complete Battle Royale reference game through public project, plugin, build, and local serve workflows',
    () =>
      withTempHome(async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const pluginPackage = yield* Effect.promise(() => stageBattleRoyalePluginPackage());
            const { projectId, mapId, assetPackId, assetPackVersion, behaviorId, runtimeDefaults } =
              yield* seedProject('Reference Battle Royale').pipe(
                Effect.flatMap(({ projectId, mapId }) =>
                  bootstrapBattleRoyaleReferenceProject({
                    pluginPackagePath: pluginPackage,
                    projectId,
                    mapId,
                  }),
                ),
              );
            expect(runtimeDefaults.shellDefaults?.pluginId).toBe(BATTLE_ROYALE_PLUGIN_ID);
            expect(runtimeDefaults.audioDefaults?.buses.map((bus) => bus.kind).sort()).toEqual([
              'music',
              'sfx',
            ]);
            expect(
              runtimeDefaults.audioDefaults?.cues
                .map((cue) => cue.binding)
                .filter(Boolean)
                .sort(),
            ).toEqual([
              'environment.zoneWarning',
              'item.collect',
              'match.end',
              'match.start',
              'player.eliminated',
              'player.hit',
              'shell.menuMusic',
              'weapon.fire',
              'weapon.reload',
            ]);

            const outDir = yield* Effect.promise(() =>
              mkdtemp(path.join(tmpdir(), 'tileborne-reference-br-out-')),
            );
            const builds = yield* BuildService;
            const artifact = yield* builds.buildGame(
              new GameBuildOptions({
                pluginId: BATTLE_ROYALE_PLUGIN_ID,
                target: 'local',
                outputDirectory: Option.some(outDir),
                assetPackIds: Option.none(),
                siteName: Option.none(),
                projectId: Option.some(projectId),
                mapIds: Option.some([mapId]),
              }),
            );
            expect(artifact.files).toContain('worker.js');
            expect(artifact.files).toContain('behavior-worker.js');
            expect(artifact.files).toContain('deployment.json');
            const mapDir = `maps/${mapId.replaceAll(':', '-')}`;
            expect(artifact.files).toContain(`${mapDir}/manifest.json`);
            expect(artifact.files).toContain(`${mapDir}/map.json`);
            expect(artifact.files).toContain(`${mapDir}/audio.json`);
            expect(artifact.files).toContain(`${mapDir}/shell.json`);
            expect(artifact.files).toContain(`${mapDir}/behaviors.json`);
            expect(artifact.files).toContain(`${mapDir}/mode-data.json`);
            expect(artifact.files).toContain(
              `${mapDir}/assets/packs/${assetPackId}-${assetPackVersion}/tileborne-asset-pack.json`,
            );

            const packageManifest = yield* Effect.promise(() =>
              readJsonFile<{ readonly activeMode: string; readonly playerCapacity: number }>(
                path.join(outDir, mapDir, 'manifest.json'),
              ),
            );
            expect(packageManifest).toMatchObject({
              activeMode: BATTLE_ROYALE_PLUGIN_ID,
              playerCapacity: 4,
            });
            const modeData = yield* Effect.promise(() =>
              readJsonFile<
                Record<
                  string,
                  {
                    readonly maxPlayers: number;
                    readonly lootTables: readonly unknown[];
                    readonly battleRoyale?: {
                      readonly zone?: {
                        readonly damagePerSecOutside?: number;
                        readonly schedule?: {
                          readonly waitSec?: number;
                          readonly shrinkSec?: number;
                          readonly holdSec?: number;
                          readonly shrinkPhases?: number;
                          readonly radiusFactor?: number;
                        };
                      };
                    };
                  }
                >
              >(path.join(outDir, mapDir, 'mode-data.json')),
            );
            expect(modeData[BATTLE_ROYALE_PLUGIN_ID]?.maxPlayers).toBe(4);
            expect(modeData[BATTLE_ROYALE_PLUGIN_ID]?.lootTables.length ?? 0).toBeGreaterThan(0);
            expect(modeData[BATTLE_ROYALE_PLUGIN_ID]?.battleRoyale).toMatchObject({
              zone: {
                damagePerSecOutside: 50,
                schedule: {
                  waitSec: 0,
                  shrinkSec: 2,
                  holdSec: 2,
                  shrinkPhases: 1,
                  radiusFactor: 0.5,
                },
              },
            });
            const audioJson = yield* Effect.promise(() =>
              readJsonFile<{
                readonly cues: readonly {
                  readonly id: string;
                  readonly source?: { readonly url?: string };
                }[];
              }>(path.join(outDir, mapDir, 'audio.json')),
            );
            expect(audioJson.cues.map((cue) => cue.id).sort()).toEqual([
              'project.environment.zoneWarning',
              'project.item.collect',
              'project.match.end',
              'project.match.start',
              'project.player.eliminated',
              'project.player.hit',
              'project.shell.menuMusic',
              'project.weapon.fire',
              'project.weapon.reload',
            ]);
            expect(
              audioJson.cues.every((cue) => cue.source?.url?.startsWith('data:audio/wav;base64,')),
            ).toBe(true);
            const shellJson = yield* Effect.promise(() =>
              readJsonFile<{
                readonly screens: readonly { readonly stableId: string; readonly title: string }[];
              }>(path.join(outDir, mapDir, 'shell.json')),
            );
            expect(shellJson.screens.map((screen) => screen.stableId)).toEqual([
              'title',
              'main-menu',
              'loading',
              'pause',
              'settings',
              'results',
            ]);
            expect(shellJson.screens.find((screen) => screen.stableId === 'main-menu')?.title).toBe(
              'Reference Battle Royale Lobby',
            );

            const copiedDir = yield* Effect.promise(() =>
              mkdtemp(path.join(tmpdir(), 'tileborne-reference-br-copied-')),
            );
            yield* Effect.promise(() => cp(outDir, copiedDir, { recursive: true }));
            const copiedWorkerSource = yield* Effect.promise(() =>
              readFile(path.join(copiedDir, 'worker.js'), 'utf8'),
            );
            expect(copiedWorkerSource).not.toContain(battleRoyalePluginPackageRoot);
            const copiedBehaviorPackage = yield* Effect.promise(() =>
              readJsonFile<{
                readonly manifests: readonly { readonly id: string; readonly label: string }[];
                readonly visualDefinitions: readonly unknown[];
                readonly modules: readonly {
                  readonly behaviorId: string;
                  readonly sourceKind: 'typescript' | 'visual';
                  readonly modulePath: string;
                  readonly hash: string;
                }[];
              }>(path.join(copiedDir, mapDir, 'behaviors.json')),
            );
            expect(copiedBehaviorPackage.manifests).toEqual([
              expect.objectContaining({
                id: behaviorId,
                label: 'Reference Match Tick Marker',
              }),
            ]);
            expect(copiedBehaviorPackage.modules).toHaveLength(1);
            const [behaviorModule] = copiedBehaviorPackage.modules;
            if (behaviorModule === undefined) throw new Error('missing reference behavior module');
            expect(behaviorModule).toMatchObject({
              behaviorId,
              sourceKind: 'typescript',
            });
            expect(artifact.files).toContain(`${mapDir}/${behaviorModule.modulePath}`);
            const behaviorModulePath = path.join(copiedDir, mapDir, behaviorModule.modulePath);
            const behaviorModuleBytes = yield* Effect.promise(() => readFile(behaviorModulePath));
            expect(hashBytes(behaviorModuleBytes)).toBe(behaviorModule.hash);
            const behaviorNamespace = yield* Effect.promise(
              () => import(pathToFileURL(behaviorModulePath).href),
            );
            const behaviorHost = new AuthoritativeBehaviorRuntimeHost();
            expect(
              behaviorHost.load({
                artifact: behaviorModule as Parameters<
                  AuthoritativeBehaviorRuntimeHost['load']
                >[0]['artifact'],
                code: behaviorModuleBytes.toString('utf8'),
                namespace: behaviorNamespace as Readonly<Record<string, unknown>>,
              }),
            ).toBe(true);
            yield* Effect.promise(() => behaviorHost.step(7));
            expect(behaviorHost.snapshot.states).toContainEqual({
              behaviorId,
              state: { lastTick: 7 },
            });

            const serveHome = yield* Effect.promise(() =>
              mkdtemp(path.join(tmpdir(), 'tileborne-reference-br-cli-home-')),
            );
            const serveCwd = yield* Effect.promise(() =>
              mkdtemp(path.join(tmpdir(), 'tileborne-reference-br-cli-cwd-')),
            );
            const serve = spawnTileborneCli(
              ['game', 'serve', '--dir', copiedDir, '--port', '0', '--json'],
              { cwd: serveCwd, home: serveHome },
            );
            const sockets: WebSocket[] = [];
            try {
              const [baseUrl] = yield* Effect.promise(async () => {
                const match = await serve.waitForOutput(/"baseUrl"\s*:\s*"([^"]+)"/);
                const matchedBaseUrl = match[1];
                if (matchedBaseUrl === undefined) throw new Error('missing CLI baseUrl');
                return [matchedBaseUrl] as const;
              });
              expect(baseUrl.startsWith(serveCwd)).toBe(false);
              const health = yield* Effect.promise(() => fetch(`${baseUrl}/health`));
              expect(health.status).toBe(200);

              const singleClientOwner = yield* Effect.promise(() =>
                createReferenceLobby(baseUrl, mapId),
              );
              const singleClientPassive = [
                yield* Effect.promise(() =>
                  joinReferenceLobby(baseUrl, singleClientOwner.joinCode, 'Grace'),
                ),
                yield* Effect.promise(() =>
                  joinReferenceLobby(baseUrl, singleClientOwner.joinCode, 'Katherine'),
                ),
              ];
              const singleClientSocket = yield* Effect.promise(() =>
                connectExternalWebSocket(singleClientOwner.wsUrl),
              );
              sockets.push(singleClientSocket);
              for (const player of [singleClientOwner, ...singleClientPassive]) {
                yield* Effect.promise(() =>
                  readyReferencePlayer(baseUrl, singleClientOwner.roomId, player),
                );
              }
              const singleClientStarted = yield* Effect.promise(() =>
                startReferenceLobby(baseUrl, singleClientOwner),
              );
              expect(singleClientStarted).toMatchObject({ phase: 'active', playerCount: 3 });
              const singleClientResults = yield* Effect.promise(() =>
                driveBattleRoyaleGameplayToResults(
                  baseUrl,
                  singleClientSocket,
                  singleClientOwner.roomId,
                ),
              );
              expect(singleClientResults).toMatchObject({
                reason: 'match complete',
              });
              expect(singleClientResults.players).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({
                    playerId: singleClientOwner.playerId,
                    outcome: 'completed',
                  }),
                  expect.objectContaining({
                    playerId: singleClientPassive[0]!.playerId,
                    outcome: 'completed',
                  }),
                  expect.objectContaining({
                    playerId: singleClientPassive[1]!.playerId,
                    outcome: 'completed',
                  }),
                ]),
              );

              const twoClientOwner = yield* Effect.promise(() =>
                createReferenceLobby(baseUrl, mapId),
              );
              const twoClientParticipant = yield* Effect.promise(() =>
                joinReferenceLobby(baseUrl, twoClientOwner.joinCode, 'Grace'),
              );
              const twoClientOwnerSocket = yield* Effect.promise(() =>
                connectExternalWebSocket(twoClientOwner.wsUrl),
              );
              const twoClientParticipantSocket = yield* Effect.promise(() =>
                connectExternalWebSocket(twoClientParticipant.wsUrl),
              );
              sockets.push(twoClientOwnerSocket, twoClientParticipantSocket);
              for (const player of [twoClientOwner, twoClientParticipant]) {
                yield* Effect.promise(() =>
                  readyReferencePlayer(baseUrl, twoClientOwner.roomId, player),
                );
              }
              const twoClientStarted = yield* Effect.promise(() =>
                startReferenceLobby(baseUrl, twoClientOwner),
              );
              expect(twoClientStarted).toMatchObject({ phase: 'active', playerCount: 2 });
              const activeLobby = yield* Effect.promise(async () => {
                const response = await fetch(`${baseUrl}/lobbies/${twoClientOwner.roomId}`);
                expect(response.status).toBe(200);
                return (await response.json()) as {
                  readonly phase: string;
                  readonly playerCount: number;
                  readonly players: readonly { readonly ready: boolean; readonly status: string }[];
                };
              });
              expect(activeLobby).toMatchObject({ phase: 'active', playerCount: 2 });
              expect(activeLobby.players.map((player) => player.ready)).toEqual([true, true]);
              const twoClientResults = yield* Effect.promise(() =>
                driveBattleRoyaleGameplayToResults(
                  baseUrl,
                  twoClientOwnerSocket,
                  twoClientOwner.roomId,
                ),
              );
              expect(twoClientResults).toMatchObject({
                reason: 'match complete',
              });
              expect(twoClientResults.players).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({
                    playerId: twoClientOwner.playerId,
                    outcome: 'completed',
                  }),
                  expect.objectContaining({
                    playerId: twoClientParticipant.playerId,
                    outcome: 'completed',
                  }),
                ]),
              );
            } finally {
              for (const socket of sockets) {
                socket.close(1000, 'reference dogfood complete');
              }
              yield* Effect.promise(() => serve.stop());
            }
          }).pipe(Effect.provide(testLayer)),
        );
      }),
    180_000,
  );

  it('buildGame local ships deployment manifest without direct Wrangler deploy instructions', () =>
    withTempHome(async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Local Deployment Manifest Arena');
          yield* installShipModePlugin();
          const outDir = yield* Effect.promise(() =>
            mkdtemp(path.join(tmpdir(), 'tileborne-local-deploy-manifest-out-')),
          );
          const builds = yield* BuildService;
          const artifact = yield* builds.buildGame(
            new GameBuildOptions({
              pluginId: SHIP_PLUGIN_ID,
              target: 'local',
              outputDirectory: Option.some(outDir),
              assetPackIds: Option.none(),
              siteName: Option.none(),
              projectId: Option.some(projectId),
              mapIds: Option.none(),
            }),
          );

          expect(artifact.files).toContain('deployment.json');
          const deployment = JSON.parse(
            yield* Effect.promise(() => readFile(path.join(outDir, 'deployment.json'), 'utf8')),
          ) as {
            readonly defaultAdapter: string;
            readonly adapters: readonly { readonly id: string; readonly provider: string }[];
          };
          expect(deployment.defaultAdapter).toBe('local');
          expect(deployment.adapters).toContainEqual(
            expect.objectContaining({ id: 'alchemy-cloudflare', provider: 'cloudflare' }),
          );
          const readme = yield* Effect.promise(() =>
            readFile(path.join(outDir, 'README.md'), 'utf8'),
          );
          expect(readme).toContain('Deployment adapters are described in deployment.json');
          expect(readme).not.toContain('wrangler deploy');
        }).pipe(Effect.provide(testLayer)),
      );
    }));

  it(
    'reuses deterministic managed builds and rejects tampered or arbitrary artifacts',
    () =>
      withTempHome(async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const { projectId } = yield* seedProject('Managed Ship Arena');
            yield* installShipModePlugin();
            const builds = yield* BuildService;
            const options = new GameBuildOptions({
              pluginId: SHIP_PLUGIN_ID,
              target: 'local',
              outputDirectory: Option.none(),
              assetPackIds: Option.none(),
              siteName: Option.some('Unsafe " Arena\n[vars]'),
              projectId: Option.some(projectId),
              mapIds: Option.none(),
            });
            const first = yield* builds.buildGame(options);
            const repeat = yield* builds.buildGame(options);
            expect(repeat.directory).toBe(first.directory);
            expect(repeat.buildId).toBe(first.buildId);
            expect(repeat.fileHashes).toEqual(first.fileHashes);
            expect((yield* builds.verifyGameArtifact(repeat)).buildId).toBe(first.buildId);
            expect(
              gameArtifactBuildId({ target: 'cloudflare', fileHashes: first.fileHashes }),
            ).not.toBe(first.buildId);

            const differentSite = yield* builds.buildGame(
              new GameBuildOptions({
                ...options,
                siteName: Option.some('Managed Ship Arena Beta'),
              }),
            );
            expect(differentSite.runtimeBuildId).toBe(first.runtimeBuildId);
            expect(differentSite.buildId).not.toBe(first.buildId);
            expect(differentSite.directory).not.toBe(first.directory);
            expect(differentSite.fileHashes['wrangler.toml']).not.toBe(
              first.fileHashes['wrangler.toml'],
            );

            const gamesRoot = path.dirname(first.directory);
            for (const relativePath of first.files) {
              const bytes = yield* Effect.promise(() =>
                readFile(path.join(first.directory, relativePath)),
              );
              expect(bytes.includes(Buffer.from('.building-'))).toBe(false);
              expect(bytes.includes(Buffer.from(gamesRoot))).toBe(false);
            }

            const failedReplacement = yield* Effect.result(
              builds.buildGame(
                new GameBuildOptions({
                  ...options,
                  mapIds: Option.some(['map:00000000-0000-4000-8000-000000000099']),
                }),
              ),
            );
            expect(Result.isFailure(failedReplacement)).toBe(true);
            expect((yield* builds.verifyGameArtifact(first)).buildId).toBe(first.buildId);
            expect(
              (yield* Effect.promise(() => readdir(gamesRoot))).filter((entry) =>
                entry.includes('.building-'),
              ),
            ).toEqual([]);

            yield* Effect.promise(() => writeFile(repeat.bundlePath, 'tampered', 'utf8'));
            const tampered = yield* Effect.result(builds.verifyGameArtifact(repeat));
            expect(Result.isFailure(tampered)).toBe(true);
            const arbitrary = yield* Effect.result(builds.verifyGameArtifact(tmpdir()));
            expect(Result.isFailure(arbitrary)).toBe(true);
          }).pipe(Effect.provide(testLayer)),
        );
      }),
    180_000,
  );

  it(
    'rolls back a managed-root promotion failure, cleans residue, and retries',
    () =>
      withTempHome(async () => {
        let failFinalRename = false;
        const operations: BuildPromotionOperations = {
          rename: async (from, to) => {
            if (failFinalRename && from.includes('.building-')) {
              failFinalRename = false;
              throw new Error('injected final promotion rename failure');
            }
            await rename(from, to);
          },
          remove: (target) => rm(target, { recursive: true, force: true }),
        };
        const faultLayer = testLayerWithPromotion(operations);
        await Effect.runPromise(
          Effect.gen(function* () {
            const { projectId } = yield* seedProject('Promotion Transaction Arena');
            yield* installShipModePlugin();
            const home = yield* HomeService;
            const builds = yield* BuildService;
            const directory = path.join(home.paths.cache, 'builds', 'games', 'promotion-slot');
            const options = (siteName: string) =>
              new GameBuildOptions({
                pluginId: SHIP_PLUGIN_ID,
                target: 'local',
                outputDirectory: Option.some(directory),
                assetPackIds: Option.none(),
                siteName: Option.some(siteName),
                projectId: Option.some(projectId),
                mapIds: Option.none(),
              });

            const prior = yield* builds.buildGame(options('Promotion Arena Alpha'));
            yield* builds.verifyGameArtifact(prior);
            const metadataBefore = yield* Effect.promise(() =>
              readFile(path.join(directory, 'build-artifact.json')),
            );
            failFinalRename = true;
            const failed = yield* Effect.result(builds.buildGame(options('Promotion Arena Beta')));
            expect(Result.isFailure(failed)).toBe(true);
            expect(failFinalRename).toBe(false);
            expect((yield* builds.verifyGameArtifact(prior)).buildId).toBe(prior.buildId);
            expect(
              yield* Effect.promise(() => readFile(path.join(directory, 'build-artifact.json'))),
            ).toEqual(metadataBefore);
            expect(
              (yield* Effect.promise(() => readdir(path.dirname(directory)))).filter(
                (entry) => entry.includes('.building-') || entry.includes('.previous-'),
              ),
            ).toEqual([]);

            const retry = yield* builds.buildGame(options('Promotion Arena Beta'));
            expect(retry.buildId).not.toBe(prior.buildId);
            expect((yield* builds.verifyGameArtifact(retry)).buildId).toBe(retry.buildId);
            expect(
              (yield* Effect.promise(() => readdir(path.dirname(directory)))).filter(
                (entry) => entry.includes('.building-') || entry.includes('.previous-'),
              ),
            ).toEqual([]);
          }).pipe(Effect.provide(faultLayer)),
        );
      }),
    180_000,
  );

  it(
    'buildGame cloudflare --project fails fast when the selected map is not in the project',
    () =>
      withTempHome(async () => {
        const result = await Effect.runPromise(
          Effect.result(
            Effect.gen(function* () {
              const { projectId } = yield* seedProject('Ship Arena');
              yield* installShipModePlugin();
              const builds = yield* BuildService;
              return yield* builds.buildGame(
                new GameBuildOptions({
                  pluginId: SHIP_PLUGIN_ID,
                  target: 'cloudflare',
                  outputDirectory: Option.none(),
                  assetPackIds: Option.none(),
                  siteName: Option.none(),
                  projectId: Option.some(projectId),
                  mapIds: Option.some(['map:00000000-0000-4000-8000-00000000dead']),
                }),
              );
            }).pipe(Effect.provide(testLayer)),
          ),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(String((result.failure as { message?: string }).message)).toContain(
            'is not part of project',
          );
        }
      }),
    60_000,
  );

  it('detects manifest tampering on get', () =>
    withTempHome(async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const { projectId } = yield* seedProject('Arena');
            const artifact = yield* runBuild(projectId);
            const raw = JSON.parse(
              yield* Effect.promise(() => readFile(artifact.manifestPath, 'utf8')),
            ) as {
              project: { name: string };
            };
            raw.project.name = 'Tampered';
            yield* Effect.promise(() =>
              writeFile(artifact.manifestPath, JSON.stringify(raw), 'utf8'),
            );
            const builds = yield* BuildService;
            return yield* builds.getBuild(artifact.id);
          }).pipe(Effect.provide(testLayer)),
        ),
      ).rejects.toMatchObject({ _tag: 'IntegrityMismatchError' });
    }));

  it('publishes a trigger-only build event', () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const builds = yield* BuildService;
          const fiber = yield* builds.subscribe.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* runBuild(projectId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it('cancels a delayed build and proves the job reaches Cancelled', () =>
    withTempHome(async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const builds = yield* BuildService;
          const jobs = yield* JobService;
          const jobId = yield* builds.build(
            projectId,
            new BuildOptions({ target: Option.none(), delayMs: Option.some(60_000) }),
          );
          yield* Effect.sleep(20);
          const cancelled = yield* jobs.cancel(jobId);
          yield* waitForJob(jobId);
          return { cancelled: cancelled.status._tag };
        }).pipe(Effect.provide(testLayer)),
      );
      expect(result.cancelled).toBe('Cancelled');
    }));

  it('rejects symlink escape when BuildService reads a planted build entry', () =>
    withTempHome(async (home) => {
      // Plant a symlinked build directory under the canonical builds root whose target
      // escapes the home cache. Then call BuildService.getBuild through the real service
      // layer and assert the verifiedChildPath rejection surfaces as a ServicesBuildError.
      const buildsRoot = path.join(home, 'cache', 'builds');
      await mkdir(buildsRoot, { recursive: true });
      const outsideDir = path.join(home, 'outside-build');
      await mkdir(outsideDir, { recursive: true });
      await writeFile(path.join(outsideDir, metadataFileName), JSON.stringify({ leak: true }));
      const plantedId = makeNewBuildId();
      await symlink(outsideDir, path.join(buildsRoot, plantedId));
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const builds = yield* BuildService;
          return yield* builds.getBuild(plantedId).pipe(
            Effect.map(() => new Error('expected symlink rejection')),
            Effect.catch((cause) => Effect.succeed(cause)),
          );
        }).pipe(Effect.provide(testLayer)),
      );
      expect(error).toMatchObject({ _tag: 'ServicesBuildError' });
    }));

  it('deletes a build directory', () =>
    withTempHome(async () => {
      const remaining = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const artifact = yield* runBuild(projectId);
          const builds = yield* BuildService;
          yield* builds.deleteBuild(artifact.id);
          return yield* builds.listBuilds(projectId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(remaining).toHaveLength(0);
    }));
});

describe('ExportService', () => {
  it('exports a Cloudflare Worker target', () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new CloudflareWorkerExportTarget({ environment: Option.some('dev') }),
          );
          yield* waitForJob(jobId);
          return (yield* exports.listExports(build.id))[0];
        }).pipe(Effect.provide(testLayer)),
      );
      expect(artifact?.target._tag).toBe('CloudflareWorkerExportTarget');
    }));

  it('exports a Node target', () =>
    withTempHome(async () => {
      const targetTag = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new NodeExportTarget({ entrypoint: Option.some('server.js') }),
          );
          yield* waitForJob(jobId);
          return (yield* exports.listExports(build.id))[0]?.target._tag;
        }).pipe(Effect.provide(testLayer)),
      );
      expect(targetTag).toBe('NodeExportTarget');
    }));

  it('exports a Web target', () =>
    withTempHome(async () => {
      const targetTag = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.some('/play') }),
          );
          yield* waitForJob(jobId);
          return (yield* exports.listExports(build.id))[0]?.target._tag;
        }).pipe(Effect.provide(testLayer)),
      );
      expect(targetTag).toBe('WebExportTarget');
    }));

  it('reads an export by id', () =>
    withTempHome(async () => {
      const read = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.none() }),
          );
          yield* waitForJob(jobId);
          const [artifact] = yield* exports.listExports(build.id);
          if (!artifact) throw new Error('missing export');
          return yield* exports.getExport(artifact.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(read.id.startsWith('export:')).toBe(true);
    }));

  it('invokes export hooks through PluginLoaderService', () =>
    withTempHome(async () => {
      const invoked = await Effect.runPromise(
        Effect.gen(function* () {
          yield* installExportPlugin(`export default async () => "ok";`);
          const registry = yield* PluginRegistryService;
          yield* registry.discover();
          const projects = yield* ProjectService;
          const projectId = yield* projects.create({
            name: 'Export Plugin Project',
            plugins: [{ id: '@tileborne-plugins/export', version: '0.1.0' }],
          });
          const maps = yield* MapService;
          yield* maps.create(projectId, { width: 8, height: 8 });
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const loader = yield* PluginLoaderService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.none() }),
            new ExportOptions({ delayMs: Option.none() }),
          );
          yield* waitForJob(jobId);
          const loaded = yield* loader.listDeclarative();
          return {
            hooks: (yield* exports.listExports(build.id))[0]?.invokedHooks,
            loaderConsulted: loaded.some(
              (plugin) => plugin.pluginId === '@tileborne-plugins/export',
            ),
          };
        }).pipe(Effect.provide(testLayer)),
      );
      expect(invoked.hooks).toEqual(['export.mjs']);
      expect(invoked.loaderConsulted).toBe(true);
    }));

  it('publishes export events', () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const fiber = yield* exports.subscribe.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );
          const jobId = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.none() }),
          );
          yield* waitForJob(jobId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it('deletes an export', () =>
    withTempHome(async () => {
      const count = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.none() }),
          );
          yield* waitForJob(jobId);
          const [artifact] = yield* exports.listExports(build.id);
          if (!artifact) throw new Error('missing export');
          yield* exports.deleteExport(artifact.id);
          return (yield* exports.listExports(build.id)).length;
        }).pipe(Effect.provide(testLayer)),
      );
      expect(count).toBe(0);
    }));
});

describe('PlaytestService', () => {
  it('starts a session and reaches running', () =>
    withTempHome(async () => {
      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          const playtest = yield* PlaytestService;
          return yield* playtest.start(projectId, mapId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(session.status._tag).toBe('Running');
      expect(Option.isSome(session.artifactDirectory)).toBe(true);
    }));

  it('assembles artifact with the enabled battle royale plugin on start', () =>
    withTempHome(async (home) => {
      const pluginRoot = path.join(home, 'plugin-fixture');
      await mkdir(pluginRoot, { recursive: true });
      const manifest = Schema.decodeUnknownSync(PluginManifest)(
        materializePluginManifestInput({
          schemaVersion: 1,
          id: BATTLE_ROYALE_PLUGIN_ID,
          name: BATTLE_ROYALE_PLUGIN_ID,
          version: '0.0.1',
          displayName: 'CLI Playtest',
          description: 'Fixture plugin',
          author: 'Tileborne',
          license: 'MIT',
          engines: { tileborne: '^0.1.0' },
          entry: { editor: './node.js', runtime: './runtime.js' },
          permissions: [],
          dependsOn: [],
          contributes: {
            gameModes: [
              {
                _tag: 'GameModeContribution',
                id: 'battle-royale',
                kind: 'declarative',
                display: { label: 'Battle Royale' },
                runtimeSystemId: 'battle-royale-runtime',
              },
            ],
            runtime: {
              systems: [
                {
                  _tag: 'ExecutableRuntimeSystemContribution',
                  id: 'battle-royale-runtime',
                  kind: 'executable',
                  display: { label: 'Battle Royale Runtime Adapter' },
                  entry: './runtime.js',
                },
              ],
            },
          },
        }),
      );
      await writeFile(
        path.join(pluginRoot, 'tileborne-plugin.json'),
        `${JSON.stringify(Schema.encodeSync(PluginManifest)(manifest), null, 2)}\n`,
      );
      await writeFile(path.join(pluginRoot, 'node.js'), 'export {};\n');
      await writeFile(path.join(pluginRoot, 'runtime.js'), 'export {};\n');

      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          const installer = yield* PluginInstallerService;
          yield* installer.install(new LocalPluginSource({ path: pluginRoot }));
          const playtest = yield* PlaytestService;
          return yield* playtest.start(projectId, mapId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(session.activePlugins).toContain(BATTLE_ROYALE_PLUGIN_ID);
      const artifactDirectory = Option.getOrThrow(session.artifactDirectory);
      // The artifact scaffold never writes map.json: assembleRuntimeMapPackage
      // is the single writer of the package directory's map entry.
      expect(await fileExists(path.join(artifactDirectory, 'map.json'))).toBe(false);
      expect(await fileExists(path.join(artifactDirectory, 'index.html'))).toBe(true);
    }));

  it('assembles artifact with the selected active game mode plugin on start', () =>
    withTempHome(async () => {
      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          yield* installRuntimePlugin({
            pluginId: BATTLE_ROYALE_PLUGIN_ID,
            runtimeSystemId: 'battle-royale-runtime',
            runtimeLabel: 'Battle Royale Runtime Adapter',
          });
          yield* installRuntimePlugin({
            pluginId: EXAMPLE_ARENA_PLUGIN_ID,
            runtimeSystemId: 'arena-runtime',
            runtimeLabel: 'Example Arena Runtime Adapter',
          });
          const projects = yield* ProjectService;
          const project = yield* projects.open(projectId);
          yield* projects.save(
            new ProjectManifest({
              ...project,
              settings: {
                ...(project.settings ?? {}),
                activeGameMode: EXAMPLE_ARENA_PLUGIN_ID,
              },
            }),
          );
          const playtest = yield* PlaytestService;
          return yield* playtest.start(projectId, mapId);
        }).pipe(Effect.provide(testLayer)),
      );

      expect(session.activePlugins).toEqual([EXAMPLE_ARENA_PLUGIN_ID]);
    }));

  it('fails fast when multiple enabled game modes have no active selection', () =>
    withTempHome(async () => {
      const sessions = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          yield* installRuntimePlugin({
            pluginId: BATTLE_ROYALE_PLUGIN_ID,
            runtimeSystemId: 'battle-royale-runtime',
            runtimeLabel: 'Battle Royale Runtime Adapter',
          });
          yield* installRuntimePlugin({
            pluginId: EXAMPLE_ARENA_PLUGIN_ID,
            runtimeSystemId: 'arena-runtime',
            runtimeLabel: 'Example Arena Runtime Adapter',
          });
          const playtest = yield* PlaytestService;
          let failed = false;
          yield* playtest.start(projectId, mapId).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                failed = true;
                expect(error).toMatchObject({
                  _tag: 'ServicesBuildError',
                  message: expect.stringContaining('Multiple enabled game modes are available'),
                });
              }),
            ),
          );
          expect(failed).toBe(true);
          return yield* playtest.list();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(sessions).toHaveLength(0);
    }));

  it('fails fast when the selected active game mode is unavailable', () =>
    withTempHome(async () => {
      const sessions = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          yield* installRuntimePlugin({
            pluginId: BATTLE_ROYALE_PLUGIN_ID,
            runtimeSystemId: 'battle-royale-runtime',
            runtimeLabel: 'Battle Royale Runtime Adapter',
          });
          const projects = yield* ProjectService;
          const project = yield* projects.open(projectId);
          yield* projects.save(
            new ProjectManifest({
              ...project,
              settings: {
                ...(project.settings ?? {}),
                activeGameMode: EXAMPLE_ARENA_PLUGIN_ID,
              },
            }),
          );
          const playtest = yield* PlaytestService;
          let failed = false;
          yield* playtest.start(projectId, mapId).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                failed = true;
                expect(error).toMatchObject({
                  _tag: 'ServicesBuildError',
                  message: expect.stringContaining('Selected active game mode'),
                });
              }),
            ),
          );
          expect(failed).toBe(true);
          return yield* playtest.list();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(sessions).toHaveLength(0);
    }));

  it('stops a running session', () =>
    withTempHome(async () => {
      const stopped = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          const playtest = yield* PlaytestService;
          const session = yield* playtest.start(projectId, mapId);
          return yield* playtest.stop(session.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(stopped.status._tag).toBe('Stopped');
    }));

  it('lists sessions', () =>
    withTempHome(async () => {
      const sessions = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          const playtest = yield* PlaytestService;
          yield* playtest.start(projectId, mapId);
          return yield* playtest.list();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(sessions).toHaveLength(1);
    }));

  it('publishes start and running triggers', () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject('Arena');
          const playtest = yield* PlaytestService;
          const fiber = yield* playtest.subscribe.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* playtest.start(
            projectId,
            mapId,
            new PlaytestOptions({
              slot: Option.none(),
              runtimeUrl: Option.none(),
              delayMs: Option.none(),
            }),
          );
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it('fails to stop an unknown session', () =>
    withTempHome(async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const playtest = yield* PlaytestService;
            return yield* playtest.stop('playtest:00000000-0000-4000-8000-000000000000' as never);
          }).pipe(Effect.provide(testLayer)),
        ),
      ).rejects.toMatchObject({ _tag: 'PlaytestSessionNotFoundError' });
    }));
});

describe('RuntimeDeployService', () => {
  it('uses the local adapter by default for local deployments without credentials', () =>
    withTempHome(async () => {
      const calls: RuntimeDeployCall[] = [];
      const deployment = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'local',
              workerName: 'tileborne-local',
              credentials: Option.none(),
            }),
          );
          yield* waitForJob(jobId);
          return (yield* deploy.listDeployments(build.id))[0];
        }).pipe(Effect.provide(deployTestLayer(calls))),
      );
      expect(deployment?.target).toMatchObject({
        adapterId: 'local',
        stage: 'local',
        workerName: 'tileborne-local',
      });
      expect(deployment?.endpoint).toBe('http://local.example/deploy/tileborne-local');
      expect(calls).toContainEqual(
        expect.objectContaining({ provider: 'local', operation: 'deploy' }),
      );
    }));

  it('deploys a build with credentials', () =>
    withTempHome(async () => {
      const calls: RuntimeDeployCall[] = [];
      const deployment = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'dev',
              workerName: 'tileborne-test',
              credentials: Option.some(
                new RuntimeDeployCredentials({ accountId: 'acct', apiToken: 'token' }),
              ),
            }),
          );
          yield* waitForJob(jobId);
          return (yield* deploy.listDeployments(build.id))[0];
        }).pipe(Effect.provide(deployTestLayer(calls))),
      );
      expect(deployment?.endpoint).toContain('tileborne-test');
      expect(deployment?.target).toMatchObject({ adapterId: 'alchemy-cloudflare' });
      expect(calls).toContainEqual(
        expect.objectContaining({
          provider: 'alchemy-cloudflare',
          operation: 'deploy',
          apiToken: 'token',
        }),
      );
    }));

  it('deploys through an OAuth profile credential without requiring an API token', () =>
    withTempHome(async () => {
      const calls: RuntimeDeployCall[] = [];
      const deployment = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.some('alchemy-cloudflare'),
              stage: 'dev',
              workerName: 'tileborne-oauth',
              credentials: Option.none(),
            }),
          );
          yield* waitForJob(jobId);
          return (yield* deploy.listDeployments(build.id))[0];
        }).pipe(
          Effect.provide(
            deployTestLayer(calls, {
              credentialResolver: () =>
                Option.some(
                  new RuntimeDeployCredentials({
                    accountId: 'alchemy-profile:office',
                    apiToken: '',
                    profile: 'office',
                  }),
                ),
            }),
          ),
        ),
      );

      expect(deployment?.target).toMatchObject({
        adapterId: 'alchemy-cloudflare',
        workerName: 'tileborne-oauth',
      });
      expect(calls).toContainEqual(
        expect.objectContaining({
          provider: 'alchemy-cloudflare',
          operation: 'deploy',
          apiToken: '',
          profile: 'office',
        }),
      );
    }));

  it('never persists deployment credentials in deployment metadata', () =>
    withTempHome(async () => {
      const persisted = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'dev',
              workerName: 'tileborne-test',
              credentials: Option.some(
                new RuntimeDeployCredentials({
                  accountId: 'acct-secret',
                  apiToken: 'token-secret',
                }),
              ),
            }),
          );
          yield* waitForJob(jobId);
          const [deployment] = yield* deploy.listDeployments(build.id);
          if (!deployment) throw new Error('missing deployment');
          return yield* Effect.promise(() => readFile(deployment.manifestPath, 'utf8'));
        }).pipe(Effect.provide(deployTestLayer())),
      );
      expect(persisted).not.toContain('acct-secret');
      expect(persisted).not.toContain('token-secret');
      expect(persisted).not.toContain('credentials');
      expect(persisted).toContain('"adapterId": "alchemy-cloudflare"');
    }));

  it('redacts provider credential values from typed adapter errors for every operation', async () => {
    const adapter = createAlchemyCloudflareDeploymentAdapter(async () => {
      throw new Error('provider rejected CLOUDFLARE_API_TOKEN=token-secret for acct-secret');
    });
    const context = {
      buildId: makeNewBuildId(),
      artifactDirectory: '/tmp/tileborne-artifact',
      target: new RuntimeDeployTarget({
        adapterId: Option.some('alchemy-cloudflare'),
        stage: 'staging',
        workerName: 'tileborne-test',
        credentials: Option.some(
          new RuntimeDeployCredentials({
            accountId: 'acct-secret',
            apiToken: 'token-secret',
          }),
        ),
      }),
    };

    for (const operation of ['plan', 'preview', 'deploy', 'status', 'logs', 'destroy'] as const) {
      await expect(Effect.runPromise(adapter[operation](context))).rejects.toMatchObject({
        _tag: 'RuntimeDeployOperationError',
        operation,
        adapterId: 'alchemy-cloudflare',
        code: 'adapter_operation_failed',
        message: expect.not.stringContaining('token-secret'),
      } satisfies Partial<RuntimeDeployOperationError>);
    }
  });

  it('redacts provider credential values from successful adapter logs', async () => {
    const adapter = createAlchemyCloudflareDeploymentAdapter(async (input) =>
      runtimeDeploymentOperationResult('https://provider.example/game-host', 'deployed', [
        `created game-host with ${input.credentials.accountId}`,
        `created behavior worker with ${input.credentials.apiToken}`,
        `provider profile ${input.credentials.profile ?? 'none'}`,
      ]),
    );
    const result = await Effect.runPromise(
      adapter.deploy({
        buildId: makeNewBuildId(),
        artifactDirectory: '/tmp/tileborne-artifact',
        target: new RuntimeDeployTarget({
          adapterId: Option.some('alchemy-cloudflare'),
          stage: 'dev',
          workerName: 'tileborne-test',
          credentials: Option.some(
            new RuntimeDeployCredentials({
              accountId: 'acct-secret',
              apiToken: 'token-secret',
              profile: 'office-profile',
            }),
          ),
        }),
      }),
    );

    expect(result.logs.join('\n')).not.toContain('acct-secret');
    expect(result.logs.join('\n')).not.toContain('token-secret');
    expect(result.logs.join('\n')).not.toContain('office-profile');
    expect(result.logs.join('\n')).toContain('[redacted]');
  });

  it('production Alchemy executor sends complete graph inputs outside the artifact without leaking secrets in results', async () => {
    const previousPassword = process.env.ALCHEMY_PASSWORD;
    const previousSigningKey = process.env.HANDOFF_SIGNING_KEY;
    process.env.ALCHEMY_PASSWORD = 'alchemy-password-secret';
    process.env.HANDOFF_SIGNING_KEY = 'handoff-signing-key-secret-32chars-min';
    const calls: Parameters<
      NonNullable<Parameters<typeof createProductionAlchemyCloudflareExecutor>[0]>
    >[0][] = [];
    try {
      const executor = createProductionAlchemyCloudflareExecutor(async (input) => {
        calls.push(input);
        return runtimeDeploymentOperationResult(
          'https://provider.example/game-host',
          operationStatus(input.operation),
          [
            `worker ${path.join(input.artifactDirectory, 'worker.js')}`,
            `behavior ${path.join(input.artifactDirectory, 'behavior-worker.js')}`,
          ],
        );
      });
      const result = await executor({
        operation: 'deploy',
        artifactDirectory: '/tmp/tileborne-artifact',
        workerName: 'tileborne-test',
        stage: 'staging',
        credentials: new RuntimeDeployCredentials({
          accountId: 'acct-secret',
          apiToken: 'token-secret',
        }),
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.stateDirectory).not.toContain('/tmp/tileborne-artifact');
      expect(calls[0]).toMatchObject({
        operation: 'deploy',
        artifactDirectory: '/tmp/tileborne-artifact',
        workerName: 'tileborne-test',
        stage: 'staging',
        handoffSigningKey: 'handoff-signing-key-secret-32chars-min',
        alchemyPassword: 'alchemy-password-secret',
      });
      expect(result.logs.join('\n')).toContain('behavior-worker.js');
      expect(result.logs.join('\n')).not.toContain('token-secret');
      expect(result.logs.join('\n')).not.toContain('handoff-signing-key-secret');
      expect(result.logs.join('\n')).not.toContain('alchemy-password-secret');
    } finally {
      if (previousPassword === undefined) delete process.env.ALCHEMY_PASSWORD;
      else process.env.ALCHEMY_PASSWORD = previousPassword;
      if (previousSigningKey === undefined) delete process.env.HANDOFF_SIGNING_KEY;
      else process.env.HANDOFF_SIGNING_KEY = previousSigningKey;
    }
  });

  it('production Alchemy executor reuses stable state for deployment lifecycle and removes it after destroy', async () => {
    const previousPassword = process.env.ALCHEMY_PASSWORD;
    const previousSigningKey = process.env.HANDOFF_SIGNING_KEY;
    process.env.ALCHEMY_PASSWORD = 'alchemy-password-secret';
    process.env.HANDOFF_SIGNING_KEY = 'handoff-signing-key-secret-32chars-min';
    const calls: Parameters<
      NonNullable<Parameters<typeof createProductionAlchemyCloudflareExecutor>[0]>
    >[0][] = [];
    try {
      const executor = createProductionAlchemyCloudflareExecutor(async (input) => {
        calls.push(input);
        return runtimeDeploymentOperationResult(
          `https://provider.example/${input.operation}`,
          operationStatus(input.operation),
          [`provider ${input.operation}`],
        );
      });
      const base = {
        artifactDirectory: '/tmp/tileborne-artifact',
        workerName: 'stable-worker',
        stage: 'staging' as const,
        credentials: new RuntimeDeployCredentials({
          accountId: 'acct-secret',
          apiToken: 'token-secret',
        }),
      };
      await executor({ ...base, operation: 'deploy' });
      await executor({ ...base, operation: 'destroy' });

      expect(calls.map((call) => call.operation)).toEqual(['deploy', 'destroy']);
      expect(calls[0]?.stateDirectory).toBe(calls[1]?.stateDirectory);
      if (calls[0]?.stateDirectory) {
        await expect(access(calls[0].stateDirectory)).rejects.toThrow();
      }
    } finally {
      if (previousPassword === undefined) delete process.env.ALCHEMY_PASSWORD;
      else process.env.ALCHEMY_PASSWORD = previousPassword;
      if (previousSigningKey === undefined) delete process.env.HANDOFF_SIGNING_KEY;
      else process.env.HANDOFF_SIGNING_KEY = previousSigningKey;
    }
  });

  it('production Alchemy executor serializes first-create and redeploy for the same target', async () => {
    const calls: Array<{
      readonly operation: RuntimeDeployOperation;
      readonly stateDirectory: string;
      readonly phase: 'start' | 'end';
    }> = [];
    const executor = createProductionAlchemyCloudflareExecutor(async (input) => {
      calls.push({
        operation: input.operation,
        stateDirectory: input.stateDirectory,
        phase: 'start',
      });
      await new Promise((resolve) => setTimeout(resolve, input.operation === 'deploy' ? 10 : 0));
      calls.push({
        operation: input.operation,
        stateDirectory: input.stateDirectory,
        phase: 'end',
      });
      return runtimeDeploymentOperationResult(
        `https://provider.example/${input.operation}`,
        operationStatus(input.operation),
        [`provider ${input.operation}`],
      );
    });
    const base = {
      artifactDirectory: '/tmp/tileborne-artifact',
      workerName: 'same-worker',
      stage: 'dev' as const,
      credentials: new RuntimeDeployCredentials({
        accountId: 'acct-secret',
        apiToken: 'token-secret',
      }),
    };

    await Promise.all([
      executor({ ...base, operation: 'deploy' }),
      executor({ ...base, operation: 'deploy' }),
    ]);

    expect(calls.map((call) => `${call.operation}:${call.phase}`)).toEqual([
      'deploy:start',
      'deploy:end',
      'deploy:start',
      'deploy:end',
    ]);
    expect(new Set(calls.map((call) => call.stateDirectory)).size).toBe(1);
  });

  it('production Alchemy executor preserves state when destroy does not confirm cleanup', async () => {
    const previousPassword = process.env.ALCHEMY_PASSWORD;
    const previousSigningKey = process.env.HANDOFF_SIGNING_KEY;
    process.env.ALCHEMY_PASSWORD = 'alchemy-password-secret';
    process.env.HANDOFF_SIGNING_KEY = 'handoff-signing-key-secret-32chars-min';
    let destroyStateDirectory: string | undefined;
    try {
      const executor = createProductionAlchemyCloudflareExecutor(async (input) => {
        if (input.operation === 'destroy') {
          destroyStateDirectory = input.stateDirectory;
          return runtimeDeploymentOperationResult(
            'https://provider.example/not-destroyed',
            'running',
            ['destroy still running'],
          );
        }
        return runtimeDeploymentOperationResult(
          'https://provider.example/deployed',
          operationStatus(input.operation),
          [],
        );
      });
      const base = {
        artifactDirectory: '/tmp/tileborne-artifact',
        workerName: 'cleanup-worker',
        stage: 'staging' as const,
        credentials: new RuntimeDeployCredentials({
          accountId: 'acct-secret',
          apiToken: 'token-secret',
        }),
      };

      await expect(executor({ ...base, operation: 'destroy' })).rejects.toThrow(
        'Cloudflare destroy did not confirm cleanup: running',
      );
      if (destroyStateDirectory === undefined) throw new Error('missing destroy state directory');
      await expect(access(destroyStateDirectory)).resolves.toBeUndefined();
    } finally {
      if (destroyStateDirectory !== undefined) {
        await rm(destroyStateDirectory, { recursive: true, force: true });
      }
      if (previousPassword === undefined) delete process.env.ALCHEMY_PASSWORD;
      else process.env.ALCHEMY_PASSWORD = previousPassword;
      if (previousSigningKey === undefined) delete process.env.HANDOFF_SIGNING_KEY;
      else process.env.HANDOFF_SIGNING_KEY = previousSigningKey;
    }
  });

  it('recovers a partial first-create after missing Worker settings and keeps cleanup retryable', async () => {
    const previousPassword = process.env.ALCHEMY_PASSWORD;
    const previousSigningKey = process.env.HANDOFF_SIGNING_KEY;
    const previousFailPartial = process.env.TILEBORNE_FIXTURE_FAIL_PARTIAL;
    const previousFailDestroy = process.env.TILEBORNE_FIXTURE_FAIL_DESTROY;
    const previousControlPath = process.env.TILEBORNE_FIXTURE_CONTROL_PATH;
    process.env.ALCHEMY_PASSWORD = 'alchemy-password-secret';
    process.env.HANDOFF_SIGNING_KEY = 'handoff-signing-key-secret-32chars-min';
    process.env.TILEBORNE_FIXTURE_FAIL_PARTIAL = '1';
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-alchemy-partial-fixture-'));
    const controlPath = path.join(fixtureRoot, 'control.json');
    process.env.TILEBORNE_FIXTURE_CONTROL_PATH = controlPath;
    let retainedStateDirectory: string | undefined;
    try {
      const stackEntrypoint = path.join(fixtureRoot, 'alchemy-cloudflare-stack.js');
      const execEntrypoint = path.join(fixtureRoot, 'alchemy-exec.js');
      await writeFile(stackEntrypoint, 'export default "partial-lifecycle-fixture";\n');
      await writeFile(
        execEntrypoint,
        `
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = JSON.parse(process.env.TILEBORNE_ALCHEMY_INPUT);
const args = process.argv.slice(2);
const execOptions = {
  adopt: args.includes('--adopt'),
  destroy: args[0] === 'destroy',
  dryRun: args.includes('--dry-run')
};
const emitResult = (result) => {
  process.stdout.write('human-readable alchemy output\\n');
  process.stdout.write('TILEBORNE_ALCHEMY_RESULT_JSON=' + JSON.stringify(result) + '\\n');
};
const statePath = path.join(process.cwd(), 'resource-state.json');
const controlPath = process.env.TILEBORNE_FIXTURE_CONTROL_PATH;
const readState = async () => {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return { events: [], resources: {} };
  }
};
const state = await readState();
state.events.push({
  operation: input.operation,
  adopt: execOptions.adopt,
  destroy: execOptions.destroy,
  dryRun: execOptions.dryRun,
});
if (controlPath) {
  await writeFile(controlPath, JSON.stringify({ stateDirectory: process.cwd() }));
}
if (input.operation === 'destroy') {
  if (process.env.TILEBORNE_FIXTURE_FAIL_DESTROY === '1' && !state.destroyFailed) {
    state.destroyFailed = true;
    state.events.push({ phase: 'destroy-worker-settings', status: 404, body: 'missing Worker/settings' });
    await writeFile(statePath, JSON.stringify(state, null, 2));
    throw new Error('Cloudflare destroy Worker/settings returned non-JSON 404 for acct-secret CLOUDFLARE_API_TOKEN=token-secret');
  }
  state.resources = {};
  state.events.push({ phase: 'destroy-converged' });
  await writeFile(statePath, JSON.stringify(state, null, 2));
  emitResult({
    endpoint: '',
    status: 'destroyed',
    logs: ['destroy converged']
  });
  process.exit(0);
}
if (input.operation !== 'deploy') {
  emitResult({ endpoint: '', status: 'planned', logs: [] });
  process.exit(0);
}
if (process.env.TILEBORNE_FIXTURE_FAIL_PARTIAL === '1' && !state.partialFailed) {
  state.partialFailed = true;
  state.resources.behaviorWorker = {
    type: 'worker',
    name: input.workerName + '-behaviors',
    main: input.behaviorWorkerPath
  };
  state.events.push({ phase: 'first-create-worker-settings', status: 404, body: 'missing Worker/settings' });
  await writeFile(statePath, JSON.stringify(state, null, 2));
  throw new Error('Cloudflare game-host Worker/settings returned non-JSON 404 for acct-secret CLOUDFLARE_API_TOKEN=token-secret');
}
if (state.resources.behaviorWorker && execOptions.adopt !== true) {
  throw new Error('expected adopt=true when reconciling pre-created behavior Worker');
}
state.resources.behaviorWorker = {
  type: 'worker',
  name: input.workerName + '-behaviors',
  main: input.behaviorWorkerPath
};
state.resources.playtestRoom = {
  type: 'durable_object_namespace',
  className: 'PlaytestRoom'
};
state.resources.gameHost = {
  type: 'worker',
  name: input.workerName,
  main: input.workerPath,
  bindings: {
    PLAYTEST_ROOM: 'playtest-room',
    BEHAVIOR_RUNTIME: state.resources.behaviorWorker.name,
    HANDOFF_SIGNING_KEY: '[encrypted]'
  }
};
state.events.push({ phase: 'adopt-redeploy-converged', adoptedExistingBehavior: true });
await writeFile(statePath, JSON.stringify(state, null, 2));
emitResult({
  endpoint: 'https://provider.example/' + input.workerName,
  status: 'deployed',
  logs: ['adopted existing behavior Worker and converged game host']
});
`,
      );

      const runner = createNodeAlchemyCloudflareRunner(undefined, stackEntrypoint, execEntrypoint);
      const executor = createProductionAlchemyCloudflareExecutor(runner);
      const adapter = createAlchemyCloudflareDeploymentAdapter(executor);
      const context = {
        buildId: makeNewBuildId(),
        artifactDirectory: '/tmp/tileborne-artifact',
        target: new RuntimeDeployTarget({
          adapterId: Option.some('alchemy-cloudflare'),
          stage: 'staging',
          workerName: 'partial-worker',
          credentials: Option.some(
            new RuntimeDeployCredentials({
              accountId: 'acct-secret',
              apiToken: 'token-secret',
            }),
          ),
        }),
      };

      const failedDeploy = await Effect.runPromise(Effect.result(adapter.deploy(context)));
      expect(Result.isFailure(failedDeploy)).toBe(true);
      if (Result.isFailure(failedDeploy)) {
        expect(failedDeploy.failure.message).toContain('non-JSON 404');
        expect(failedDeploy.failure.message).not.toContain('acct-secret');
        expect(failedDeploy.failure.message).not.toContain('token-secret');
      }
      const control = JSON.parse(await readFile(controlPath, 'utf8')) as {
        readonly stateDirectory: string;
      };
      retainedStateDirectory = control.stateDirectory;
      const partialStatePath = path.join(retainedStateDirectory, 'resource-state.json');
      const partialState = JSON.parse(await readFile(partialStatePath, 'utf8')) as {
        readonly events: readonly { readonly phase?: string; readonly status?: number }[];
        readonly resources: Record<string, unknown>;
      };
      expect(partialState.events).toContainEqual(
        expect.objectContaining({ phase: 'first-create-worker-settings', status: 404 }),
      );
      expect(partialState.resources).toHaveProperty('behaviorWorker');
      expect(partialState.resources).not.toHaveProperty('gameHost');

      delete process.env.TILEBORNE_FIXTURE_FAIL_PARTIAL;
      const redeployed = await Effect.runPromise(adapter.deploy(context));
      expect(redeployed).toMatchObject({
        endpoint: 'https://provider.example/partial-worker',
        status: 'deployed',
      });
      const convergedState = JSON.parse(await readFile(partialStatePath, 'utf8')) as {
        readonly events: readonly {
          readonly operation?: string;
          readonly adopt?: boolean;
          readonly phase?: string;
        }[];
        readonly resources: Record<string, { readonly bindings?: Record<string, string> }>;
      };
      expect(convergedState.events).toContainEqual(
        expect.objectContaining({ operation: 'deploy', adopt: true }),
      );
      expect(convergedState.events).toContainEqual(
        expect.objectContaining({ phase: 'adopt-redeploy-converged' }),
      );
      expect(convergedState.resources).toHaveProperty('behaviorWorker');
      expect(convergedState.resources).toHaveProperty('playtestRoom');
      expect(convergedState.resources.gameHost?.bindings).toMatchObject({
        PLAYTEST_ROOM: 'playtest-room',
        BEHAVIOR_RUNTIME: 'partial-worker-behaviors',
        HANDOFF_SIGNING_KEY: '[encrypted]',
      });

      process.env.TILEBORNE_FIXTURE_FAIL_DESTROY = '1';
      const failedDestroy = await Effect.runPromise(Effect.result(adapter.destroy(context)));
      expect(Result.isFailure(failedDestroy)).toBe(true);
      if (Result.isFailure(failedDestroy)) {
        expect(failedDestroy.failure.message).toContain('non-JSON 404');
        expect(failedDestroy.failure.message).not.toContain('acct-secret');
        expect(failedDestroy.failure.message).not.toContain('token-secret');
      }
      await expect(access(retainedStateDirectory)).resolves.toBeUndefined();
      delete process.env.TILEBORNE_FIXTURE_FAIL_DESTROY;
      await expect(Effect.runPromise(adapter.destroy(context))).resolves.toMatchObject({
        status: 'destroyed',
      });
      await expect(access(retainedStateDirectory)).rejects.toThrow();
      await expect(Effect.runPromise(adapter.destroy(context))).resolves.toMatchObject({
        status: 'destroyed',
      });
    } finally {
      if (retainedStateDirectory !== undefined) {
        await rm(retainedStateDirectory, { recursive: true, force: true });
      }
      await rm(fixtureRoot, { recursive: true, force: true });
      if (previousPassword === undefined) delete process.env.ALCHEMY_PASSWORD;
      else process.env.ALCHEMY_PASSWORD = previousPassword;
      if (previousSigningKey === undefined) delete process.env.HANDOFF_SIGNING_KEY;
      else process.env.HANDOFF_SIGNING_KEY = previousSigningKey;
      if (previousFailPartial === undefined) delete process.env.TILEBORNE_FIXTURE_FAIL_PARTIAL;
      else process.env.TILEBORNE_FIXTURE_FAIL_PARTIAL = previousFailPartial;
      if (previousFailDestroy === undefined) delete process.env.TILEBORNE_FIXTURE_FAIL_DESTROY;
      else process.env.TILEBORNE_FIXTURE_FAIL_DESTROY = previousFailDestroy;
      if (previousControlPath === undefined) delete process.env.TILEBORNE_FIXTURE_CONTROL_PATH;
      else process.env.TILEBORNE_FIXTURE_CONTROL_PATH = previousControlPath;
    }
  });

  it('production Alchemy state identity is account-safe and collision-resistant', async () => {
    const calls: Parameters<
      NonNullable<Parameters<typeof createProductionAlchemyCloudflareExecutor>[0]>
    >[0][] = [];
    const executor = createProductionAlchemyCloudflareExecutor(async (input) => {
      calls.push(input);
      return runtimeDeploymentOperationResult(
        `https://provider.example/${input.workerName}`,
        operationStatus(input.operation),
        [],
      );
    });

    await Promise.all([
      executor({
        operation: 'deploy',
        artifactDirectory: '/tmp/account-a',
        workerName: 'shared',
        stage: 'dev',
        credentials: new RuntimeDeployCredentials({ accountId: 'account-a', apiToken: 'token-a' }),
      }),
      executor({
        operation: 'deploy',
        artifactDirectory: '/tmp/account-b',
        workerName: 'shared',
        stage: 'dev',
        credentials: new RuntimeDeployCredentials({ accountId: 'account-b', apiToken: 'token-b' }),
      }),
      executor({
        operation: 'deploy',
        artifactDirectory: '/tmp/long-a',
        workerName: `${'same-prefix'.repeat(8)}-a`,
        stage: 'dev',
        credentials: new RuntimeDeployCredentials({ accountId: 'account-a', apiToken: 'token-a' }),
      }),
      executor({
        operation: 'deploy',
        artifactDirectory: '/tmp/long-b',
        workerName: `${'same-prefix'.repeat(8)}-b`,
        stage: 'dev',
        credentials: new RuntimeDeployCredentials({ accountId: 'account-a', apiToken: 'token-a' }),
      }),
    ]);

    const directories = calls.map((call) => call.stateDirectory);
    expect(new Set(directories).size).toBe(directories.length);
    expect(directories.join('\n')).not.toContain('account-a');
    expect(directories.join('\n')).not.toContain('account-b');
    expect(directories.join('\n')).not.toContain('token-a');
    expect(directories.join('\n')).not.toContain('token-b');
  });

  it('production Alchemy executor rejects custom development handoff keys without encryption', async () => {
    const previousPassword = process.env.ALCHEMY_PASSWORD;
    const previousFallbackPassword = process.env.PASSWORD;
    const previousSigningKey = process.env.HANDOFF_SIGNING_KEY;
    delete process.env.ALCHEMY_PASSWORD;
    delete process.env.PASSWORD;
    process.env.HANDOFF_SIGNING_KEY = 'custom-dev-handoff-key-secret-32chars-min';
    try {
      const executor = createProductionAlchemyCloudflareExecutor(async () =>
        runtimeDeploymentOperationResult('https://provider.example', 'deployed', []),
      );
      await expect(
        executor({
          operation: 'deploy',
          artifactDirectory: '/tmp/tileborne-artifact',
          workerName: 'dev-worker',
          stage: 'dev',
          credentials: new RuntimeDeployCredentials({
            accountId: 'acct-secret',
            apiToken: 'token-secret',
          }),
        }),
      ).rejects.toThrow('ALCHEMY_PASSWORD is required when HANDOFF_SIGNING_KEY is provided');
    } finally {
      if (previousPassword === undefined) delete process.env.ALCHEMY_PASSWORD;
      else process.env.ALCHEMY_PASSWORD = previousPassword;
      if (previousFallbackPassword === undefined) delete process.env.PASSWORD;
      else process.env.PASSWORD = previousFallbackPassword;
      if (previousSigningKey === undefined) delete process.env.HANDOFF_SIGNING_KEY;
      else process.env.HANDOFF_SIGNING_KEY = previousSigningKey;
    }
  });

  it('node Alchemy sidecar sets Electron node mode for packaged desktop invocation', () => {
    const env = buildNodeAlchemyRunnerEnv(
      {
        operation: 'deploy',
        artifactDirectory: '/tmp/tileborne-artifact',
        workerName: 'electron-worker',
        stage: 'dev',
        stateDirectory: '/tmp/tileborne-state',
        handoffSigningKey: 'handoff-signing-key-secret-32chars-min',
        credentials: new RuntimeDeployCredentials({
          accountId: 'acct-secret',
          apiToken: 'token-secret',
        }),
      },
      { operation: 'deploy' },
      {},
      true,
    );

    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(env.TILEBORNE_ALCHEMY_INPUT).not.toContain('token-secret');
    expect(env.TILEBORNE_ALCHEMY_INPUT).not.toContain('handoff-signing-key-secret');
  });

  it('node Alchemy runner invokes the committed stack entrypoint as a separate process', async () => {
    const calls: Array<{ file: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const runner = createNodeAlchemyCloudflareRunner(
      async (file, args, options) => {
        calls.push({ file, args, env: options?.env });
        return {
          stdout: '',
          stderr: '',
        };
      },
      '/tmp/tileborne-services-build/alchemy-cloudflare-stack.js',
      '/tmp/tileborne-services-build/alchemy-exec.js',
    );

    await runner({
      operation: 'deploy',
      artifactDirectory: '/tmp/tileborne-artifact',
      workerName: 'entrypoint-worker',
      stage: 'dev',
      stateDirectory: '/tmp/tileborne-state',
      handoffSigningKey: 'handoff-signing-key-secret-32chars-min',
      credentials: new RuntimeDeployCredentials({
        accountId: 'acct-secret',
        apiToken: 'token-secret',
      }),
    });

    expect(defaultAlchemyCloudflareStackEntrypoint()).toMatch(/alchemy-cloudflare-stack\.js$/);
    expect(defaultAlchemyExecEntrypoint()).toMatch(/alchemy\.js$/);
    expect(calls[0]?.file).toBe(process.execPath);
    expect(calls[0]?.args).toEqual([
      '/tmp/tileborne-services-build/alchemy-exec.js',
      'deploy',
      '--stage',
      'dev',
      '--yes',
      '--adopt',
      '/tmp/tileborne-services-build/alchemy-cloudflare-stack.js',
    ]);
    expect(calls[0]?.env?.TILEBORNE_ALCHEMY_INPUT).not.toContain('token-secret');
    expect(calls[0]?.env?.TILEBORNE_ALCHEMY_INPUT).not.toContain('handoff-signing-key-secret');
    expect(calls[0]?.env?.ALCHEMY_EXEC_OPTIONS).toBeUndefined();
    expect(calls[0]?.env?.ALCHEMY_NO_TUI).toBe('1');
  });

  it('node Alchemy runner falls back to the requested operation status without machine output', async () => {
    const runner = createNodeAlchemyCloudflareRunner(
      async (_file, _args, _options) => ({ stdout: 'Alchemy planned human output\n', stderr: '' }),
      '/tmp/tileborne-services-build/alchemy-cloudflare-stack.js',
      '/tmp/tileborne-services-build/alchemy-exec.js',
    );

    for (const operation of ['plan', 'deploy', 'destroy'] as const) {
      const result = await runner({
        operation,
        artifactDirectory: '/tmp/tileborne-artifact',
        workerName: `fallback-${operation}`,
        stage: 'dev',
        stateDirectory: await mkdtemp(path.join(tmpdir(), 'tileborne-alchemy-fallback-')),
        handoffSigningKey: 'handoff-signing-key-secret-32chars-min',
        credentials: new RuntimeDeployCredentials({
          accountId: 'acct-secret',
          apiToken: 'token-secret',
        }),
      });

      expect(result).toMatchObject({
        endpoint: '',
        status: operationStatus(operation),
      });
    }
  });

  it('node Alchemy runner invokes an OAuth profile sidecar without token env or secret payload leakage', async () => {
    const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const runner = createNodeAlchemyCloudflareRunner(
      async (_file, args, options) => {
        calls.push({ args, env: options?.env });
        return { stdout: '', stderr: '' };
      },
      '/tmp/tileborne-services-build/alchemy-cloudflare-stack.js',
      '/tmp/tileborne-services-build/alchemy-exec.js',
    );

    await runner({
      operation: 'deploy',
      artifactDirectory: '/tmp/tileborne-artifact',
      workerName: 'oauth-worker',
      stage: 'dev',
      stateDirectory: '/tmp/tileborne-state',
      handoffSigningKey: 'handoff-signing-key-secret-32chars-min',
      credentials: new RuntimeDeployCredentials({
        accountId: 'alchemy-profile:office-profile',
        apiToken: '',
        profile: 'office-profile',
      }),
    });

    const env = calls[0]?.env ?? {};
    const inputPayload = env.TILEBORNE_ALCHEMY_INPUT ?? '';

    expect(env.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(env.ALCHEMY_EXEC_OPTIONS).toBeUndefined();
    expect(inputPayload).not.toContain('office-profile');
    expect(inputPayload).not.toContain('alchemy-profile:office-profile');
    expect(inputPayload).not.toContain('handoff-signing-key-secret');
    expect(calls[0]?.args).toContain('--profile');
    expect(calls[0]?.args).toContain('office-profile');
  });

  it('node Alchemy sidecar disables adoption for destroy operations', async () => {
    const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const runner = createNodeAlchemyCloudflareRunner(
      async (_file, args, options) => {
        calls.push({ args, env: options?.env });
        return { stdout: '', stderr: '' };
      },
      '/tmp/tileborne-services-build/alchemy-cloudflare-stack.js',
      '/tmp/tileborne-services-build/alchemy-exec.js',
    );

    await runner({
      operation: 'destroy',
      artifactDirectory: '/tmp/tileborne-artifact',
      workerName: 'entrypoint-worker',
      stage: 'dev',
      stateDirectory: '/tmp/tileborne-state',
      handoffSigningKey: 'handoff-signing-key-secret-32chars-min',
      credentials: new RuntimeDeployCredentials({
        accountId: 'acct-secret',
        apiToken: 'token-secret',
      }),
    });

    expect(calls[0]?.args).toEqual([
      '/tmp/tileborne-services-build/alchemy-exec.js',
      'destroy',
      '--stage',
      'dev',
      '--yes',
      '/tmp/tileborne-services-build/alchemy-cloudflare-stack.js',
    ]);
  });

  it('committed Alchemy stack models remote state, both Workers, and game-host bindings', async () => {
    const stackSource = await readFile(
      path.resolve(import.meta.dirname, 'runtime-deploy/alchemy-cloudflare-stack.ts'),
      'utf8',
    );
    const execSource = await readFile(
      path.resolve(import.meta.dirname, 'runtime-deploy/alchemy-exec-result.ts'),
      'utf8',
    );
    const bootstrapProbeSource = await readFile(
      path.resolve(import.meta.dirname, 'runtime-deploy/alchemy-bootstrap-probe.ts'),
      'utf8',
    );

    expect(stackSource).toContain('state: Cloudflare.state()');
    expect(stackSource).not.toContain('Alchemy.localState()');
    expect(stackSource).toContain("Cloudflare.Worker('behavior-runtime'");
    expect(stackSource).toContain('main: input.behaviorWorkerPath');
    expect(stackSource).toContain("Cloudflare.Worker('game-host'");
    expect(stackSource).toContain('main: input.workerPath');
    expect(stackSource).toContain("Cloudflare.DurableObjectNamespace('playtest-room'");
    expect(stackSource).toContain("className: 'PlaytestRoom'");
    expect(stackSource).toContain("exports: ['PlaytestRoom']");
    expect(stackSource).toContain('PLAYTEST_ROOM: playtestRoom');
    expect(stackSource).toContain('BEHAVIOR_RUNTIME: behaviorWorker');
    expect(stackSource).toContain('HANDOFF_SIGNING_KEY: Redacted.make(handoffSigningKey)');
    expect(stackSource).toContain('Output.map(gameHostWorker.url');
    expect(stackSource).toContain('TILEBORNE_ALCHEMY_RESULT_JSON=');
    expect(stackSource).not.toContain('const endpoint = yield* gameHostWorker.url');
    expect(stackSource).not.toContain('writeFile(input.resultPath!');
    expect(bootstrapProbeSource).toContain("import * as Output from 'alchemy/Output'");
    expect(bootstrapProbeSource).toContain('Output.map(');
    expect(bootstrapProbeSource).toContain('TILEBORNE_ALCHEMY_RESULT_JSON=');
    expect(execSource).toContain("packageRequire.resolve('alchemy/bin/alchemy.js')");
    expect(execSource).not.toContain('import.meta.resolve');
    expect(execSource).not.toContain("lib', 'Cli', 'exec.js'");
    expect(execSource).not.toContain('lastConsoleValue');
  });

  it('node Alchemy runner delegates provider state and endpoint results to the v2 exec lifecycle', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'tileborne-alchemy-exec-fixture-'));
    try {
      const stackEntrypoint = path.join(stateDir, 'alchemy-cloudflare-stack.js');
      const execEntrypoint = path.join(stateDir, 'alchemy-exec.js');
      await writeFile(stackEntrypoint, 'export default "committed-stack-fixture";\n');
      await writeFile(
        execEntrypoint,
        `
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = JSON.parse(process.env.TILEBORNE_ALCHEMY_INPUT);
const args = process.argv.slice(2);
const main = args.at(-1);
const stage = args[args.indexOf('--stage') + 1];
const dryRun = args.includes('--dry-run');
const destroy = args[0] === 'destroy';
const adopt = args.includes('--adopt');
await writeFile(path.join(process.cwd(), 'state.json'), JSON.stringify({
  main,
  stage,
  dryRun,
  destroy,
  adopt,
  password: process.env.ALCHEMY_PASSWORD ? '[encrypted]' : undefined,
  resources: [
    { type: 'worker', name: input.workerName, main: input.workerPath },
    { type: 'worker', name: input.workerName + '-behaviors', main: input.behaviorWorkerPath },
    { type: 'durable_object_namespace', className: 'PlaytestRoom' }
  ]
}));
process.stdout.write('human-readable alchemy output\\n');
process.stdout.write('TILEBORNE_ALCHEMY_RESULT_JSON=' + JSON.stringify({
  endpoint: 'https://provider.example/' + input.workerName,
  status: input.operation === 'deploy' ? 'deployed' : 'running',
  logs: ['v2 exec ' + input.operation]
}) + '\\n');
`,
      );
      const runner = createNodeAlchemyCloudflareRunner(undefined, stackEntrypoint, execEntrypoint);
      const result = await runner({
        operation: 'deploy',
        artifactDirectory: '/tmp/tileborne-artifact',
        workerName: 'payload-worker',
        stage: 'staging',
        stateDirectory: stateDir,
        handoffSigningKey: 'handoff-signing-key-secret-32chars-min',
        alchemyPassword: 'alchemy-password-secret',
        credentials: new RuntimeDeployCredentials({
          accountId: 'acct-secret',
          apiToken: 'token-secret',
        }),
      });
      const state = await readFile(path.join(stateDir, 'state.json'), 'utf8');
      expect(result).toMatchObject({
        endpoint: 'https://provider.example/payload-worker',
        status: 'deployed',
      });
      expect(result.logs).toContain('v2 exec deploy');
      expect(state).toContain(stackEntrypoint);
      expect(state).toContain('behavior-worker.js');
      expect(state).toContain('PlaytestRoom');
      expect(state).not.toContain('token-secret');
      expect(state).not.toContain('acct-secret');
      expect(state).not.toContain('handoff-signing-key-secret');
      expect(state).not.toContain('alchemy-password-secret');
      expect(state).not.toContain('bindings');
      expect(state).not.toContain('entrypoint');
      expect(state).toContain('[encrypted]');
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('production Alchemy executor reports provider status and logs as unsupported typed operation failures', async () => {
    const executor = createProductionAlchemyCloudflareExecutor(async () =>
      runtimeDeploymentOperationResult('https://provider.example', 'running', []),
    );
    const base = {
      artifactDirectory: '/tmp/tileborne-artifact',
      workerName: 'unsupported-worker',
      stage: 'dev' as const,
      credentials: new RuntimeDeployCredentials({ accountId: 'acct', apiToken: 'token' }),
    };

    await expect(executor({ ...base, operation: 'status' })).rejects.toThrow(
      'Cloudflare status is not supported',
    );
    await expect(executor({ ...base, operation: 'logs' })).rejects.toThrow(
      'Cloudflare logs is not supported',
    );
  });

  it('production Alchemy executor keeps concurrent credentials isolated per runner call', async () => {
    const calls: string[] = [];
    const executor = createProductionAlchemyCloudflareExecutor(async (input) => {
      calls.push(`${input.workerName}:${input.credentials.apiToken}`);
      await new Promise((resolve) => setTimeout(resolve, input.workerName === 'first' ? 10 : 0));
      return runtimeDeploymentOperationResult(
        `https://provider.example/${input.workerName}`,
        operationStatus(input.operation),
        [],
      );
    });

    await Promise.all([
      executor({
        operation: 'deploy',
        artifactDirectory: '/tmp/first',
        workerName: 'first',
        stage: 'dev',
        credentials: new RuntimeDeployCredentials({ accountId: 'acct-a', apiToken: 'token-a' }),
      }),
      executor({
        operation: 'deploy',
        artifactDirectory: '/tmp/second',
        workerName: 'second',
        stage: 'dev',
        credentials: new RuntimeDeployCredentials({ accountId: 'acct-b', apiToken: 'token-b' }),
      }),
    ]);

    expect(calls.sort()).toEqual(['first:token-a', 'second:token-b']);
  });

  it('records missing auth as a typed job error', () =>
    withTempHome(async () => {
      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'dev',
              workerName: 'tileborne-test',
              credentials: Option.none(),
            }),
          );
          return yield* waitForJob(jobId);
        }).pipe(
          Effect.provide(
            deployTestLayer([], {
              credentialResolver: () => Option.none(),
            }),
          ),
        ),
      );
      expect(status.status._tag).toBe('Failed');
    }));

  it('reads a deployment by id', () =>
    withTempHome(async () => {
      const read = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'staging',
              workerName: 'tileborne-test',
              credentials: Option.some(
                new RuntimeDeployCredentials({ accountId: 'acct', apiToken: 'token' }),
              ),
            }),
          );
          yield* waitForJob(jobId);
          const [deployment] = yield* deploy.listDeployments(build.id);
          if (!deployment) throw new Error('missing deployment');
          return yield* deploy.getDeployment(deployment.id);
        }).pipe(Effect.provide(deployTestLayer())),
      );
      expect(read.target.stage).toBe('staging');
    }));

  it('publishes deploy events', () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const fiber = yield* deploy.subscribe.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'dev',
              workerName: 'tileborne-test',
              credentials: Option.some(
                new RuntimeDeployCredentials({ accountId: 'acct', apiToken: 'token' }),
              ),
            }),
          );
          yield* waitForJob(jobId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(deployTestLayer())),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it('re-acquires external credentials for plan, preview, status, logs, and destroy without persisting them', () =>
    withTempHome(async () => {
      const calls: RuntimeDeployCall[] = [];
      const observed = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const target = new RuntimeDeployTarget({
            adapterId: Option.some('alchemy-cloudflare'),
            stage: 'staging',
            workerName: 'tileborne-test',
            credentials: Option.none(),
          });
          yield* deploy.plan(build.id, target);
          yield* deploy.preview(build.id, target);
          const jobId = yield* deploy.deploy(build.id, target);
          yield* waitForJob(jobId);
          const [deployment] = yield* deploy.listDeployments(build.id);
          if (!deployment) throw new Error('missing deployment');
          yield* deploy.status(deployment.id);
          yield* deploy.logs(deployment.id);
          const receipt = yield* Effect.promise(() => readFile(deployment.manifestPath, 'utf8'));
          yield* deploy.destroy(deployment.id);
          return { receipt, buildDirectory: build.directory };
        }).pipe(Effect.provide(deployTestLayer(calls))),
      );

      expect(calls.map((call) => call.operation)).toEqual([
        'plan',
        'preview',
        'deploy',
        'status',
        'logs',
        'destroy',
      ]);
      expect(new Set(calls.map((call) => call.artifactDirectory))).toEqual(
        new Set([observed.buildDirectory]),
      );
      expect(calls.every((call) => call.apiToken === 'token-env-secret')).toBe(true);
      expect(observed.receipt).not.toContain('token-env-secret');
      expect(observed.receipt).not.toContain('acct-env-secret');
      expect(observed.receipt).not.toContain('credentials');
    }));

  it('does not delete a deployment when provider destroy fails', () =>
    withTempHome(async () => {
      const remaining = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.some('alchemy-cloudflare'),
              stage: 'dev',
              workerName: 'tileborne-test',
              credentials: Option.none(),
            }),
          );
          yield* waitForJob(jobId);
          const [deployment] = yield* deploy.listDeployments(build.id);
          if (!deployment) throw new Error('missing deployment');
          const failed = yield* Effect.result(deploy.destroy(deployment.id));
          expect(Result.isFailure(failed)).toBe(true);
          if (Result.isFailure(failed)) {
            expect(failed.failure).toMatchObject({
              _tag: 'RuntimeDeployOperationError',
              operation: 'destroy',
            });
            expect(failed.failure.message).not.toContain('token-env-secret');
          }
          return yield* deploy.listDeployments(build.id);
        }).pipe(
          Effect.provide(
            deployTestLayer([], {
              alchemyExecutor: async (input) => {
                if (input.operation === 'destroy') {
                  throw new Error(`destroy rejected ${input.credentials.apiToken}`);
                }
                return runtimeDeploymentOperationResult(
                  `https://provider.example/${input.workerName}`,
                  operationStatus(input.operation),
                  [],
                );
              },
            }),
          ),
        ),
      );
      expect(remaining).toHaveLength(1);
    }));

  it('deletes a deployment', () =>
    withTempHome(async () => {
      const calls: RuntimeDeployCall[] = [];
      const remaining = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'dev',
              workerName: 'tileborne-test',
              credentials: Option.some(
                new RuntimeDeployCredentials({ accountId: 'acct', apiToken: 'token' }),
              ),
            }),
          );
          yield* waitForJob(jobId);
          const [deployment] = yield* deploy.listDeployments(build.id);
          if (!deployment) throw new Error('missing deployment');
          yield* deploy.deleteDeployment(deployment.id);
          return yield* deploy.listDeployments(build.id);
        }).pipe(Effect.provide(deployTestLayer(calls))),
      );
      expect(remaining).toHaveLength(0);
      expect(calls).toContainEqual(
        expect.objectContaining({ provider: 'alchemy-cloudflare', operation: 'destroy' }),
      );
    }));
});

describe('SupportService', () => {
  it('creates a support bundle', () =>
    withTempHome(async () => {
      const bundle = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          return (yield* support.listBundles())[0];
        }).pipe(Effect.provide(testLayer)),
      );
      expect(bundle?.redactedFiles).toContain('config.redacted.json');
    }));

  it('respects bundle options', () =>
    withTempHome(async () => {
      const bundle = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle(
            new SupportBundleOptions({
              includeLogs: Option.some(false),
              includeConfig: Option.some(true),
              delayMs: Option.none(),
            }),
          );
          yield* waitForJob(jobId);
          return (yield* support.listBundles())[0];
        }).pipe(Effect.provide(testLayer)),
      );
      expect(bundle?.redactedFiles).toEqual(['config.redacted.json']);
    }));

  it('reads a support bundle by id', () =>
    withTempHome(async () => {
      const read = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          const [bundle] = yield* support.listBundles();
          if (!bundle) throw new Error('missing support bundle');
          return yield* support.getBundle(bundle.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(read.id.startsWith('support:')).toBe(true);
    }));

  it('publishes support events', () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const fiber = yield* support.subscribe.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it('deletes a support bundle', () =>
    withTempHome(async () => {
      const remaining = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          const [bundle] = yield* support.listBundles();
          if (!bundle) throw new Error('missing support bundle');
          yield* support.deleteBundle(bundle.id);
          return yield* support.listBundles();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(remaining).toHaveLength(0);
    }));
});

describe('cross-service workflow', () => {
  it('runs project build export deploy support chain', () =>
    withTempHome(async () => {
      const calls: RuntimeDeployCall[] = [];
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject('Arena');
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const exportJob = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.none() }),
          );
          yield* waitForJob(exportJob);
          const deploy = yield* RuntimeDeployService;
          const deployJob = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              adapterId: Option.none(),
              stage: 'dev',
              workerName: 'tileborne-test',
              credentials: Option.some(
                new RuntimeDeployCredentials({ accountId: 'acct', apiToken: 'token' }),
              ),
            }),
            new RuntimeDeployOptions({ delayMs: Option.none() }),
          );
          yield* waitForJob(deployJob);
          const support = yield* SupportService;
          const supportJob = yield* support.createBundle();
          yield* waitForJob(supportJob);
          return {
            exports: (yield* exports.listExports(build.id)).length,
            deployments: (yield* deploy.listDeployments(build.id)).length,
            support: (yield* support.listBundles()).length,
          };
        }).pipe(Effect.provide(deployTestLayer(calls))),
      );
      expect(result).toEqual({ exports: 1, deployments: 1, support: 1 });
      expect(calls).toContainEqual(
        expect.objectContaining({ provider: 'alchemy-cloudflare', operation: 'deploy' }),
      );
    }));
});

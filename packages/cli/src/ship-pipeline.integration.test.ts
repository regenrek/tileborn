import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  gameObjectTypeIdForKey,
  JsonValue,
  MapObject,
  ObjectLayer,
  PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY,
  TileborneMap,
  makeItemDefinitionId,
  makeLayerId,
  makeObjectId,
  type Uuid,
} from '@tileborne/core';
import { MapService, ProjectService } from '@tileborne/services-app';
import { BuildService, GameBuildOptions, ServicesBuildLayer } from '@tileborne/services-build';
import { createLocalGameHost, type LocalGameHost } from '@tileborne/services-build/local-game-host';
import { ConfigLayer, HomeServiceLive, JobServiceLive } from '@tileborne/services-foundation';
import {
  LocalPluginSource,
  PluginInstallerLayer,
  PluginInstallerService,
  PluginLoaderMainLayer,
  PluginRegistryLayer,
} from '@tileborne/services-plugin';
import { Effect, Layer, Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldGameProject } from './commands/game/init.js';
import { TEMPLATE_DIRECTORIES } from './commands/game/init-templates.js';

/**
 * M5 S4: end-to-end ship-pipeline proof. One chain covering the full thin
 * product-repo flow the CLI ships:
 *
 *   game init (scaffold) → game build --target local (real buildGame path,
 *   bundled RuntimeMapPackage) → game serve boot (miniflare, test port) →
 *   packageless POST /rooms/create resolves the BUNDLED map package into a
 *   joinable room.
 *
 * The fixture installs the real workspace Battle Royale plugin and authors the
 * minimum BR-valid map objects before building. The build runs through the same
 * `BuildService.buildGame` the `tileborne game build` command invokes.
 */

const TEST_PORT = 18095;
const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testFileDir, '../../..');
const battleRoyalePluginRoot = path.join(repoRoot, 'packages/plugin-battle-royale');
const BATTLE_ROYALE_PLUGIN_ID = '@tileborne-plugins/battle-royale';
const EXAMPLE_ARENA_PLUGIN_ID = '@tileborne-plugins/example-arena';
const exampleArenaPluginRoot = path.join(repoRoot, 'packages/plugin-example-arena');
const SPAWN_POINT_KIND = gameObjectTypeIdForKey('spawn-point');
const SHRINK_ZONE_ANCHOR_KIND = gameObjectTypeIdForKey('shrink-zone-anchor');
const LOOT_CRATE_KIND = gameObjectTypeIdForKey('loot-crate');
const AUTHORED_HEALTH_ITEM_ID = makeItemDefinitionId(
  '00000000-0000-4000-8000-000000000200' as Uuid,
);

const authoredProjectContent = (): JsonValue =>
  Schema.decodeUnknownSync(JsonValue)({
    schemaVersion: 1,
    catalog: {
      id: 'catalog:00000000-0000-4000-8000-000000000201',
      schemaVersion: 1,
      objectTypes: [],
      lootTables: [],
      items: [
        {
          id: AUTHORED_HEALTH_ITEM_ID,
          label: 'Creator Health Flask',
          category: 'consumable',
          data: { healing: 25 },
        },
      ],
    },
    weapons: { schemaVersion: 1, weapons: [] },
    weaponLabels: {},
    provenance: { [AUTHORED_HEALTH_ITEM_ID]: { _tag: 'project' } },
  });

const withTempHome = async <A>(run: (home: string) => Promise<A>): Promise<A> => {
  const previous = process.env['TILEBORNE_HOME'];
  const home = await mkdtemp(path.join(tmpdir(), 'tileborne-ship-e2e-home-'));
  process.env['TILEBORNE_HOME'] = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) {
      delete process.env['TILEBORNE_HOME'];
    } else {
      process.env['TILEBORNE_HOME'] = previous;
    }
    await rm(home, { recursive: true, force: true });
  }
};

const foundationLayer = Layer.mergeAll(HomeServiceLive, JobServiceLive, ConfigLayer);
const pluginLayer = Layer.mergeAll(PluginLoaderMainLayer, PluginInstallerLayer).pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(foundationLayer),
);
const testLayer = ServicesBuildLayer.pipe(
  Layer.provideMerge(pluginLayer),
  Layer.provideMerge(foundationLayer),
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const uuid = (suffix: string): Uuid => `00000000-0000-4000-8000-${suffix}` as Uuid;

const makeBrObject = (
  index: number,
  kind: ReturnType<typeof gameObjectTypeIdForKey>,
  x: number,
  y: number,
  properties: Record<string, unknown>,
  layerId: ReturnType<typeof makeLayerId>,
): MapObject =>
  new MapObject({
    id: makeObjectId(uuid(String(index + 1).padStart(12, '0'))),
    kind,
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId,
    properties,
  });

const withBattleRoyaleObjects = (map: TileborneMap): TileborneMap => {
  const layerId = makeLayerId(uuid('000000000100'));
  const objectLayer = new ObjectLayer({
    id: layerId,
    name: 'objects',
    visible: true,
    opacity: 1,
    objectIds: [
      makeObjectId(uuid('000000000001')),
      makeObjectId(uuid('000000000002')),
      makeObjectId(uuid('000000000003')),
      makeObjectId(uuid('000000000004')),
      makeObjectId(uuid('000000000005')),
      makeObjectId(uuid('000000000006')),
    ],
  });
  const objects = [
    makeBrObject(0, SPAWN_POINT_KIND, 4, 4, { team: 'solo', weight: 1 }, layerId),
    makeBrObject(1, SPAWN_POINT_KIND, 12, 4, { team: 'solo', weight: 1 }, layerId),
    makeBrObject(2, SPAWN_POINT_KIND, 4, 12, { team: 'solo', weight: 1 }, layerId),
    makeBrObject(3, SPAWN_POINT_KIND, 12, 12, { team: 'solo', weight: 1 }, layerId),
    makeBrObject(
      4,
      SHRINK_ZONE_ANCHOR_KIND,
      8,
      8,
      { initialRadiusTiles: 8, finalRadiusTiles: 2 },
      layerId,
    ),
    makeBrObject(
      5,
      LOOT_CRATE_KIND,
      8,
      6,
      { itemKind: 'health-pack', tier: 'common', weight: 1 },
      layerId,
    ),
  ];
  return new TileborneMap({
    id: map.id,
    schemaVersion: map.schemaVersion,
    size: map.size,
    tileSize: map.tileSize,
    layers: [...map.layers, objectLayer],
    objects,
    properties: {
      ...map.properties,
      [BATTLE_ROYALE_PLUGIN_ID]: { maxPlayers: 4 },
    },
  });
};

interface BundledManifestWire {
  readonly buildId: string;
  readonly plugin: { readonly id: string; readonly files: readonly { readonly path: string }[] };
  readonly maps: readonly {
    readonly mapId: string;
    readonly packageId: string;
    readonly files: readonly {
      readonly path: string;
      readonly hash: string;
      readonly size: number;
    }[];
  }[];
  readonly workerFiles: readonly { readonly path: string; readonly hash: string }[];
}

interface RoomLobbySummaryWire {
  readonly roomId: string;
  readonly phase: 'lobby' | 'countdown' | 'active' | 'finished';
  readonly playerCount: number;
  readonly minReadyPlayers: number;
  readonly canStart: boolean;
  readonly players: readonly {
    readonly playerId: string;
    readonly displayName?: string;
    readonly status: 'connected' | 'disconnected';
    readonly ready: boolean;
    readonly reconnectEligible: boolean;
  }[];
}

interface LobbyCreateResponseWire {
  readonly roomId: string;
  readonly wsUrl: string;
  readonly joinCode: string;
  readonly joinUrl: string;
  readonly playerId: string;
  readonly handoffToken: string;
  readonly reconnectToken: string;
  readonly lobby: RoomLobbySummaryWire;
}

interface LobbyJoinResponseWire {
  readonly roomId: string;
  readonly playerId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly reconnectToken: string;
  readonly lobby: RoomLobbySummaryWire;
}

interface LobbyReadyResponseWire {
  readonly lobby: RoomLobbySummaryWire;
  readonly canStart: boolean;
}

interface RoomReconnectResponseWire {
  readonly roomId: string;
  readonly playerId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly reconnectToken?: string;
  readonly lobby: RoomLobbySummaryWire;
}

interface PlaytestSummaryWire {
  readonly metrics: {
    readonly lifecyclePhase: string;
    readonly playerCount: number;
    readonly connectedClients: number;
  };
}

interface RoomResultsResponseWire {
  readonly roomId: string;
  readonly results: unknown;
}

const parseJson = async <T>(response: { json(): Promise<unknown> }): Promise<T> => {
  const value = await response.json();
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected JSON object response');
  }
  return value as T;
};

const bounded = async <T>(label: string, promise: Promise<T>, timeoutMs = 10_000): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const expectStatus = async (
  response: { readonly status: number; text(): Promise<string> },
  expected: number,
  label: string,
): Promise<void> => {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}: ${await response.text()}`);
  }
  expect(response.status).toBe(expected);
};

const postJson = (
  host: LocalGameHost,
  route: string,
  body: unknown,
): ReturnType<LocalGameHost['fetch']> =>
  host.fetch(`${host.baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const lobbyPlayer = (
  lobby: RoomLobbySummaryWire,
  playerId: string,
): RoomLobbySummaryWire['players'][number] | undefined =>
  lobby.players.find((player) => player.playerId === playerId);

const waitForLobbyPlayer = async (
  host: LocalGameHost,
  roomId: string,
  playerId: string,
  predicate: (
    player: RoomLobbySummaryWire['players'][number],
    lobby: RoomLobbySummaryWire,
  ) => boolean,
  label: string,
): Promise<RoomLobbySummaryWire> => {
  const deadline = performance.now() + 1_000;
  let lastSummary: RoomLobbySummaryWire | null = null;
  while (performance.now() < deadline) {
    const response = await bounded(
      `${label} lobby fetch`,
      host.fetch(`${host.baseUrl}/lobbies/${roomId}`),
      2_000,
    );
    expect(response.status).toBe(200);
    const lobby = await parseJson<RoomLobbySummaryWire>(response);
    lastSummary = lobby;
    const player = lobbyPlayer(lobby, playerId);
    if (player !== undefined && predicate(player, lobby)) {
      return lobby;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}; last lobby=${JSON.stringify(lastSummary)}`);
};

const closeSocketQuietly = (socket: { close(code?: number, reason?: string): void }): void => {
  try {
    socket.close(1000, 'done');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already closed')) {
      throw error;
    }
  }
};

const buildIsolatedExampleArtifact = async (): Promise<{
  readonly directory: string;
  readonly mapId: string;
}> => {
  const artifactParent = await mkdtemp(path.join(tmpdir(), 'tileborne-example-artifact-'));
  tempDirs.push(artifactParent);
  const outDir = path.join(artifactParent, 'built');
  const mapId = await Effect.runPromise(
    Effect.gen(function* () {
      const projects = yield* ProjectService;
      const maps = yield* MapService;
      const projectId = yield* projects.create({ name: 'Example Arena Ship Proof' });
      const mapId = yield* maps.create(projectId, { width: 32, height: 32 });
      const map = yield* maps.load(projectId, mapId);
      yield* maps.save(
        projectId,
        new TileborneMap({
          id: map.id,
          schemaVersion: map.schemaVersion,
          size: map.size,
          tileSize: map.tileSize,
          layers: map.layers,
          objects: map.objects,
          properties: {
            ...map.properties,
            [EXAMPLE_ARENA_PLUGIN_ID]: { arenaRadius: 48, enemyCount: 10 },
          },
        }),
      );
      const installer = yield* PluginInstallerService;
      yield* installer.install(new LocalPluginSource({ path: exampleArenaPluginRoot }));
      const builds = yield* BuildService;
      const artifact = yield* builds.buildGame(
        new GameBuildOptions({
          pluginId: EXAMPLE_ARENA_PLUGIN_ID,
          target: 'local',
          outputDirectory: Option.some(outDir),
          assetPackIds: Option.none(),
          siteName: Option.none(),
          projectId: Option.some(projectId),
          mapIds: Option.some([String(mapId)]),
        }),
      );
      expect(artifact.files).toContain('worker.js');
      return String(mapId);
    }).pipe(Effect.provide(testLayer)),
  );

  const isolatedArtifact = path.join(artifactParent, 'isolated');
  await cp(outDir, isolatedArtifact, { recursive: true });
  return { directory: isolatedArtifact, mapId };
};

const assertExampleArtifactContents = async (
  isolatedArtifact: string,
  mapId: string,
): Promise<void> => {
  const manifest = JSON.parse(
    await readFile(path.join(isolatedArtifact, 'manifest.json'), 'utf8'),
  ) as {
    readonly plugin: { readonly id: string };
    readonly maps: readonly { readonly mapId: string }[];
  };
  expect(manifest.plugin.id).toBe(EXAMPLE_ARENA_PLUGIN_ID);
  expect(manifest.maps.map((entry) => entry.mapId)).toEqual([mapId]);
  const packageDirectory = path.join(isolatedArtifact, 'maps', mapId.replaceAll(':', '-'));
  const packageManifest = JSON.parse(
    await readFile(path.join(packageDirectory, 'manifest.json'), 'utf8'),
  ) as { readonly activeMode: string };
  const modeData = JSON.parse(
    await readFile(path.join(packageDirectory, 'mode-data.json'), 'utf8'),
  ) as Record<string, unknown>;
  expect(packageManifest.activeMode).toBe(EXAMPLE_ARENA_PLUGIN_ID);
  expect(modeData[EXAMPLE_ARENA_PLUGIN_ID]).toEqual({
    schemaVersion: 1,
    arenaRadius: 48,
    enemyCount: 10,
  });
};

interface ArtifactWorkerModule {
  readonly default: {
    fetch(request: Request, env: unknown, context: unknown): Promise<Response>;
  };
  readonly PlaytestRoom: new (
    state: unknown,
    env: unknown,
  ) => { fetch(request: Request): Promise<Response>; alarm(): Promise<void> };
}

const executeArtifactWorkerRoom = async (
  isolatedArtifact: string,
  mapId: string,
): Promise<void> => {
  const workerPath = path.join(isolatedArtifact, 'worker.js');
  const workerSource = await readFile(workerPath, 'utf8');
  expect(workerSource).not.toContain(repoRoot);
  expect(workerSource).not.toContain(exampleArenaPluginRoot);
  const worker = (await import(
    `${pathToFileURL(workerPath).href}?artifact-proof=${Date.now()}`
  )) as ArtifactWorkerModule;

  const rooms = new Map<string, InstanceType<ArtifactWorkerModule['PlaytestRoom']>>();
  const env: Record<string, unknown> = {
    HANDOFF_SIGNING_KEY: 'artifact-direct-fetch-signing-key-32-bytes',
    ROOM_IDLE_TIMEOUT_SECONDS: 60,
  };
  const namespace = {
    idFromName: (name: string) => ({ toString: () => name }),
    get: (id: { toString(): string }) => ({
      fetch: async (request: Request) => {
        const roomId = id.toString();
        let room = rooms.get(roomId);
        if (room === undefined) {
          const storage = new Map<string, unknown>();
          let alarmAt: number | null = null;
          const state = {
            storage: {
              get: async (key: string) => storage.get(key),
              put: async (key: string, value: unknown) => {
                storage.set(key, value);
              },
              delete: async (key: string) => storage.delete(key),
              list: async () => ({
                keys: [...storage.keys()].map((name) => ({ name })),
                cursor: '',
                list_complete: true,
              }),
              setAlarm: async (scheduled: number | Date) => {
                alarmAt = typeof scheduled === 'number' ? scheduled : scheduled.getTime();
              },
              getAlarm: async () => alarmAt,
              deleteAlarm: async () => {
                alarmAt = null;
              },
            },
            acceptWebSocket: () => undefined,
            getWebSockets: () => [],
            waitUntil: (promise: Promise<unknown>) => {
              void promise;
            },
            blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
          };
          room = new worker.PlaytestRoom(state, env);
          rooms.set(roomId, room);
        }
        return room.fetch(request);
      },
    }),
  };
  env['PLAYTEST_ROOM'] = namespace;
  const context = {
    waitUntil: (promise: Promise<unknown>) => {
      void promise;
    },
    passThroughOnException: () => undefined,
  };
  const origin = 'https://artifact.example';
  const created = await worker.default.fetch(
    new Request(`${origin}/rooms/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mapId,
        options: { idempotencyKey: 'example-arena-isolated-artifact-room' },
      }),
    }),
    env,
    context,
  );
  expect(created.status, await created.clone().text()).toBe(201);
  const room = (await created.json()) as { readonly roomId: string };
  const summaryResponse = await worker.default.fetch(
    new Request(`${origin}/playtest/${room.roomId}`),
    env,
    context,
  );
  expect(summaryResponse.status, await summaryResponse.clone().text()).toBe(200);
  expect(await summaryResponse.json()).toMatchObject({
    playtestId: room.roomId,
    mapId,
    metrics: { tick: expect.any(Number) },
  });
};

describe('ship pipeline end to end (scaffold → build → boot → room)', () => {
  it(
    'builds a copied Example Arena artifact with only the selected map and opaque mode data',
    () =>
      withTempHome(async () => {
        const artifact = await buildIsolatedExampleArtifact();
        await assertExampleArtifactContents(artifact.directory, artifact.mapId);
      }),
    120_000,
  );

  it(
    'boots an isolated copied Example Arena artifact with its selected map and opaque mode data',
    () =>
      withTempHome(async () => {
        const artifact = await buildIsolatedExampleArtifact();
        const { directory: isolatedArtifact, mapId } = artifact;
        await assertExampleArtifactContents(isolatedArtifact, mapId);

        await executeArtifactWorkerRoom(isolatedArtifact, mapId);
      }),
    120_000,
  );

  it(
    'scaffolds a product repo, builds the local artifact, and proves the two-client lifecycle from the bundled map package',
    () =>
      withTempHome(async () => {
        // 1. Scaffold the thin product repo via the `game init` machinery.
        const parent = await mkdtemp(path.join(tmpdir(), 'tileborne-ship-e2e-repo-'));
        tempDirs.push(parent);
        const repoDir = path.join(parent, 'shipped-game');
        const scaffold = await scaffoldGameProject({
          directory: repoDir,
          pluginId: BATTLE_ROYALE_PLUGIN_ID,
        });
        expect(scaffold.pluginId).toBe(BATTLE_ROYALE_PLUGIN_ID);
        for (const dir of TEMPLATE_DIRECTORIES) {
          expect((await stat(path.join(repoDir, dir))).isDirectory(), dir).toBe(true);
        }
        const pkg = JSON.parse(await readFile(path.join(repoDir, 'package.json'), 'utf8')) as {
          readonly scripts: Record<string, string>;
        };
        expect(pkg.scripts['build']).toContain('scripts/build.mjs');
        const buildScript = await readFile(path.join(repoDir, 'scripts', 'build.mjs'), 'utf8');
        expect(buildScript).toContain(`"${BATTLE_ROYALE_PLUGIN_ID}"`);
        expect(buildScript).toContain('"--project"');

        // 2. Build via the REAL buildGame path into the scaffold's dist/game
        //    (the product-repo output convention), with a bundled map package.
        const outDir = path.join(repoDir, 'dist', 'game');
        const { mapId, decoyMapId } = await Effect.runPromise(
          Effect.gen(function* () {
            const projects = yield* ProjectService;
            const maps = yield* MapService;
            const projectId = yield* projects.create({
              name: 'Ship E2E',
              settings: {
                [PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY]: authoredProjectContent(),
              },
            });
            const mapId = yield* maps.create(projectId, { width: 16, height: 16 });
            const decoyMapId = yield* maps.create(projectId, { width: 8, height: 8 });
            const map = yield* maps.load(projectId, mapId);
            yield* maps.save(projectId, withBattleRoyaleObjects(map));
            const installer = yield* PluginInstallerService;
            yield* installer.install(new LocalPluginSource({ path: battleRoyalePluginRoot }));
            const builds = yield* BuildService;
            const artifact = yield* builds.buildGame(
              new GameBuildOptions({
                pluginId: BATTLE_ROYALE_PLUGIN_ID,
                target: 'local',
                outputDirectory: Option.some(outDir),
                assetPackIds: Option.none(),
                siteName: Option.none(),
                projectId: Option.some(projectId),
                mapIds: Option.some([String(mapId)]),
              }),
            );
            expect(artifact.target).toBe('local');
            expect(artifact.files).toContain('worker.js');
            expect(artifact.files).toContain('plugin/runtime.js');
            expect(artifact.files).toContain('README.md');
            return { mapId, decoyMapId };
          }).pipe(Effect.provide(testLayer)),
        );

        // 3. Assert artifact contents: worker, plugin runtime, map package
        //    files, and hashed manifest map entries.
        const mapDir = `maps/${mapId.replaceAll(':', '-')}`;
        for (const file of [
          'worker.js',
          'plugin/runtime.js',
          'wrangler.toml',
          `${mapDir}/map.json`,
          `${mapDir}/manifest.json`,
        ]) {
          expect((await stat(path.join(outDir, ...file.split('/')))).isFile(), file).toBe(true);
        }
        // Build-time staging (generated worker modules + map-package staging)
        // never ships inside the deployable artifact.
        await expect(stat(path.join(outDir, '.staging'))).rejects.toThrow();
        const manifest = JSON.parse(
          await readFile(path.join(outDir, 'manifest.json'), 'utf8'),
        ) as BundledManifestWire;
        expect(manifest.plugin.id).toBe(BATTLE_ROYALE_PLUGIN_ID);
        expect(manifest.maps).toHaveLength(1);
        expect(manifest.maps[0]?.mapId).toBe(mapId);
        expect(manifest.maps[0]?.mapId).not.toBe(decoyMapId);
        expect(manifest.maps[0]?.packageId).toMatch(/^mappkg:/);
        expect(manifest.maps[0]?.files.length).toBeGreaterThan(0);
        for (const entry of manifest.maps[0]?.files ?? []) {
          expect(entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
          expect(entry.size).toBeGreaterThan(0);
        }
        expect(manifest.workerFiles.map((entry) => entry.path)).toContain('worker.js');
        const authoredMapWire = await readFile(
          path.join(outDir, ...`${mapDir}/map.json`.split('/')),
          'utf8',
        );
        expect(authoredMapWire).toContain(String(SPAWN_POINT_KIND));
        expect(authoredMapWire).toContain(String(LOOT_CRATE_KIND));
        const authoredContent = JSON.parse(
          await readFile(path.join(outDir, ...`${mapDir}/content.json`.split('/')), 'utf8'),
        ) as {
          readonly items: readonly { readonly id: string; readonly label: string }[];
          readonly provenance: Record<string, { readonly _tag: string }>;
        };
        expect(authoredContent.items).toContainEqual(
          expect.objectContaining({
            id: String(AUTHORED_HEALTH_ITEM_ID),
            label: 'Creator Health Flask',
          }),
        );
        expect(authoredContent.provenance[String(AUTHORED_HEALTH_ITEM_ID)]).toEqual({
          _tag: 'project',
        });

        // Prove the shipped copy is self-contained and exposes the Durable
        // Object class the local runtime will instantiate. The source build
        // directory is intentionally not used after this point.
        const isolatedArtifact = path.join(parent, 'isolated-shipped-game');
        await cp(outDir, isolatedArtifact, { recursive: true });
        const isolatedWorkerPath = path.join(isolatedArtifact, 'worker.js');
        const isolatedWorkerSource = await readFile(isolatedWorkerPath, 'utf8');
        expect(isolatedWorkerSource).not.toContain(repoRoot);
        expect(isolatedWorkerSource).not.toContain(battleRoyalePluginRoot);
        const isolatedWorker = (await import(
          `${pathToFileURL(isolatedWorkerPath).href}?br-artifact-proof=${Date.now()}`
        )) as ArtifactWorkerModule;
        expect(typeof isolatedWorker.PlaytestRoom).toBe('function');

        // 4. Boot the artifact locally (game serve contract) and create a lobby
        //    WITHOUT a body mapPackage — the worker resolves the bundled one.
        const host = await bounded(
          'isolated artifact host startup',
          createLocalGameHost({
            port: TEST_PORT,
            workerPath: isolatedWorkerPath,
            bindings: { ROOM_RECONNECT_WINDOW_SECONDS: 1 },
          }),
          15_000,
        );
        const sockets: Awaited<ReturnType<LocalGameHost['websocketConnect']>>[] = [];
        try {
          const health = await host.fetch(`${host.baseUrl}/health`);
          expect(health.status).toBe(200);
          const created = await host.fetch(`${host.baseUrl}/rooms/create`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mapId }),
          });
          expect(created.status).toBe(201);
          const room = (await created.json()) as {
            readonly roomId: string;
            readonly wsUrl: string;
          };
          expect(room.roomId.length).toBeGreaterThan(0);
          expect(room.wsUrl).toContain(`/rooms/${room.roomId}/connect`);

          const lobbyCreate = await postJson(host, '/lobbies/create', {
            mapId,
            displayName: 'Built artifact BR10',
            visibility: 'private',
            reserveCreator: true,
            playerDisplayName: 'Ada',
          });
          await expectStatus(lobbyCreate, 201, 'POST /lobbies/create');
          const creator = await parseJson<LobbyCreateResponseWire>(lobbyCreate);
          expect(creator.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
          expect(creator.roomId).toBe(`lobby-${creator.joinCode}`);
          expect(creator.joinUrl).toBe(`${host.baseUrl}/lobbies/join?code=${creator.joinCode}`);
          expect(creator.handoffToken.length).toBeGreaterThan(0);
          expect(creator.reconnectToken.length).toBeGreaterThan(0);
          expect(lobbyPlayer(creator.lobby, creator.playerId)).toMatchObject({
            displayName: 'Ada',
            ready: false,
            reconnectEligible: true,
          });

          sockets.push(
            await bounded(
              'creator websocket connection',
              host.websocketConnect(creator.wsUrl),
              5_000,
            ),
          );

          const lobbyJoin = await postJson(host, '/lobbies/join', {
            joinCode: creator.joinCode.toLowerCase(),
            displayName: 'Grace',
          });
          expect(lobbyJoin.status).toBe(201);
          const joiner = await parseJson<LobbyJoinResponseWire>(lobbyJoin);
          expect(joiner.roomId).toBe(creator.roomId);
          expect(joiner.playerId).not.toBe(creator.playerId);
          expect(lobbyPlayer(joiner.lobby, joiner.playerId)).toMatchObject({
            displayName: 'Grace',
            ready: false,
            reconnectEligible: true,
          });

          sockets.push(
            await bounded(
              'joiner websocket connection',
              host.websocketConnect(joiner.wsUrl),
              5_000,
            ),
          );

          const codeSummary = await parseJson<RoomLobbySummaryWire>(
            await host.fetch(`${host.baseUrl}/lobbies/code/${creator.joinCode}`),
          );
          expect(codeSummary).toMatchObject({
            roomId: creator.roomId,
            playerCount: 2,
            minReadyPlayers: 2,
            canStart: false,
          });

          const firstReady = await parseJson<LobbyReadyResponseWire>(
            await postJson(host, `/lobbies/${creator.roomId}/ready`, {
              playerId: creator.playerId,
              ready: true,
              reconnectToken: creator.reconnectToken,
            }),
          );
          expect(firstReady.canStart).toBe(false);
          expect(firstReady.lobby.phase).toBe('lobby');

          const secondReady = await parseJson<LobbyReadyResponseWire>(
            await postJson(host, `/lobbies/${creator.roomId}/ready`, {
              playerId: joiner.playerId,
              ready: true,
              reconnectToken: joiner.reconnectToken,
            }),
          );
          expect(secondReady.canStart).toBe(true);
          expect(secondReady.lobby.phase).toBe('countdown');

          await bounded(
            'countdown-to-active room alarm',
            host.triggerRoomAlarm(creator.roomId),
            5_000,
          );
          const activeSummary = await waitForLobbyPlayer(
            host,
            creator.roomId,
            creator.playerId,
            (_player, lobby) => lobby.phase === 'active',
            'active built-artifact lobby phase',
          );
          expect(activeSummary.players.map((player) => player.ready)).toEqual([true, true]);

          const playtestSummary = await parseJson<PlaytestSummaryWire>(
            await host.fetch(`${host.baseUrl}/playtest/${creator.roomId}`),
          );
          expect(playtestSummary.metrics).toMatchObject({
            lifecyclePhase: 'active',
            playerCount: 2,
            connectedClients: 2,
          });

          const liveResults = await parseJson<RoomResultsResponseWire>(
            await host.fetch(`${host.baseUrl}/rooms/${creator.roomId}/results`),
          );
          expect(liveResults).toEqual({ roomId: creator.roomId, results: null });

          sockets[0]?.close(1000, 'simulate disconnect');
          const disconnectedSummary = await waitForLobbyPlayer(
            host,
            creator.roomId,
            creator.playerId,
            (player) => player.status === 'disconnected' && player.reconnectEligible === true,
            'built-artifact creator disconnect presence',
          );
          expect(lobbyPlayer(disconnectedSummary, creator.playerId)).toMatchObject({
            ready: true,
            status: 'disconnected',
          });

          const reconnectResponse = await postJson(host, '/rooms/reconnect', {
            roomId: creator.roomId,
            playerId: creator.playerId,
            reconnectToken: creator.reconnectToken,
          });
          expect(reconnectResponse.status).toBe(200);
          const reconnected = await parseJson<RoomReconnectResponseWire>(reconnectResponse);
          expect(reconnected.roomId).toBe(creator.roomId);
          expect(reconnected.playerId).toBe(creator.playerId);
          expect(reconnected.handoffToken.length).toBeGreaterThan(0);
          expect(reconnected.reconnectToken?.length).toBeGreaterThan(0);

          sockets.push(
            await bounded(
              'reconnected creator websocket connection',
              host.websocketConnect(reconnected.wsUrl),
              5_000,
            ),
          );
          const resumedSummary = await waitForLobbyPlayer(
            host,
            creator.roomId,
            creator.playerId,
            (player, lobby) => lobby.phase === 'active' && player.status === 'connected',
            'built-artifact creator reconnect presence',
          );
          expect(lobbyPlayer(resumedSummary, creator.playerId)).toMatchObject({
            ready: true,
            status: 'connected',
          });

          // End the real two-client match through the runtime's disconnect and
          // reconnect-expiry path, then prove the result is durable and
          // observable from the copied artifact worker.
          closeSocketQuietly(sockets[1]);
          closeSocketQuietly(sockets[2]);
          await waitForLobbyPlayer(
            host,
            creator.roomId,
            creator.playerId,
            (player) => player.status === 'disconnected',
            'built-artifact terminal disconnect presence',
          );
          await waitForLobbyPlayer(
            host,
            creator.roomId,
            joiner.playerId,
            (player) => player.status === 'disconnected',
            'built-artifact peer terminal disconnect presence',
          );
          await new Promise((resolve) => setTimeout(resolve, 1_100));
          await bounded(
            'terminal reconnect-expiry room alarm',
            host.triggerRoomAlarm(creator.roomId),
            5_000,
          );
          const endedResults = await parseJson<RoomResultsResponseWire>(
            await host.fetch(`${host.baseUrl}/rooms/${creator.roomId}/results`),
          );
          expect(endedResults.roomId).toBe(creator.roomId);
          expect(endedResults.results).toMatchObject({
            reason: 'reconnect expired',
            players: expect.arrayContaining([
              expect.objectContaining({ playerId: creator.playerId, outcome: 'abandoned' }),
              expect.objectContaining({ playerId: joiner.playerId, outcome: 'abandoned' }),
            ]),
          });
          const endedLobby = await parseJson<RoomLobbySummaryWire>(
            await host.fetch(`${host.baseUrl}/lobbies/${creator.roomId}`),
          );
          expect(endedLobby.phase).toBe('finished');
          expect(endedLobby.playerCount).toBe(0);
        } finally {
          for (const socket of sockets) {
            closeSocketQuietly(socket);
          }
          await bounded('isolated artifact host stop', host.stop(), 10_000);
        }
        // The test port is released after stop().
        await expect(fetch(`http://127.0.0.1:${TEST_PORT}/health`)).rejects.toThrow();
      }),
    240_000,
  );
});

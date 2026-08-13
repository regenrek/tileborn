import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AssetLibraryReference,
  GameObjectCatalog,
  PlayerModelClipSet,
  PlayerModelRef,
  PluginId,
  decodePersistedTileborneMapJson,
  gameModeIdFromPluginId,
  makeClipId,
  makePackId,
  readPluginMapSettings,
  type MapId,
  type ProjectId,
} from '@tileborne/core';
import {
  PlaytestService,
  PlaytestSession,
  Running,
  assembleRuntimeMapPackage,
} from '@tileborne/services-build';
import { MainIpcRegistry, registerIpcHandlers } from '@tileborne/ipc-contracts';
import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';
import { Effect, Option, Schema, Stream } from 'effect';
import { PLUGIN_ID, exportBattleRoyaleModeData } from '@tileborne/plugin-battle-royale';
import { acceptedBattleRoyaleFireFlow } from '@tileborne/plugin-battle-royale/test';
import { vi } from 'vitest';

import {
  startPlaytestRuntimeHost,
  stopPlaytestRuntimeHost,
  type PlaytestRuntimeMetrics,
} from '../playtest-runtime-host.js';
import { AppLayer } from '../app-layer.js';
import { buildMainIpcHandlersForTests } from '../ipc/handlers.js';
import { createDesktopUpdaterController } from '../updater.js';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
  },
  dialog: {},
  shell: {},
}));

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const battleRoyalePluginRoot = path.resolve(desktopRoot, '../../packages/plugin-battle-royale');
const battleRoyalePluginId = Schema.decodeUnknownSync(PluginId)(PLUGIN_ID);
const PROJECT_ID = 'project:5b1901ca-1abd-42d6-aeac-553b34b9bda7' as ProjectId;
const MAP_ID = 'map:5b1901ca-1abd-42d6-aeac-553b34b9bda6';
const packId = makePackId('550e8400-e29b-41d4-a716-446655440999');
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

const playerModels = [
  new PlayerModelRef({
    id: 'model:hero',
    label: 'Hero',
    ref: new AssetLibraryReference({
      packId,
      kind: 'sprite',
      refId: 'placeable:test',
      clipId: clipIdAt(0),
    }),
    defaultClipId: clipIdAt(0),
    clips: new PlayerModelClipSet({
      idle: clipIdAt(0),
      walk: clipIdAt(1),
      run: clipIdAt(2),
      shoot: clipIdAt(3),
      reload: clipIdAt(4),
      hit: clipIdAt(5),
      death: clipIdAt(6),
      dash: clipIdAt(7),
      pickup: clipIdAt(8),
    }),
    anchor: { x: 0.5, y: 1 },
    hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
  }),
] as const;

const writeMapPackage = async (outputDirectory: string): Promise<void> => {
  const catalog = Schema.decodeUnknownSync(GameObjectCatalog)(
    JSON.parse(
      await readFile(
        path.join(battleRoyalePluginRoot, 'schemas', 'game-object-catalog.json'),
        'utf8',
      ),
    ),
  );
  const map = decodePersistedTileborneMapJson({
    id: MAP_ID,
    schemaVersion: 1,
    size: { width: 32, height: 32 },
    tileSize: { width: 32, height: 32 },
    layers: [],
    objects: [],
    properties: {},
  });
  const settingsMaxPlayers = readPluginMapSettings(map, PLUGIN_ID).maxPlayers;
  const playerCapacity =
    typeof settingsMaxPlayers === 'number'
      ? settingsMaxPlayers
      : typeof map.properties.maxPlayers === 'number'
        ? map.properties.maxPlayers
        : 32;

  await Effect.runPromise(
    assembleRuntimeMapPackage({
      projectId: PROJECT_ID,
      map,
      activeMode: {
        modeId: gameModeIdFromPluginId(battleRoyalePluginId),
        pluginId: battleRoyalePluginId,
      },
      pluginCatalogs: [
        {
          pluginId: battleRoyalePluginId,
          catalogs: [{ contributionId: `${PLUGIN_ID}#catalog`, catalog }],
        },
      ],
      playerModels,
      playerCapacity,
      modeDataExporter: exportBattleRoyaleModeData,
      engineVersion: '0.0.0-test',
      outputDirectory,
    }),
  );
};

const createPlaytestListInvoker = async (session: PlaytestSession) => {
  const registeredHandlers = new Map<string, (payload: unknown) => Promise<unknown>>();
  const playtestService = {
    start: () => Effect.die('not used'),
    assembleArtifact: () => Effect.die('not used'),
    subscribe: Stream.empty,
    list: () => Effect.succeed([session]),
    stop: () => Effect.die('not used'),
  };
  const packet = await Effect.runPromise(
    buildMainIpcHandlersForTests(
      createDesktopUpdaterController({ currentVersion: '0.0.0-test', packaged: false }),
    ).pipe(Effect.provideService(PlaytestService, playtestService), Effect.provide(AppLayer)),
  );
  const registration = registerIpcHandlers(
    MainIpcRegistry,
    {
      handle: (channel, handler) => {
        registeredHandlers.set(channel, handler);
        return () => {
          registeredHandlers.delete(channel);
        };
      },
      emit: () => undefined,
    },
    packet.handlers,
  );
  return {
    list: async () => {
      const handler = registeredHandlers.get('tileborne:playtest:list');
      if (handler === undefined) {
        throw new Error('No registered IPC handler for tileborne:playtest:list');
      }
      return handler({});
    },
    unregister: registration.unregister,
  };
};

const waitForAcceptedFireMetrics = async (input: {
  readonly sessionId: string;
  readonly list: () => Promise<unknown>;
}): Promise<PlaytestRuntimeMetrics> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const response = (await input.list()) as {
      readonly sessions?: readonly {
        readonly id: string;
        readonly runtimeMetrics?: PlaytestRuntimeMetrics;
      }[];
    };
    const metrics = response.sessions?.find(
      (session) => session.id === input.sessionId,
    )?.runtimeMetrics;
    const gameplayEvents = metrics?.hud?.gameplayEvents ?? [];
    if (gameplayEvents.filter((event) => event._tag === 'WeaponFired').length === 2) {
      return metrics!;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${input.sessionId} accepted fire HUD metrics`);
};

export const runtimeHostAcceptedFireSessionMetrics = async (): Promise<{
  readonly metrics: PlaytestRuntimeMetrics;
  readonly flow: ReturnType<typeof acceptedBattleRoyaleFireFlow>;
}> => {
  const tempParent = path.join(desktopRoot, '.tmp');
  await mkdir(tempParent, { recursive: true });
  const tempRoot = await mkdtemp(path.join(tempParent, 'runtime-host-fire-metrics-'));
  const sessionId = 'playtest:33333333-3333-4333-8333-944d944d944d' as PlaytestSession['id'];
  try {
    const artifactDirectory = path.join(tempRoot, 'artifact');
    const pluginRoot = path.join(tempRoot, 'plugin');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(artifactDirectory);

    const flow = acceptedBattleRoyaleFireFlow();
    const acceptedGameplayEventFrames = flow.events.map((event, sequence) => [
      ...BattleRoyaleProtocol.encodeServerMessage(
        new BattleRoyaleProtocol.GameplayEventFrame({ sequence, event }),
      ),
    ]);
    await writeFile(
      path.join(pluginRoot, 'tileborne-plugin.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: '@tileborne-plugins/hud-events-test',
          name: 'hud-events-test',
          version: '0.0.0',
          entry: { runtime: './dist/runtime.js' },
          contributes: {},
          permissions: [],
          dependsOn: [],
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(pluginRoot, 'dist', 'runtime.js'),
      [
        `const acceptedFrames = ${JSON.stringify(acceptedGameplayEventFrames)};`,
        'export function createRuntimeAdapter(host) {',
        '  let emitted = false;',
        '  return {',
        "    id: '@tileborne-plugins/hud-events-test',",
        '    onTick() {',
        '      if (emitted) return;',
        '      emitted = true;',
        '      for (const frame of acceptedFrames) host.msgOut?.push(Uint8Array.from(frame));',
        '      for (const frame of acceptedFrames) host.msgOut?.push(Uint8Array.from(frame));',
        '    },',
        '  };',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const session = new PlaytestSession({
      id: sessionId,
      projectId: PROJECT_ID,
      mapId: MAP_ID as MapId,
      status: new Running({}),
      startedAt: new Date(0).toISOString(),
      stoppedAt: Option.none(),
      runtimeUrl: Option.none(),
      artifactDirectory: Option.some(artifactDirectory),
      activePlugins: ['@tileborne-plugins/hud-events-test'],
    });
    const playtestList = await createPlaytestListInvoker(session);

    await startPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/hud-events-test', rootPath: pluginRoot }],
    });
    try {
      const metrics = await waitForAcceptedFireMetrics({ sessionId, list: playtestList.list });
      return { metrics, flow };
    } finally {
      playtestList.unregister();
    }
  } finally {
    await stopPlaytestRuntimeHost(sessionId);
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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
  gameObjectTypeIdForKey,
  hashBytes,
  makeClipId,
  makePackId,
  readPluginMapSettings,
  type BehaviorId,
  type MapId,
  type ProjectId,
} from '@tileborne/core';
import {
  assembleRuntimeMapPackage,
  PlaytestService,
  PlaytestSession,
  Running,
  Stopped,
} from '@tileborne/services-build';
import {
  BattleRoyaleProtocol,
  MainIpcRegistry,
  registerIpcHandlers,
} from '@tileborne/ipc-contracts';
import { hashRuntimeMapPackageEntry } from '@tileborne/runtime/map-package';
import { PluginManifest } from '@tileborne/plugin-api';
import { LocalPluginSource, materializePluginManifestInput } from '@tileborne/services-plugin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Option, Schema, Stream } from 'effect';
import {
  PLUGIN_ID,
  decodeServerFrame,
  exportBattleRoyaleModeData,
} from '@tileborne/plugin-battle-royale';
import { acceptedBattleRoyaleFireFlow } from '@tileborne/plugin-battle-royale/test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
  },
  dialog: {},
  shell: {},
}));

import { AppLayer } from '../app-layer.js';
import { createDesktopUpdaterController } from '../updater.js';
import {
  controlPlaytestRuntimeLifecycle,
  controlPlaytestBehaviorDebug,
  getActivePlaytestRuntimeCountForTests,
  getPlaytestBehaviorDebugSnapshot,
  getPlaytestRuntimeInputForTests,
  getPlaytestRuntimeMetrics,
  getPlaytestRuntimeSnapshot,
  hotReloadPlaytestBehavior,
  setPlaytestRuntimeInput,
  setPlaytestRuntimeSnapshotNotifier,
  startPlaytestRuntimeHost,
  stopOwnedPlaytestRuntimeHost,
  stopPlaytestRuntimeHost,
  type PlaytestRuntimeMetrics,
} from '../playtest-runtime-host.js';
import { buildMainIpcHandlersForTests, stopOwnedPlaytestSession } from '../ipc/handlers.js';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const battleRoyalePluginRoot = path.resolve(desktopRoot, '../../packages/plugin-battle-royale');
const require = createRequire(import.meta.url);
const packId = makePackId('550e8400-e29b-41d4-a716-446655440999');
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);
const MAP_ID = 'map:5b1901ca-1abd-42d6-aeac-553b34b9bda6';
const PROJECT_ID = 'project:5b1901ca-1abd-42d6-aeac-553b34b9bda7';
const RUNTIME_TICK_BEHAVIOR_ID = 'behavior:88888888-8888-4888-8888-888888888888' as BehaviorId;
const NEIGHBOR_BEHAVIOR_ID = 'behavior:99999999-9999-4999-8999-999999999999' as BehaviorId;
const ownerTempRoots: string[] = [];
const ownerSessionIds: string[] = [];

const withTempHome = async <A>(run: (home: string) => Promise<A>): Promise<A> => {
  const previous = process.env['TILEBORNE_HOME'];
  const home = await mkdtemp(path.join(tmpdir(), 'tileborne-services-'));
  process.env['TILEBORNE_HOME'] = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) {
      delete process.env['TILEBORNE_HOME'];
    } else {
      process.env['TILEBORNE_HOME'] = previous;
    }
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

const battleRoyalePluginId = Schema.decodeUnknownSync(PluginId)(PLUGIN_ID);

/**
 * Hosts boot from the ONE typed runtime map package (ADR-0030): tests assemble
 * a real package (BR catalog merged, placements projected, visuals baked) from
 * a persisted-map fixture instead of writing a bare map.json.
 */
const writeMapPackage = async (
  outputDirectory: string,
  persistedMapJson: unknown,
  models: readonly PlayerModelRef[] = [],
): Promise<void> => {
  const catalog = Schema.decodeUnknownSync(GameObjectCatalog)(
    JSON.parse(
      await readFile(
        path.join(battleRoyalePluginRoot, 'schemas', 'game-object-catalog.json'),
        'utf8',
      ),
    ),
  );
  const map = decodePersistedTileborneMapJson(persistedMapJson);
  // Same neutral-capacity sourcing the IPC handler uses: the BR-namespaced
  // authored `maxPlayers`, falling back to the legacy flat fixture key.
  const settingsMaxPlayers = readPluginMapSettings(map, PLUGIN_ID).maxPlayers;
  const flatMaxPlayers = map.properties.maxPlayers;
  const playerCapacity =
    typeof settingsMaxPlayers === 'number'
      ? settingsMaxPlayers
      : typeof flatMaxPlayers === 'number'
        ? flatMaxPlayers
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
      playerModels: models,
      playerCapacity,
      modeDataExporter: exportBattleRoyaleModeData,
      engineVersion: '0.0.0-test',
      outputDirectory,
    }),
  );
};

const makePlayerModel = (id: string, label: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label,
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
  });

const playerModels = [makePlayerModel('model:test', 'Test Model')] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const waitForTickCount = async (sessionId: string, minimumTickCount: number): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const metrics = getPlaytestRuntimeMetrics(sessionId);
    if (metrics && metrics.tickCount >= minimumTickCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${sessionId} to reach tickCount ${minimumTickCount}`);
};

const expectTickCountStable = async (sessionId: string, waitMs = 150): Promise<number> => {
  const before = getPlaytestRuntimeMetrics(sessionId)?.tickCount;
  expect(before).toBeDefined();
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  expect(getPlaytestRuntimeMetrics(sessionId)?.tickCount).toBe(before);
  return before!;
};

const waitForRuntimeInputWithoutSwapSlot = async (sessionId: string): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const currentInput = getPlaytestRuntimeInputForTests(sessionId, 'player-1');
    if (currentInput !== undefined && currentInput.swapSlot === undefined) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${sessionId} to acknowledge the swapSlot input edge`);
};

const projectileIdsFromFrames = (frames: readonly unknown[]): Set<string> =>
  new Set(
    frames.flatMap((frame) => {
      if (
        !isRecord(frame) ||
        frame._tag !== 'DeltaSnapshot' ||
        !Array.isArray(frame.projectilesUpdated)
      ) {
        return [];
      }
      return frame.projectilesUpdated.flatMap((projectile) =>
        isRecord(projectile) && typeof projectile.id === 'string' ? [projectile.id] : [],
      );
    }),
  );

const startRunningPlaytestRuntimeHost = async (
  input: Parameters<typeof startPlaytestRuntimeHost>[0],
): Promise<PlaytestRuntimeMetrics> => {
  const metrics = await startPlaytestRuntimeHost(input);
  expect(controlPlaytestRuntimeLifecycle(input.sessionId, 'start')).toBe('running');
  return metrics;
};

const forwardBridgePlaytestInput = (
  payload: Parameters<typeof setPlaytestRuntimeInput>[2] & {
    readonly sessionId: string;
    readonly playerId?: string;
    readonly active?: boolean;
  },
): void => {
  const { sessionId, playerId, active, ...input } = payload;
  if (active === false) {
    return;
  }
  setPlaytestRuntimeInput(sessionId, playerId ?? 'player-1', input);
};

const dispatchPointerMoveDigit3RafBridgeInput = async (input: {
  readonly sessionId: string;
  readonly tick: number;
  readonly click?: boolean;
  readonly holdAfterMouseDown?: (
    releaseMouse: () => void,
    emitted: readonly Parameters<typeof forwardBridgePlaytestInput>[0][],
  ) => Promise<void>;
  readonly forward: (payload: Parameters<typeof forwardBridgePlaytestInput>[0]) => void;
}): Promise<Parameters<typeof forwardBridgePlaytestInput>[0][]> => {
  type DomElement = {
    clientWidth: number;
    clientHeight: number;
    getBoundingClientRect: () => Record<string, unknown>;
    dispatchEvent: (event: unknown) => boolean;
  };
  type DomWindow = {
    readonly document: {
      getElementById: (id: string) => DomElement | null;
    };
    readonly navigator: unknown;
    readonly MouseEvent: new (type: string, init?: Record<string, unknown>) => unknown;
    readonly KeyboardEvent: new (type: string, init?: Record<string, unknown>) => unknown;
    requestAnimationFrame: (callback: (time: number) => void) => number;
    cancelAnimationFrame: (handle: number) => void;
    dispatchEvent: (event: unknown) => boolean;
    close: () => void;
  };
  const mutableGlobal = globalThis as typeof globalThis & Record<string, unknown>;
  const previousGlobals = {
    window: mutableGlobal.window,
    document: mutableGlobal.document,
    navigator: mutableGlobal.navigator,
    Audio: mutableGlobal.Audio,
    IS_REACT_ACT_ENVIRONMENT: mutableGlobal.IS_REACT_ACT_ENVIRONMENT,
  };
  const { JSDOM } = require('jsdom') as {
    readonly JSDOM: new (html: string) => { readonly window: DomWindow };
  };
  const bridgeModulePath = '../../renderer/components/playtest-viewport-input-bridge.js';
  const { PlaytestInputBridgeProducer } = (await import(bridgeModulePath)) as {
    readonly PlaytestInputBridgeProducer: (props: Record<string, unknown>) => null;
  };
  const dom = new JSDOM('<!doctype html><div id="root"></div><div id="viewport"></div>');
  const window = dom.window;
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  const container = window.document.getElementById('viewport');
  if (container === null) {
    throw new Error('expected viewport fixture element');
  }
  const rootElement = window.document.getElementById('root');
  if (rootElement === null) {
    throw new Error('expected root fixture element');
  }
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 100 },
  });
  container.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 110,
    bottom: 120,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  });

  let pointerFrame: ((time: number) => void) | undefined;
  window.requestAnimationFrame = (callback: (time: number) => void): number => {
    pointerFrame = callback;
    return 1;
  };
  window.cancelAnimationFrame = () => {
    pointerFrame = undefined;
  };

  mutableGlobal.window = window;
  mutableGlobal.document = window.document;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: window.navigator,
  });
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: class AudioStub {
      currentTime = 0;
      loop = false;
      volume = 1;
      constructor(readonly src?: string) {}
      addEventListener = vi.fn();
      pause = vi.fn();
      play = vi.fn(() => Promise.resolve());
      removeEventListener = vi.fn();
    },
  });
  let root: Root | undefined;
  try {
    const emitted: Parameters<typeof forwardBridgePlaytestInput>[0][] = [];
    Object.assign(window, {
      tileborne: {
        runtime: {
          playtestInput: vi.fn(
            async (payload: Parameters<typeof forwardBridgePlaytestInput>[0]) => {
              emitted.push(payload);
              input.forward(payload);
              return {};
            },
          ),
        },
      },
    });
    root = createRoot(rootElement as never);
    await act(async () => {
      root!.render(
        createElement(PlaytestInputBridgeProducer, {
          container: container as never,
          pluginId: 'battle-royale.renderer',
          sessionId: input.sessionId,
          tickCount: input.tick,
        }),
      );
    });
    try {
      container.dispatchEvent(
        new window.MouseEvent('pointermove', { clientX: 60, clientY: 110, bubbles: true }),
      );
      window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit3' }));
      expect(emitted).toHaveLength(1);
      pointerFrame?.(16);
      expect(emitted).toHaveLength(2);
      if (input.click === true) {
        container.dispatchEvent(
          new window.MouseEvent('mousedown', {
            button: 0,
            clientX: 110,
            clientY: 70,
            bubbles: true,
          }),
        );
        const releaseMouse = (): void => {
          window.dispatchEvent(new window.MouseEvent('mouseup', { button: 0, bubbles: true }));
        };
        if (input.holdAfterMouseDown === undefined) {
          releaseMouse();
          expect(emitted).toHaveLength(4);
        } else {
          await input.holdAfterMouseDown(releaseMouse, emitted);
        }
      }
      return emitted;
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  } finally {
    mutableGlobal.window = previousGlobals.window;
    mutableGlobal.document = previousGlobals.document;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previousGlobals.navigator,
    });
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: previousGlobals.Audio,
    });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: previousGlobals.IS_REACT_ACT_ENVIRONMENT,
    });
    dom.window.close();
  }
};

const startSimpleRuntimeHost = async (input: {
  readonly sessionId: string;
  readonly projectId?: ProjectId;
  readonly mapId?: MapId;
  readonly tempPrefix?: string;
  readonly pluginRoot?: string;
  readonly pluginId?: string;
}): Promise<{ readonly artifactDirectory: string; readonly pluginRoot: string }> => {
  const root = await mkdtemp(path.join(tmpdir(), input.tempPrefix ?? 'tileborne-runtime-owner-'));
  ownerTempRoots.push(root);
  const artifactDirectory = path.join(root, 'artifact');
  const pluginRoot = input.pluginRoot ?? path.join(root, 'plugin');
  const pluginId = input.pluginId ?? '@tileborne-plugins/test-runtime';
  if (input.pluginRoot === undefined) {
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
  }
  await mkdir(artifactDirectory, { recursive: true });
  await writeMapPackage(artifactDirectory, {
    id: input.mapId ?? MAP_ID,
    schemaVersion: 1,
    size: { width: 32, height: 32 },
    tileSize: { width: 32, height: 32 },
    layers: [],
    objects: [],
    properties: {},
  });
  if (input.pluginRoot === undefined) {
    await writeFile(
      path.join(pluginRoot, 'tileborne-plugin.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: pluginId,
          name: 'test-runtime',
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
      `export default { id: '${pluginId}', onTick() {} };\n`,
      'utf8',
    );
  }
  ownerSessionIds.push(input.sessionId);
  await startRunningPlaytestRuntimeHost({
    sessionId: input.sessionId,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.mapId === undefined ? {} : { mapId: input.mapId }),
    packageDirectory: artifactDirectory,
    pluginInstalls: [{ pluginId, rootPath: pluginRoot }],
  });
  return { artifactDirectory, pluginRoot };
};

const installRuntimeTickBehavior = async (
  artifactDirectory: string,
  code: string,
  additional: readonly {
    readonly behaviorId: BehaviorId;
    readonly code: string;
    readonly name: string;
  }[] = [],
): Promise<void> => {
  const entries = [
    { behaviorId: RUNTIME_TICK_BEHAVIOR_ID, code, name: 'runtime-tick' },
    ...additional,
  ];
  await mkdir(path.join(artifactDirectory, 'behaviors', 'modules'), { recursive: true });
  for (const entry of entries) {
    await writeFile(
      path.join(artifactDirectory, `behaviors/modules/${entry.name}.mjs`),
      entry.code,
      'utf8',
    );
  }
  const behaviors = {
    schemaVersion: 1,
    manifests: entries.map((entry) => ({
      schemaVersion: 1,
      id: entry.behaviorId,
      label: entry.name,
      source: {
        _tag: 'typescript',
        sourcePath: `behaviors/sources/${entry.name}.ts`,
        exportName: 'default',
      },
      requiredCapabilities: [],
    })),
    visualDefinitions: [],
    modules: entries.map((entry) => ({
      behaviorId: entry.behaviorId,
      sourceKind: 'typescript',
      modulePath: `behaviors/modules/${entry.name}.mjs`,
      hash: hashBytes(new TextEncoder().encode(entry.code)),
    })),
  };
  const behaviorBytes = new TextEncoder().encode(`${JSON.stringify(behaviors, null, 2)}\n`);
  await writeFile(path.join(artifactDirectory, 'behaviors.json'), behaviorBytes);
  const manifestPath = path.join(artifactDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    entryHashes: Record<string, string>;
  };
  manifest.entryHashes.behaviors = await hashRuntimeMapPackageEntry(behaviorBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

const createRegisteredMainIpcHarness = async () => {
  const registeredHandlers = new Map<string, (payload: unknown) => Promise<unknown>>();
  const transport = {
    handle: (channel: string, handler: (payload: unknown) => Promise<unknown>) => {
      registeredHandlers.set(channel, handler);
      return () => {
        registeredHandlers.delete(channel);
      };
    },
    emit: vi.fn(),
  };
  const packet = await Effect.runPromise(
    buildMainIpcHandlersForTests(
      createDesktopUpdaterController({ currentVersion: '0.0.0-test', packaged: false }),
    ).pipe(Effect.provide(AppLayer)),
  );
  const registration = registerIpcHandlers(MainIpcRegistry, transport, packet.handlers);
  return {
    ...packet,
    invoke: async (channel: string, payload: unknown) => {
      const handler = registeredHandlers.get(channel);
      if (handler === undefined) {
        throw new Error(`No registered IPC handler for ${channel}`);
      }
      return handler(payload);
    },
    unregister: registration.unregister,
  };
};

const installRegisteredStopRuntimePlugin = async (
  installer: Awaited<ReturnType<typeof createRegisteredMainIpcHarness>>['installer'],
  pluginRoot: string,
): Promise<void> => {
  await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
  const manifest = Schema.decodeUnknownSync(PluginManifest)(
    materializePluginManifestInput({
      schemaVersion: 1,
      id: '@tileborne-plugins/registered-stop-test',
      name: '@tileborne-plugins/registered-stop-test',
      version: '0.0.1',
      displayName: 'Registered Stop Test',
      description: 'Registered stop IPC integration fixture',
      author: 'Tileborne',
      license: 'MIT',
      engines: { tileborne: '^0.1.0' },
      entry: { editor: './dist/editor.js', runtime: './dist/runtime.js' },
      permissions: [],
      dependsOn: [],
      contributes: {
        gameModes: [
          {
            _tag: 'GameModeContribution',
            id: 'registered-stop-test',
            kind: 'declarative',
            display: { label: 'Registered Stop Test' },
            runtimeSystemId: 'registered-stop-test-runtime',
          },
        ],
        runtime: {
          systems: [
            {
              _tag: 'ExecutableRuntimeSystemContribution',
              id: 'registered-stop-test-runtime',
              kind: 'executable',
              display: { label: 'Registered Stop Test Runtime' },
              entry: './dist/runtime.js',
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    path.join(pluginRoot, 'tileborne-plugin.json'),
    `${JSON.stringify(Schema.encodeSync(PluginManifest)(manifest), null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(pluginRoot, 'dist', 'editor.js'), 'export {};\n', 'utf8');
  await writeFile(
    path.join(pluginRoot, 'dist', 'runtime.js'),
    [
      'let shutdownFailed = false;',
      "export default { id: '@tileborne-plugins/registered-stop-test', onTick() {}, onShutdown() {",
      "  if (!shutdownFailed) { shutdownFailed = true; throw new Error('fixture stop failed once'); }",
      '} };',
      '',
    ].join('\n'),
    'utf8',
  );
  await Effect.runPromise(installer.install(new LocalPluginSource({ path: pluginRoot })));
};

describe('playtest-runtime-host', () => {
  let tempRoot: string | undefined;
  const sessionIds: string[] = [];

  afterEach(async () => {
    setPlaytestRuntimeSnapshotNotifier(undefined);
    for (const sessionId of sessionIds.splice(0)) {
      await stopPlaytestRuntimeHost(sessionId);
    }
    for (const sessionId of ownerSessionIds.splice(0)) {
      await stopPlaytestRuntimeHost(sessionId);
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    for (const root of ownerTempRoots.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads entry.runtime plugins and advances runtime metrics', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    const pluginRoot = path.join(tempRoot, 'plugin');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(artifactDirectory, {
      id: MAP_ID,
      schemaVersion: 1,
      size: { width: 32, height: 32 },
      tileSize: { width: 32, height: 32 },
      layers: [],
      objects: [],
      properties: {},
    });
    await writeFile(
      path.join(pluginRoot, 'tileborne-plugin.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: '@tileborne-plugins/test-runtime',
          name: 'test-runtime',
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
      "export default { id: '@tileborne-plugins/test-runtime', onTick() {} };\n",
      'utf8',
    );

    const sessionId = 'runtime-host-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/test-runtime', rootPath: pluginRoot }],
    });

    await waitForTickCount(sessionId, 5);
    expect(getPlaytestRuntimeMetrics(sessionId)?.tickCount).toBeGreaterThanOrEqual(5);
  });

  it('publishes accepted fire frames into session HUD metrics with replay dedupe', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-hud-events-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    const pluginRoot = path.join(tempRoot, 'plugin');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(artifactDirectory, {
      id: MAP_ID,
      schemaVersion: 1,
      size: { width: 32, height: 32 },
      tileSize: { width: 32, height: 32 },
      layers: [],
      objects: [],
      properties: {},
    });

    const acceptedFireFlow = acceptedBattleRoyaleFireFlow();
    const acceptedGameplayEventFrames = acceptedFireFlow.events.map((event, sequence) => [
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

    const sessionId = 'runtime-host-hud-events-test';
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/hud-events-test', rootPath: pluginRoot }],
    });

    const gameplayEvents = getPlaytestRuntimeMetrics(sessionId)?.hud?.gameplayEvents ?? [];
    expect(gameplayEvents.map((event) => event._tag)).toEqual(['WeaponFired', 'WeaponFired']);
    expect(
      gameplayEvents.map((event) =>
        event._tag === 'WeaponFired'
          ? {
              sourceId: event.sourceId,
              tick: event.tick,
              origin: event.origin,
              direction: event.direction,
            }
          : undefined,
      ),
    ).toEqual([
      {
        sourceId: acceptedFireFlow.events[0]!.sourceId,
        tick: 8,
        origin: acceptedFireFlow.events[0]!.origin,
        direction: acceptedFireFlow.events[0]!.direction,
      },
      {
        sourceId: acceptedFireFlow.events[1]!.sourceId,
        tick: 8,
        origin: acceptedFireFlow.events[1]!.origin,
        direction: acceptedFireFlow.events[1]!.direction,
      },
    ]);
  });

  it('stops only the runtime owned by the matching project and map', async () => {
    const sessionId = 'runtime-host-owned-stop-test';
    await startSimpleRuntimeHost({
      sessionId,
      projectId: PROJECT_ID as ProjectId,
      mapId: MAP_ID as MapId,
    });
    await waitForTickCount(sessionId, 1);

    await expect(
      stopOwnedPlaytestRuntimeHost({
        sessionId,
        projectId: PROJECT_ID as ProjectId,
        mapId: 'map:11111111-1111-4111-8111-111111111111' as MapId,
      }),
    ).resolves.toBe(false);
    expect(getPlaytestRuntimeMetrics(sessionId)).toBeDefined();

    await expect(
      stopOwnedPlaytestRuntimeHost({
        sessionId,
        projectId: PROJECT_ID as ProjectId,
        mapId: MAP_ID as MapId,
      }),
    ).resolves.toBe(true);
    expect(getPlaytestRuntimeMetrics(sessionId)).toBeUndefined();
  });

  it('ignores stale owned stops after the same session id is rebound to a new map', async () => {
    const sessionId = 'runtime-host-rebound-owner-test';
    const originalMapId = MAP_ID as MapId;
    const nextMapId = 'map:22222222-2222-4222-8222-222222222222' as MapId;
    const { artifactDirectory, pluginRoot } = await startSimpleRuntimeHost({
      sessionId,
      projectId: PROJECT_ID as ProjectId,
      mapId: originalMapId,
    });

    await startRunningPlaytestRuntimeHost({
      sessionId,
      projectId: PROJECT_ID as ProjectId,
      mapId: nextMapId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/test-runtime', rootPath: pluginRoot }],
    });
    await waitForTickCount(sessionId, 1);

    await expect(
      stopOwnedPlaytestRuntimeHost({
        sessionId,
        projectId: PROJECT_ID as ProjectId,
        mapId: originalMapId,
      }),
    ).resolves.toBe(false);
    expect(getPlaytestRuntimeMetrics(sessionId)).toBeDefined();

    await expect(
      stopOwnedPlaytestRuntimeHost({
        sessionId,
        projectId: PROJECT_ID as ProjectId,
        mapId: nextMapId,
      }),
    ).resolves.toBe(true);
    expect(getPlaytestRuntimeMetrics(sessionId)).toBeUndefined();
  });

  it('treats zero-running-session owned cleanup as a no-op', async () => {
    await expect(
      stopOwnedPlaytestRuntimeHost({
        sessionId: 'runtime-host-missing-owner-test',
        projectId: PROJECT_ID as ProjectId,
        mapId: MAP_ID as MapId,
      }),
    ).resolves.toBe(false);
  });

  it('rejects mismatched IPC owned stop without stopping runtime or marking service stopped', async () => {
    const sessionId = 'playtest:33333333-3333-4333-8333-333333333333' as PlaytestSession['id'];
    const projectId = PROJECT_ID as ProjectId;
    const mapId = MAP_ID as MapId;
    const staleMapId = 'map:44444444-4444-4444-8444-444444444444' as MapId;
    await startSimpleRuntimeHost({ sessionId, projectId, mapId });
    await waitForTickCount(sessionId, 1);

    let sessions: readonly PlaytestSession[] = [
      new PlaytestSession({
        id: sessionId,
        projectId,
        mapId,
        status: new Running({}),
        startedAt: new Date(0).toISOString(),
        stoppedAt: Option.none(),
        runtimeUrl: Option.none(),
        artifactDirectory: Option.none(),
        activePlugins: ['@tileborne-plugins/test-runtime'],
      }),
    ];
    const playtestService = {
      start: () => Effect.die('not used'),
      assembleArtifact: () => Effect.die('not used'),
      subscribe: Stream.empty,
      list: () => Effect.succeed(sessions),
      stop: (targetSessionId: PlaytestSession['id']) =>
        Effect.sync(() => {
          const session = sessions.find((entry) => entry.id === targetSessionId);
          if (session === undefined) {
            throw new Error(`playtest session not found: ${targetSessionId}`);
          }
          const stopped = new PlaytestSession({
            ...session,
            status: new Stopped({}),
            stoppedAt: Option.some(new Date(1).toISOString()),
          });
          sessions = sessions.map((entry) => (entry.id === targetSessionId ? stopped : entry));
          return stopped;
        }),
    };

    await expect(
      Effect.runPromise(
        stopOwnedPlaytestSession({ sessionId, projectId, mapId: staleMapId }).pipe(
          Effect.provideService(PlaytestService, playtestService),
        ),
      ),
    ).rejects.toThrow('playtest session owner mismatch');
    expect(getPlaytestRuntimeMetrics(sessionId)).toBeDefined();
    expect(sessions.filter((session) => session.status._tag === 'Running')).toHaveLength(1);

    await expect(
      Effect.runPromise(
        stopOwnedPlaytestSession({ sessionId, projectId, mapId }).pipe(
          Effect.provideService(PlaytestService, playtestService),
        ),
      ),
    ).resolves.toMatchObject({ status: { _tag: 'Stopped' } });
    expect(sessions.filter((session) => session.status._tag === 'Running')).toHaveLength(0);
    expect(getActivePlaytestRuntimeCountForTests()).toBe(0);
  });

  it('stops owned playtests through the registered IPC handler and live service after retryable failure', async () =>
    withTempHome(async (home) => {
      const harness = await createRegisteredMainIpcHarness();
      try {
        const pluginRoot = path.join(home, 'registered-stop-plugin');
        await installRegisteredStopRuntimePlugin(harness.installer, pluginRoot);
        const projectId = await Effect.runPromise(
          harness.projects.create({ name: 'Registered Stop' }),
        );
        const mapId = await Effect.runPromise(
          harness.maps.create(projectId, { width: 16, height: 16 }),
        );
        const session = await Effect.runPromise(harness.playtest.start(projectId, mapId));
        await startSimpleRuntimeHost({
          sessionId: session.id,
          projectId,
          mapId,
          tempPrefix: 'tileborne-registered-stop-runtime-',
          pluginRoot,
          pluginId: '@tileborne-plugins/registered-stop-test',
        });
        await waitForTickCount(session.id, 1);

        const staleMapId = 'map:44444444-4444-4444-8444-444444444444' as MapId;
        const mismatch = await harness.invoke('tileborne:playtest:stop', {
          sessionId: session.id,
          projectId,
          mapId: staleMapId,
        });
        expect(mismatch).toMatchObject({
          message: expect.stringContaining('playtest session owner mismatch'),
        });
        expect(getActivePlaytestRuntimeCountForTests()).toBe(1);
        const listedAfterMismatch = (await harness.invoke('tileborne:playtest:list', {})) as {
          readonly sessions: readonly { readonly status: string }[];
        };
        expect(
          listedAfterMismatch.sessions.filter((entry) => entry.status === 'Running'),
        ).toHaveLength(1);

        const failedStop = await harness.invoke('tileborne:playtest:stop', {
          sessionId: session.id,
          projectId,
          mapId,
        });
        expect(failedStop).toMatchObject({
          message: expect.stringContaining('fixture stop failed once'),
        });
        expect(getActivePlaytestRuntimeCountForTests()).toBe(1);
        const listedAfterFailure = (await harness.invoke('tileborne:playtest:list', {})) as {
          readonly sessions: readonly { readonly status: string }[];
        };
        expect(
          listedAfterFailure.sessions.filter((entry) => entry.status === 'Running'),
        ).toHaveLength(1);

        const stopped = await harness.invoke('tileborne:playtest:stop', {
          sessionId: session.id,
          projectId,
          mapId,
        });
        expect(stopped).toMatchObject({ session: { id: session.id, status: 'Stopped' } });
        const listedAfterRetry = (await harness.invoke('tileborne:playtest:list', {})) as {
          readonly sessions: readonly { readonly status: string }[];
        };
        expect(
          listedAfterRetry.sessions.filter((entry) => entry.status === 'Running'),
        ).toHaveLength(0);
        expect(getActivePlaytestRuntimeCountForTests()).toBe(0);
      } finally {
        harness.unregister();
      }
    }));

  it('executes packaged behaviors through the production isolated host without freezing playtest', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-behavior-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    const pluginRoot = path.join(tempRoot, 'plugin');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(artifactDirectory, {
      id: MAP_ID,
      schemaVersion: 1,
      size: { width: 32, height: 32 },
      tileSize: { width: 32, height: 32 },
      layers: [],
      objects: [],
      properties: {},
    });
    await installRuntimeTickBehavior(
      artifactDirectory,
      `export default {id:'test.desktop-runaway',sourceKind:'typescript',state:{},on:{'runtime.tick':()=>{while(true){}}}};`,
    );
    await writeFile(
      path.join(pluginRoot, 'tileborne-plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: '@tileborne-plugins/test-runtime',
        name: 'test-runtime',
        version: '0.0.0',
        entry: { runtime: './dist/runtime.js' },
        contributes: {},
        permissions: [],
        dependsOn: [],
      }),
      'utf8',
    );
    await writeFile(
      path.join(pluginRoot, 'dist', 'runtime.js'),
      "export default { id: '@tileborne-plugins/test-runtime', onTick() {} };\n",
      'utf8',
    );

    const sessionId = 'runtime-host-behavior-isolation-test';
    sessionIds.push(sessionId);
    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/test-runtime', rootPath: pluginRoot }],
    });

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const event = getPlaytestRuntimeMetrics(sessionId)?.lastPluginEvent;
      if (event?.includes('Behavior worker exceeded')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(getPlaytestRuntimeMetrics(sessionId)?.lastPluginEvent).toContain(
      'Behavior worker exceeded',
    );
  });

  it('acknowledges plugin-declared input edges once before delayed behavior failures can replay them', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-edge-ack-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    const pluginRoot = path.join(tempRoot, 'plugin');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(artifactDirectory, {
      id: MAP_ID,
      schemaVersion: 1,
      size: { width: 32, height: 32 },
      tileSize: { width: 32, height: 32 },
      layers: [],
      objects: [],
      properties: {},
    });
    await installRuntimeTickBehavior(
      artifactDirectory,
      `export default {id:'test.delayed-failure',sourceKind:'typescript',state:{},on:{'runtime.tick':()=>{while(true){}}}};`,
    );
    await writeFile(
      path.join(pluginRoot, 'tileborne-plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: '@tileborne-plugins/test-edge-ack',
        name: 'test-edge-ack',
        version: '0.0.0',
        entry: { runtime: './dist/runtime.js' },
        contributes: {},
        permissions: [],
        dependsOn: [],
      }),
      'utf8',
    );
    await writeFile(
      path.join(pluginRoot, 'dist', 'runtime.js'),
      [
        'globalThis.__tileborneEdgeAckOneShotCount = 0;',
        'globalThis.__tileborneEdgeAckShootCount = 0;',
        "export const playtestInputEdgeFields = ['shoot', 'reload', 'interact', 'drop'];",
        "export const playtestHeldBooleanInputFields = ['shoot'];",
        'export const createRuntimeAdapter = (host) => ({',
        "  id: '@tileborne-plugins/test-edge-ack',",
        '  onTick() {',
        "    const input = host.getPlayerInput?.('player-1');",
        '    if (input?.reload || input?.interact || input?.drop) {',
        '      globalThis.__tileborneEdgeAckOneShotCount += 1;',
        '    }',
        '    if (input?.shoot) {',
        '      globalThis.__tileborneEdgeAckShootCount += 1;',
        '    }',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    );

    const sessionId = 'runtime-host-edge-ack-test';
    sessionIds.push(sessionId);
    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/test-edge-ack', rootPath: pluginRoot }],
    });

    setPlaytestRuntimeInput(sessionId, 'player-1', {
      tick: 1,
      seq: 1,
      shoot: true,
      reload: true,
      interact: true,
      drop: true,
      abilities: [],
    });

    let deadline = Date.now() + 700;
    while (Date.now() < deadline) {
      const currentInput = getPlaytestRuntimeInputForTests(sessionId, 'player-1');
      const oneShotCount = (globalThis as { __tileborneEdgeAckOneShotCount?: number })
        .__tileborneEdgeAckOneShotCount;
      if (
        oneShotCount === 1 &&
        currentInput?.shoot === true &&
        currentInput.reload === false &&
        currentInput.interact === false &&
        currentInput.drop === false
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(
      (globalThis as { __tileborneEdgeAckOneShotCount?: number }).__tileborneEdgeAckOneShotCount,
    ).toBe(1);
    expect(getPlaytestRuntimeInputForTests(sessionId, 'player-1')).toEqual(
      expect.objectContaining({
        shoot: true,
        reload: false,
        interact: false,
        drop: false,
      }),
    );

    setPlaytestRuntimeInput(sessionId, 'player-1', {
      tick: 2,
      seq: 2,
      shoot: true,
      reload: true,
      interact: true,
      drop: true,
      abilities: [],
    });

    deadline = Date.now() + 300;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(
      (globalThis as { __tileborneEdgeAckOneShotCount?: number }).__tileborneEdgeAckOneShotCount,
    ).toBe(1);
    expect(
      (globalThis as { __tileborneEdgeAckShootCount?: number }).__tileborneEdgeAckShootCount,
    ).toBeGreaterThan(1);
    expect(getPlaytestRuntimeInputForTests(sessionId, 'player-1')).toEqual(
      expect.objectContaining({
        shoot: true,
        reload: false,
        interact: false,
        drop: false,
      }),
    );
  });

  it('inspects, pauses, single-steps, continues, and hot-reloads with last-known-good fallback', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-debug-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    const pluginRoot = path.join(tempRoot, 'plugin');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(artifactDirectory, {
      id: MAP_ID,
      schemaVersion: 1,
      size: { width: 32, height: 32 },
      tileSize: { width: 32, height: 32 },
      layers: [],
      objects: [],
      properties: {},
    });
    const oversizedDebugValue = 'x'.repeat(5_000);
    const debugItems = Array.from({ length: 80 }, (_, index) => index);
    const initialCode = `export default {id:'test.desktop-debug',sourceKind:'typescript',state:{count:0,apiToken:'super-secret',homePath:'/Users/test/private.txt',temporaryPath:'/private/tmp/session.json',rootPath:'/etc/passwd',windowsPath:'C:\\\\Users\\\\test\\\\private.txt',uncPath:'\\\\\\\\server\\\\share\\\\private.txt',traversalPath:'assets/../../private.txt',embeddedError:'Error: failed reading /tmp/private.txt at runtime',embeddedStack:'at run (/Users/test/project/behavior.ts:4:2)',fileUri:'open file:///private/tmp/session.json',tildePath:'config at ~/.tileborne/private.json',driveRelative:'failed at C:private\\\\token.txt',embeddedUnc:'network path \\\\\\\\server\\\\share\\\\private.txt failed',colonEmbedded:'Error:/Users/alice/project/behavior.ts',commaEmbedded:'open,/private/tmp/secret',safeLabel:'assets/door.png',safeUrl:'https://example.invalid/assets/door.png',oversized:${JSON.stringify(oversizedDebugValue)},items:${JSON.stringify(debugItems)}},on:{'runtime.tick':({state,event})=>[state.set('count',(state.get('count')??0)+1),{kind:'debug.tick',payload:{tick:event.tick}}]}};`;
    const neighborCode = `export default {id:'test.neighbor',sourceKind:'typescript',state:{count:0},on:{'runtime.tick':({state})=>state.set('count',(state.get('count')??0)+1)}};`;
    await installRuntimeTickBehavior(artifactDirectory, initialCode, [
      {
        behaviorId: NEIGHBOR_BEHAVIOR_ID,
        code: neighborCode,
        name: 'neighbor',
      },
    ]);
    await writeFile(
      path.join(pluginRoot, 'tileborne-plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: '@tileborne-plugins/test-runtime',
        name: 'test-runtime',
        version: '0.0.0',
        entry: { runtime: './dist/runtime.js' },
        contributes: {},
        permissions: [],
        dependsOn: [],
      }),
      'utf8',
    );
    await writeFile(
      path.join(pluginRoot, 'dist', 'runtime.js'),
      "export default { id: '@tileborne-plugins/test-runtime', onTick() {} };\n",
      'utf8',
    );

    const sessionId = 'runtime-host-debug-test';
    sessionIds.push(sessionId);
    await startRunningPlaytestRuntimeHost({
      sessionId,
      projectId: PROJECT_ID as ProjectId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/test-runtime', rootPath: pluginRoot }],
    });

    const deadline = Date.now() + 2_000;
    while ((getPlaytestBehaviorDebugSnapshot(sessionId)?.tick ?? 0) < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(
      getPlaytestBehaviorDebugSnapshot(sessionId)?.tick,
      getPlaytestRuntimeMetrics(sessionId)?.lastPluginEvent,
    ).toBeGreaterThanOrEqual(2);
    const paused = await controlPlaytestBehaviorDebug(sessionId, 'pause');
    expect(paused.status).toBe('paused');
    const pausedTrace = paused.traces
      .filter(({ behaviorId }) => behaviorId === RUNTIME_TICK_BEHAVIOR_ID)
      .at(-1);
    expect(pausedTrace).toMatchObject({
      behaviorId: RUNTIME_TICK_BEHAVIOR_ID,
      instanceId: RUNTIME_TICK_BEHAVIOR_ID,
      eventId: 'runtime.tick',
      source: {
        sourceKind: 'typescript',
        filePath: 'behaviors/sources/runtime-tick.ts',
      },
      commands: [{ kind: 'state.set' }, { kind: 'debug.tick' }],
      state: {
        apiToken: '[redacted]',
        homePath: '[redacted path]',
        temporaryPath: '[redacted path]',
        rootPath: '[redacted path]',
        windowsPath: '[redacted path]',
        uncPath: '[redacted path]',
        traversalPath: '[redacted path]',
        embeddedError: '[redacted path]',
        embeddedStack: '[redacted path]',
        fileUri: '[redacted path]',
        tildePath: '[redacted path]',
        driveRelative: '[redacted path]',
        embeddedUnc: '[redacted path]',
        colonEmbedded: '[redacted path]',
        commaEmbedded: '[redacted path]',
        safeLabel: 'assets/door.png',
        safeUrl: 'https://example.invalid/assets/door.png',
      },
    });
    expect(pausedTrace?.state.oversized).toBe(`${'x'.repeat(4_096)}…`);
    expect(pausedTrace?.state.items).toHaveLength(64);
    const pausedTick = paused.tick;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getPlaytestBehaviorDebugSnapshot(sessionId)?.tick).toBe(pausedTick);

    const stepped = await controlPlaytestBehaviorDebug(sessionId, 'step');
    expect(stepped).toMatchObject({ status: 'paused', tick: pausedTick + 1 });

    const replacementCode = `export default {id:'test.desktop-debug',sourceKind:'typescript',state:{count:0},on:{'runtime.tick':({state})=>state.set('count',(state.get('count')??0)+10)}};`;
    const replacementHash = hashBytes(new TextEncoder().encode(replacementCode));
    expect(
      await hotReloadPlaytestBehavior(PROJECT_ID as ProjectId, {
        behaviorId: RUNTIME_TICK_BEHAVIOR_ID,
        sourceKind: 'typescript',
        modulePath: 'behaviors/modules/runtime-tick.mjs',
        hash: replacementHash,
        code: replacementCode,
      }),
    ).toMatchObject([{ status: 'applied', hash: replacementHash }]);
    const afterReload = await controlPlaytestBehaviorDebug(sessionId, 'step');
    const reloadedCount = afterReload.states.find(
      ({ behaviorId }) => behaviorId === RUNTIME_TICK_BEHAVIOR_ID,
    )?.state.count;

    const rejected = await hotReloadPlaytestBehavior(PROJECT_ID as ProjectId, {
      behaviorId: RUNTIME_TICK_BEHAVIOR_ID,
      sourceKind: 'typescript',
      modulePath: 'behaviors/modules/runtime-tick.mjs',
      hash: replacementHash,
      code: `${replacementCode}\n// invalid hash`,
    });
    expect(rejected).toMatchObject([{ status: 'rejected-using-last-known-good' }]);
    const neighborReplacement = `export default {id:'test.neighbor',sourceKind:'typescript',state:{count:0},on:{'runtime.tick':({state})=>state.set('count',(state.get('count')??0)+5)}};`;
    const neighborHash = hashBytes(new TextEncoder().encode(neighborReplacement));
    expect(
      await hotReloadPlaytestBehavior(PROJECT_ID as ProjectId, {
        behaviorId: NEIGHBOR_BEHAVIOR_ID,
        sourceKind: 'typescript',
        modulePath: 'behaviors/modules/neighbor.mjs',
        hash: neighborHash,
        code: neighborReplacement,
      }),
    ).toMatchObject([{ status: 'applied', hash: neighborHash }]);
    const afterRejected = await controlPlaytestBehaviorDebug(sessionId, 'step');
    expect(
      afterRejected.states.find(({ behaviorId }) => behaviorId === RUNTIME_TICK_BEHAVIOR_ID)?.state
        .count,
    ).toBe(Number(reloadedCount) + 10);
    expect(
      afterRejected.states.find(({ behaviorId }) => behaviorId === NEIGHBOR_BEHAVIOR_ID)?.state
        .count,
    ).toBeGreaterThanOrEqual(5);
    expect(afterRejected.lastReload).toMatchObject({
      behaviorId: NEIGHBOR_BEHAVIOR_ID,
      status: 'applied',
    });

    const continued = await controlPlaytestBehaviorDebug(sessionId, 'continue');
    expect(continued.status).toBe('running');
  });

  it('routes a legacy-`kind` map through the package decode contract before the plugin reads it', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-legacy-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    const pluginRoot = path.join(tempRoot, 'plugin');
    const capturePath = path.join(tempRoot, 'captured.json');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });

    // Pre-ADR-0019 map: free-string `kind` and a placement that omits its
    // optional sub-keys. Package assembly + the package loader both route
    // through the ONE persisted-map decode contract (migrate legacy kinds to
    // catalog GameObjectTypeIds), so the plugin sees the canonical wire shape.
    await writeMapPackage(artifactDirectory, {
      id: MAP_ID,
      schemaVersion: 1,
      size: { width: 32, height: 32 },
      tileSize: { width: 32, height: 32 },
      layers: [],
      objects: [
        {
          id: 'object:f08061c1-423d-4532-b972-0cb221b1a08a',
          kind: 'spawn-point',
          x: 10,
          y: 20,
          layerId: 'layer:00000000-0000-4000-8000-000000000001',
          properties: {},
          placement: {
            placeableId: 'placeable:11111111-1111-4111-8111-111111111111',
            source: 'manual',
          },
        },
      ],
      properties: { maxPlayers: 1 },
    });

    await writeFile(
      path.join(pluginRoot, 'tileborne-plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: '@tileborne-plugins/capture-runtime',
        name: 'capture-runtime',
        version: '0.0.0',
        entry: { runtime: './dist/runtime.js' },
        contributes: {},
        permissions: [],
        dependsOn: [],
      }),
      'utf8',
    );

    // The adapter captures the exact package JSON the host hands it: the
    // encoded `RuntimeMapPackage` with the canonical `TileborneMap` wire map.
    await writeFile(
      path.join(pluginRoot, 'dist', 'runtime.js'),
      [
        'import { writeFileSync } from "node:fs";',
        'export const createRuntimeAdapter = (host) => {',
        '  const mapPackage = host.getMapPackage();',
        '  const obj = mapPackage.map.objects[0];',
        `  writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
        '    kind: obj.kind,',
        '    placement: obj.placement,',
        '  }));',
        '  return { id: "@tileborne-plugins/capture-runtime", onTick() {} };',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );

    const sessionId = 'runtime-host-legacy-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/capture-runtime', rootPath: pluginRoot }],
    });

    await waitForTickCount(sessionId, 1);

    const captured = JSON.parse(await readFile(capturePath, 'utf8')) as {
      readonly kind: string;
      readonly placement: { readonly placeableId: string; readonly source: string } | undefined;
    };

    // Migrated: legacy slug resolved to the catalog GameObjectTypeId.
    expect(captured.kind).toBe(gameObjectTypeIdForKey('spawn-point'));
    // The authored placement survives the package round-trip losslessly.
    expect(captured.placement).toMatchObject({
      placeableId: 'placeable:11111111-1111-4111-8111-111111111111',
      source: 'manual',
    });
  });

  it('forwards playtest input to the battle royale adapter and updates player position', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-movement-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: 'spawn-point',
            x: 10,
            y: 20,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      },
      playerModels,
    );

    const sessionId = 'runtime-host-movement-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);
    const before = getPlaytestRuntimeSnapshot(sessionId);
    expect(before?.players[0]).toMatchObject({ playerId: 'player-1', x: 10, y: 20 });

    setPlaytestRuntimeInput(sessionId, 'player-1', {
      tick: 3,
      seq: 1,
      dir: 0,
      shoot: false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
    await waitForTickCount(sessionId, 6);

    const after = getPlaytestRuntimeSnapshot(sessionId);
    expect(after?.players[0]?.x).toBeGreaterThan(before?.players[0]?.x ?? 0);
    expect(getPlaytestRuntimeMetrics(sessionId)?.playerCount).toBe(1);
  });

  it('freezes authoritative gameplay before start and during local pause, then resumes ticks and world state', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-lifecycle-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: 'spawn-point',
            x: 10,
            y: 20,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      },
      playerModels,
    );

    const sessionId = 'runtime-host-lifecycle-test';
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    const beforeStartSnapshot = getPlaytestRuntimeSnapshot(sessionId);
    const beforeStartHealth = getPlaytestRuntimeMetrics(sessionId)?.hud?.localPlayer?.health;
    expect(beforeStartSnapshot?.players[0]).toMatchObject({
      playerId: 'player-1',
      x: 10,
      y: 20,
    });
    expect(beforeStartHealth).toBeGreaterThan(0);

    setPlaytestRuntimeInput(sessionId, 'player-1', {
      tick: 0,
      seq: 1,
      dir: 0,
      shoot: false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
    await expectTickCountStable(sessionId);
    expect(getPlaytestRuntimeSnapshot(sessionId)).toEqual(beforeStartSnapshot);
    expect(getPlaytestRuntimeMetrics(sessionId)?.hud?.localPlayer?.health).toBe(beforeStartHealth);

    expect(controlPlaytestRuntimeLifecycle(sessionId, 'start')).toBe('running');
    await waitForTickCount(sessionId, 3);
    const runningSnapshot = getPlaytestRuntimeSnapshot(sessionId);
    expect(runningSnapshot?.players[0]?.x).toBeGreaterThan(beforeStartSnapshot?.players[0]?.x ?? 0);

    expect(controlPlaytestRuntimeLifecycle(sessionId, 'pause')).toBe('paused');
    const pausedTick = getPlaytestRuntimeMetrics(sessionId)?.tickCount;
    const pausedHealth = getPlaytestRuntimeMetrics(sessionId)?.hud?.localPlayer?.health;
    const pausedSnapshot = getPlaytestRuntimeSnapshot(sessionId);
    setPlaytestRuntimeInput(sessionId, 'player-1', {
      tick: pausedTick ?? 0,
      seq: 2,
      dir: 0,
      shoot: false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
    expect(await expectTickCountStable(sessionId)).toBe(pausedTick);
    expect(getPlaytestRuntimeSnapshot(sessionId)).toEqual(pausedSnapshot);
    expect(getPlaytestRuntimeMetrics(sessionId)?.hud?.localPlayer?.health).toBe(pausedHealth);

    expect(controlPlaytestRuntimeLifecycle(sessionId, 'resume')).toBe('running');
    await waitForTickCount(sessionId, (pausedTick ?? 0) + 3);
    expect(getPlaytestRuntimeSnapshot(sessionId)?.players[0]?.x).toBeGreaterThan(
      pausedSnapshot?.players[0]?.x ?? 0,
    );
  });

  it('rejects battle royale playtest startup when the map has no authored spawn anchors', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-invalid-br-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [],
        properties: { maxPlayers: 1 },
      },
      playerModels,
    );

    const sessionId = 'runtime-host-invalid-br-test';

    await expect(
      startPlaytestRuntimeHost({
        sessionId,
        packageDirectory: artifactDirectory,
        pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
      }),
    ).rejects.toThrow(/spawnAnchors/);
    expect(getPlaytestRuntimeMetrics(sessionId)).toBeUndefined();
    expect(getPlaytestRuntimeSnapshot(sessionId)).toBeUndefined();
  });

  it('starts battle royale from a canonical gobj map and preserves authored spawn coordinates', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-canonical-br-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: gameObjectTypeIdForKey('spawn-point'),
            x: 80,
            y: 96,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: { team: 'solo', weight: 1 },
          },
        ],
        properties: { maxPlayers: 1 },
      },
      playerModels,
    );

    const sessionId = 'runtime-host-canonical-br-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);

    const snapshot = getPlaytestRuntimeSnapshot(sessionId);
    expect(snapshot?.players).toEqual([{ playerId: 'player-1', x: 80, y: 96 }]);
    expect(snapshot?.frame).toBeInstanceOf(Uint8Array);
    const frame = decodeServerFrame(snapshot!.frame!);
    expect(frame).toMatchObject({
      _tag: 'WelcomeSnapshot',
      players: [
        {
          id: 'player-1',
          modelId: 'model:test',
          animation: { modelId: 'model:test', clipKey: 'idle' },
        },
      ],
    });
    expect(getPlaytestRuntimeMetrics(sessionId)?.playerCount).toBe(1);
  });

  it('hands selectedPlayerModelId to the plugin as the player-1 session selection', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-selection-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    // Two baked models: the package default is the FIRST one, so asserting
    // the second proves the host's selectedPlayerModelId reaches the plugin
    // through `getPlayerModelSelections` (the session channel) and wins.
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: gameObjectTypeIdForKey('spawn-point'),
            x: 10,
            y: 20,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      },
      [makePlayerModel('model:test', 'Test Model'), makePlayerModel('model:alt', 'Alt Model')],
    );

    const sessionId = 'runtime-host-selection-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
      selectedPlayerModelId: 'model:alt',
    });

    await waitForTickCount(sessionId, 2);
    const snapshot = getPlaytestRuntimeSnapshot(sessionId);
    expect(snapshot?.frame).toBeInstanceOf(Uint8Array);
    const frame = decodeServerFrame(snapshot!.frame!);
    expect(frame).toMatchObject({
      _tag: 'WelcomeSnapshot',
      players: [
        {
          id: 'player-1',
          modelId: 'model:alt',
          animation: { modelId: 'model:alt', clipKey: 'idle' },
        },
      ],
    });
  });

  it('feeds authored battle royale settings into runtime HUD snapshots', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-settings-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: 'spawn-point',
            x: 10,
            y: 20,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: {},
          },
        ],
        properties: {
          maxPlayers: 1,
          battleRoyale: {
            damage: { playerHealth: 55 },
            zone: {
              damagePerSecOutside: 9,
              schedule: { waitSec: 5, shrinkSec: 5, holdSec: 5, shrinkPhases: 2 },
            },
          },
        },
      },
      playerModels,
    );

    const sessionId = 'runtime-host-settings-test';
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    const hud = getPlaytestRuntimeMetrics(sessionId)?.hud;
    expect(hud?.localPlayer).toMatchObject({
      playerId: 'player-1',
      health: 55,
    });
    expect(hud?.totalPlayers).toBe(1);
  });

  it('forwards aim and weapon slot input to the battle royale projectile system', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-projectile-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: 'spawn-point',
            x: 10,
            y: 20,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      },
      playerModels,
    );

    const decodedFrames: unknown[] = [];
    setPlaytestRuntimeSnapshotNotifier((_sessionId, frame) => {
      decodedFrames.push(decodeServerFrame(frame));
    });

    const sessionId = 'runtime-host-projectile-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);
    setPlaytestRuntimeInput(sessionId, 'player-1', {
      tick: 3,
      seq: 1,
      dir: 0,
      shoot: true,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
      aimDeg: 90,
      swapSlot: 2,
    });
    await waitForTickCount(sessionId, 6);

    const deltaWithProjectile = decodedFrames.find(
      (frame): frame is { readonly projectilesUpdated: readonly Record<string, unknown>[] } =>
        isRecord(frame) &&
        frame._tag === 'DeltaSnapshot' &&
        Array.isArray(frame.projectilesUpdated) &&
        frame.projectilesUpdated.length > 0,
    );
    expect(deltaWithProjectile).toBeDefined();
    const projectile = deltaWithProjectile?.projectilesUpdated[0];
    expect(projectile).toBeDefined();
    expect(Option.getOrUndefined(projectile?.weaponSlot as Option.Option<number>)).toBe(2);
    expect(Option.getOrUndefined(projectile?.vx as Option.Option<number>)).toBeCloseTo(0);
    expect(Option.getOrUndefined(projectile?.vy as Option.Option<number>)).toBeGreaterThan(0);

    const diagnostics = getPlaytestRuntimeMetrics(sessionId)?.diagnostics;
    expect(diagnostics?.bandwidth.inputEvents).toBeGreaterThanOrEqual(1);
    expect(diagnostics?.bandwidth.snapshotFrames).toBeGreaterThan(0);
    expect(diagnostics?.entities.players).toBe(1);
    expect(diagnostics?.debugOverlay.spawnSlots).toBe(1);
    expect(diagnostics?.debugOverlay.hitboxes).toBeGreaterThan(0);
    expect(diagnostics?.replay.rollingHash).toMatch(/^fnv1a:[0-9a-f]{8}$/);
    expect(diagnostics?.replay.deterministicVerifier).toBe('battle-royale-replay-harness');
    expect(diagnostics?.budgets.snapshotOverBudget).toBe(false);
    expect(diagnostics?.budgets.snapshotFrameBudgetBytes).toBe(8_192);
    expect(diagnostics?.budgets.inputBacklogBudgetFrames).toBeGreaterThan(0);
  });

  it('forwards pointermove-Digit3-RAF bridge payloads until the BR runtime tick consumes one slot edge', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-raf-edge-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: 'spawn-point',
            x: 10,
            y: 20,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      },
      playerModels,
    );

    const decodedFrames: unknown[] = [];
    setPlaytestRuntimeSnapshotNotifier((_sessionId, frame) => {
      decodedFrames.push(decodeServerFrame(frame));
    });

    const sessionId = 'runtime-host-raf-edge-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);
    const beforeEdgeTick = getPlaytestRuntimeMetrics(sessionId)?.tickCount ?? 0;
    expect(controlPlaytestRuntimeLifecycle(sessionId, 'pause')).toBe('paused');

    const bridge = vi.fn((payload: Parameters<typeof forwardBridgePlaytestInput>[0]) => {
      forwardBridgePlaytestInput(payload);
    });
    const emitted = await dispatchPointerMoveDigit3RafBridgeInput({
      sessionId,
      tick: beforeEdgeTick,
      click: true,
      forward: bridge,
    });
    expect(emitted).toEqual([
      expect.objectContaining({ sessionId, tick: beforeEdgeTick, seq: 1, swapSlot: 3, aimDeg: 90 }),
      expect.objectContaining({ sessionId, tick: beforeEdgeTick, seq: 2, aimDeg: 90 }),
      expect.objectContaining({ sessionId, tick: beforeEdgeTick, seq: 3, shoot: true, aimDeg: 0 }),
      expect.objectContaining({ sessionId, tick: beforeEdgeTick, seq: 4, shoot: false, aimDeg: 0 }),
    ]);
    expect(emitted[1]).not.toHaveProperty('swapSlot');
    expect(bridge).toHaveBeenCalledTimes(4);
    expect(getPlaytestRuntimeInputForTests(sessionId, 'player-1')).toEqual(
      expect.objectContaining({ seq: 4, shoot: true, aimDeg: 0, swapSlot: 3 }),
    );
    expect(controlPlaytestRuntimeLifecycle(sessionId, 'resume')).toBe('running');
    await waitForTickCount(sessionId, beforeEdgeTick + 1);
    await waitForRuntimeInputWithoutSwapSlot(sessionId);
    expect(getPlaytestRuntimeInputForTests(sessionId, 'player-1')).toEqual(
      expect.objectContaining({ seq: 4, shoot: false, aimDeg: 0 }),
    );
    expect(getPlaytestRuntimeInputForTests(sessionId, 'player-1')).not.toHaveProperty('swapSlot');
    await waitForTickCount(sessionId, beforeEdgeTick + 3);

    const projectileSlotTransitions = decodedFrames.flatMap((frame) => {
      if (
        !isRecord(frame) ||
        frame._tag !== 'DeltaSnapshot' ||
        !Array.isArray(frame.projectilesUpdated)
      ) {
        return [];
      }
      return frame.projectilesUpdated.filter((projectile): projectile is Record<string, unknown> =>
        isRecord(projectile),
      );
    });
    expect(
      projectileSlotTransitions.filter(
        (projectile) => Option.getOrUndefined(projectile.weaponSlot as Option.Option<number>) === 3,
      ),
    ).toHaveLength(1);

    const deltaWithProjectile = decodedFrames.find(
      (frame): frame is { readonly projectilesUpdated: readonly Record<string, unknown>[] } =>
        isRecord(frame) &&
        frame._tag === 'DeltaSnapshot' &&
        Array.isArray(frame.projectilesUpdated) &&
        frame.projectilesUpdated.length > 0,
    );
    const projectile = deltaWithProjectile?.projectilesUpdated[0];
    expect(projectile).toBeDefined();
    expect(Option.getOrUndefined(projectile?.weaponSlot as Option.Option<number>)).toBe(3);
    expect(Option.getOrUndefined(projectile?.vx as Option.Option<number>)).toBeGreaterThan(0);
    expect(Option.getOrUndefined(projectile?.vy as Option.Option<number>)).toBeCloseTo(0);
  });

  it('keeps a held bridge mousedown firing at cadence until mouseup reaches the running BR host', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-runtime-host-held-shoot-'));
    const artifactDirectory = path.join(tempRoot, 'artifact');
    await mkdir(artifactDirectory, { recursive: true });
    await writeMapPackage(
      artifactDirectory,
      {
        id: MAP_ID,
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: 'object:00000000-0000-4000-8000-000000000001',
            kind: 'spawn-point',
            x: 10,
            y: 20,
            layerId: 'layer:00000000-0000-4000-8000-000000000001',
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      },
      playerModels,
    );

    const decodedFrames: unknown[] = [];
    setPlaytestRuntimeSnapshotNotifier((_sessionId, frame) => {
      decodedFrames.push(decodeServerFrame(frame));
    });

    const sessionId = 'runtime-host-held-shoot-test';
    sessionIds.push(sessionId);

    await startRunningPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);
    const beforePressTick = getPlaytestRuntimeMetrics(sessionId)?.tickCount ?? 0;
    const bridge = vi.fn((payload: Parameters<typeof forwardBridgePlaytestInput>[0]) => {
      forwardBridgePlaytestInput(payload);
    });
    await dispatchPointerMoveDigit3RafBridgeInput({
      sessionId,
      tick: beforePressTick,
      click: true,
      forward: bridge,
      holdAfterMouseDown: async (releaseMouse, emitted) => {
        expect(emitted.at(-1)).toEqual(expect.objectContaining({ shoot: true, aimDeg: 0 }));
        await waitForTickCount(sessionId, beforePressTick + 16);
        const idsBeforeRelease = projectileIdsFromFrames(decodedFrames);
        expect(idsBeforeRelease.size).toBeGreaterThanOrEqual(2);

        releaseMouse();
        expect(emitted.at(-1)).toEqual(expect.objectContaining({ shoot: false, aimDeg: 0 }));
        const releaseTick = getPlaytestRuntimeMetrics(sessionId)?.tickCount ?? beforePressTick;
        await waitForTickCount(sessionId, releaseTick + 10);
        expect(projectileIdsFromFrames(decodedFrames)).toEqual(idsBeforeRelease);
      },
    });
    expect(bridge).toHaveBeenCalledTimes(4);
    expect(getPlaytestRuntimeInputForTests(sessionId, 'player-1')).toEqual(
      expect.objectContaining({ shoot: false, aimDeg: 0 }),
    );
  });
});

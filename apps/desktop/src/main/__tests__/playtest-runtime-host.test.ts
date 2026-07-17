// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  type ProjectId,
} from '@tileborne/core';
import { assembleRuntimeMapPackage } from '@tileborne/services-build';
import { hashRuntimeMapPackageEntry } from '@tileborne/runtime/map-package';
import { afterEach, describe, expect, it } from 'vitest';
import { Effect, Option, Schema } from 'effect';
import {
  PLUGIN_ID,
  decodeServerFrame,
  exportBattleRoyaleModeData,
} from '@tileborne/plugin-battle-royale';

import {
  controlPlaytestBehaviorDebug,
  getPlaytestBehaviorDebugSnapshot,
  getPlaytestRuntimeMetrics,
  getPlaytestRuntimeSnapshot,
  hotReloadPlaytestBehavior,
  setPlaytestRuntimeInput,
  setPlaytestRuntimeSnapshotNotifier,
  startPlaytestRuntimeHost,
  stopPlaytestRuntimeHost,
} from '../playtest-runtime-host.js';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const battleRoyalePluginRoot = path.resolve(desktopRoot, '../../packages/plugin-battle-royale');
const packId = makePackId('550e8400-e29b-41d4-a716-446655440999');
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);
const MAP_ID = 'map:5b1901ca-1abd-42d6-aeac-553b34b9bda6';
const PROJECT_ID = 'project:5b1901ca-1abd-42d6-aeac-553b34b9bda7';
const RUNTIME_TICK_BEHAVIOR_ID = 'behavior:88888888-8888-4888-8888-888888888888' as BehaviorId;
const NEIGHBOR_BEHAVIOR_ID = 'behavior:99999999-9999-4999-8999-999999999999' as BehaviorId;

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

describe('playtest-runtime-host', () => {
  let tempRoot: string | undefined;
  const sessionIds: string[] = [];

  afterEach(async () => {
    setPlaytestRuntimeSnapshotNotifier(undefined);
    for (const sessionId of sessionIds.splice(0)) {
      await stopPlaytestRuntimeHost(sessionId);
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
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

    await startPlaytestRuntimeHost({
      sessionId,
      packageDirectory: artifactDirectory,
      pluginInstalls: [{ pluginId: '@tileborne-plugins/test-runtime', rootPath: pluginRoot }],
    });

    await waitForTickCount(sessionId, 5);
    expect(getPlaytestRuntimeMetrics(sessionId)?.tickCount).toBeGreaterThanOrEqual(5);
  });

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
    await startPlaytestRuntimeHost({
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
    await startPlaytestRuntimeHost({
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

    await startPlaytestRuntimeHost({
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

    await startPlaytestRuntimeHost({
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
    expect(after?.players[0]?.x).toBeGreaterThan(10);
    expect(getPlaytestRuntimeMetrics(sessionId)?.playerCount).toBe(1);
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

    await startPlaytestRuntimeHost({
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

    await startPlaytestRuntimeHost({
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

    await waitForTickCount(sessionId, 2);
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

    await startPlaytestRuntimeHost({
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
});

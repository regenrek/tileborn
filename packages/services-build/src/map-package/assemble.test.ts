import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  GameObjectCatalog,
  GameModeId,
  PluginId,
  RuntimeBehaviorPackage,
  decodePersistedTileborneMapJson,
  hashBytes,
} from '@tileborne/core';
import { ModeDataExportError, RuntimeProjectContent } from '@tileborne/plugin-api';
import { hashRuntimeMapPackageEntry, loadRuntimeMapPackage } from '@tileborne/runtime/map-package';
import { Effect, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { assembleRuntimeMapPackage } from './assemble.js';

const UUID = '12345678-1234-4234-8234-123456789abc';
const TYPE_UUID = UUID.replace('1234567', 'aaaaaaa');
const PLUGIN = '@tileborne-plugins/example-mode';
const validWavBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x2a, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f,
  0x00, 0x00,
]);

const pluginId = Schema.decodeUnknownSync(PluginId)(PLUGIN);
const modeId = Schema.decodeUnknownSync(GameModeId)(PLUGIN);

const catalog = Schema.decodeUnknownSync(GameObjectCatalog)({
  id: `catalog:${UUID}`,
  schemaVersion: 1,
  objectTypes: [
    {
      id: `gobj:${TYPE_UUID}`,
      schemaVersion: 1,
      label: 'Spawn Pad',
      family: 'spawn',
      components: [{ _tag: 'spawn-point', data: {} }],
      instanceDefaults: {},
    },
  ],
});

const map = decodePersistedTileborneMapJson({
  id: `map:${UUID}`,
  schemaVersion: 1,
  size: { width: 8, height: 8 },
  tileSize: { width: 32, height: 32 },
  layers: [
    {
      kind: 'object',
      id: `layer:${UUID}`,
      name: 'Objects',
      visible: true,
      opacity: 1,
      objectIds: [`object:${UUID}`],
    },
  ],
  objects: [
    {
      id: `object:${UUID}`,
      kind: `gobj:${TYPE_UUID}`,
      x: 3,
      y: 4,
      layerId: `layer:${UUID}`,
      properties: { team: 'alpha' },
    },
  ],
  properties: { [PLUGIN]: { maxPlayers: 4 }, editorOnlyScalar: 7 },
});

const baseInput = (outputDirectory: string) => ({
  projectId: `project:${UUID}`,
  map,
  activeMode: { modeId, pluginId },
  pluginCatalogs: [{ pluginId, catalogs: [{ contributionId: 'example/catalog', catalog }] }],
  playerModels: [],
  playerCapacity: 4,
  engineVersion: '0.1.0',
  outputDirectory,
});

const tempDirs: string[] = [];
const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tileborne-mappkg-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const fsReader = (directory: string) => async (entryPath: string) => {
  try {
    return new Uint8Array(await readFile(path.join(directory, entryPath)));
  } catch {
    return undefined;
  }
};

describe('assembleRuntimeMapPackage (ADR-0030)', () => {
  it('packages compiled behavior modules as hashed runtime-owned entries', async () => {
    const dir = await makeTempDir();
    const bytes = new TextEncoder().encode('export default () => [];\n');
    const modulePath = `behaviors/modules/behavior-${UUID}.mjs`;
    const behaviors = Schema.decodeUnknownSync(RuntimeBehaviorPackage)({
      schemaVersion: 1,
      manifests: [
        {
          schemaVersion: 1,
          id: `behavior:${UUID}`,
          label: 'Award loot',
          source: {
            _tag: 'typescript',
            sourcePath: `behaviors/sources/${UUID}.ts`,
            exportName: 'default',
          },
          requiredCapabilities: [],
        },
      ],
      visualDefinitions: [],
      modules: [
        {
          behaviorId: `behavior:${UUID}`,
          sourceKind: 'typescript',
          modulePath,
          hash: hashBytes(bytes),
        },
      ],
    });
    const assembled = await Effect.runPromise(
      assembleRuntimeMapPackage({
        ...baseInput(dir),
        behaviors,
        behaviorModules: [{ path: modulePath, bytes }],
      }),
    );

    expect(await readFile(path.join(dir, modulePath))).toEqual(Buffer.from(bytes));
    expect(assembled.mapPackage.behaviors.modules[0]?.modulePath).toBe(modulePath);
    expect(assembled.mapPackage.manifest.entryHashes[modulePath]).toBe(hashBytes(bytes));
    const loaded = await loadRuntimeMapPackage(fsReader(dir));
    expect(Result.isSuccess(loaded)).toBe(true);
    if (Result.isSuccess(loaded)) {
      expect(loaded.success.behaviors.modules[0]?.hash).toBe(hashBytes(bytes));
    }
  });

  it('emits byte-identical packages and content-derived ids for identical inputs', async () => {
    const left = await makeTempDir();
    const right = await makeTempDir();
    const [leftResult, rightResult] = await Promise.all([
      Effect.runPromise(assembleRuntimeMapPackage(baseInput(left))),
      Effect.runPromise(assembleRuntimeMapPackage(baseInput(right))),
    ]);
    expect(rightResult.mapPackage.manifest.packageId).toBe(
      leftResult.mapPackage.manifest.packageId,
    );
    for (const file of [
      'manifest.json',
      'map.json',
      'catalog.json',
      'placements.json',
      'settings.json',
      'content.json',
      'behaviors.json',
      'audio.json',
      'visuals.json',
      'assets.json',
      'mode-data.json',
    ]) {
      expect(await readFile(path.join(right, file))).toEqual(await readFile(path.join(left, file)));
    }
  });

  it('writes authored audio projection as a hashed runtime package entry', async () => {
    const dir = await makeTempDir();
    const audio = {
      schemaVersion: 1,
      buses: [{ id: 'project.music', label: 'Project Music', kind: 'music', defaultVolume: 0.8 }],
      cues: [
        {
          id: 'project.shell.menuMusic',
          label: 'Menu Loop',
          busId: 'project.music',
          defaultVolume: 0.8,
          binding: 'shell.menuMusic',
          classification: 'music',
          source: { url: 'assets/audio/menu-loop.ogg', mime: 'audio/ogg' },
          loop: true,
          maxOverlap: 1,
        },
      ],
      diagnostics: [],
      settings: {
        masterVolume: 0.42,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: { 'project.music': 0.25 },
      },
    };
    const menuLoopBytes = validWavBytes;

    const assembled = await Effect.runPromise(
      assembleRuntimeMapPackage({
        ...baseInput(dir),
        audio,
        assets: [
          {
            path: 'assets/audio/menu-loop.ogg',
            bytes: menuLoopBytes,
            assetId: 'asset:menu-loop',
          },
        ],
      }),
    );

    expect(assembled.mapPackage.audio).toEqual(audio);
    const loaded = Result.getOrThrow(await loadRuntimeMapPackage(fsReader(dir)));
    expect(loaded.audio).toEqual(audio);
    const audioBytes = await readFile(path.join(dir, 'audio.json'));
    expect(loaded.manifest.entryHashes.audio).toBeDefined();
    expect(loaded.manifest.entryHashes.audio).toBe(
      await hashRuntimeMapPackageEntry(new Uint8Array(audioBytes)),
    );
    expect(await readFile(path.join(dir, 'assets/audio/menu-loop.ogg'))).toEqual(
      Buffer.from(menuLoopBytes),
    );
    expect(loaded.assets).toEqual([
      {
        path: 'assets/audio/menu-loop.ogg',
        hash: await hashRuntimeMapPackageEntry(menuLoopBytes),
        assetId: 'asset:menu-loop',
      },
    ]);
    expect(loaded.manifest.entryHashes['assets/audio/menu-loop.ogg']).toBe(
      await hashRuntimeMapPackageEntry(menuLoopBytes),
    );
  });

  it('writes the canonical layout that loadRuntimeMapPackage round-trips', async () => {
    const dir = await makeTempDir();
    const assembled = await Effect.runPromise(
      assembleRuntimeMapPackage({
        ...baseInput(dir),
        projectContent: Schema.decodeUnknownSync(RuntimeProjectContent)({
          schemaVersion: 1,
          items: [
            {
              id: `item:${UUID}`,
              label: 'Project potion',
              data: {},
            },
          ],
          lootTables: [],
          weapons: [],
          provenance: { [`item:${UUID}`]: { _tag: 'project' } },
        }),
        assets: [
          {
            path: 'assets/ab/sprite.png',
            bytes: new Uint8Array([1, 2, 3]),
            assetId: `asset:${UUID}`,
          },
        ],
      }),
    );

    expect(assembled.mapPackage.placements).toHaveLength(1);
    expect(assembled.mapPackage.placements[0]?.instanceProperties).toEqual({ team: 'alpha' });
    expect(assembled.mapPackage.catalog[0]?.origin).toEqual({ _tag: 'plugin', pluginId });
    // Only namespaced object sections survive into settings.
    expect(Object.keys(assembled.mapPackage.settings)).toEqual([PLUGIN]);
    expect(assembled.mapPackage.behaviors).toMatchObject({
      schemaVersion: 1,
      manifests: [],
      visualDefinitions: [],
      modules: [],
    });

    const loaded = Result.getOrThrow(await loadRuntimeMapPackage(fsReader(dir)));
    expect(loaded.manifest.packageId).toBe(assembled.mapPackage.manifest.packageId);
    // The neutral capacity rides in the manifest (M2 review, F2).
    expect(loaded.manifest.playerCapacity).toBe(4);
    expect(loaded.placements).toHaveLength(1);
    expect(loaded.assets[0]?.path).toBe('assets/ab/sprite.png');
    expect(loaded.content.items).toEqual([
      expect.objectContaining({ id: `item:${UUID}`, label: 'Project potion' }),
    ]);
    expect(loaded.map.size.width).toBe(8);

    // The asset payload itself is written content-addressed next to the entries.
    const payload = await readFile(path.join(dir, 'assets/ab/sprite.png'));
    expect([...payload]).toEqual([1, 2, 3]);
    expect(loaded.manifest.entryHashes['assets/ab/sprite.png']).toBe(loaded.assets[0]?.hash);
  });

  it('converts authored map pixels to runtime tile placements during package assembly', async () => {
    const dir = await makeTempDir();
    const pixelMap = decodePersistedTileborneMapJson({
      id: `map:${UUID}`,
      schemaVersion: 1,
      size: { width: 8, height: 8 },
      tileSize: { width: 32, height: 16 },
      layers: [
        {
          kind: 'object',
          id: `layer:${UUID}`,
          name: 'Objects',
          visible: true,
          opacity: 1,
          objectIds: [`object:${UUID}`],
        },
      ],
      objects: [
        {
          id: `object:${UUID}`,
          kind: `gobj:${TYPE_UUID}`,
          x: 96,
          y: 64,
          layerId: `layer:${UUID}`,
          properties: {},
        },
      ],
      properties: { [PLUGIN]: { maxPlayers: 4 } },
    });
    let exportedPlacement: { readonly x: number; readonly y: number } | undefined;

    const assembled = await Effect.runPromise(
      assembleRuntimeMapPackage({
        ...baseInput(dir),
        map: pixelMap,
        modeDataExporter: (context) => {
          exportedPlacement = context.placements[0];
          return Result.succeed({});
        },
      }),
    );

    expect(assembled.mapPackage.placements[0]).toMatchObject({ x: 3, y: 4 });
    expect(exportedPlacement).toMatchObject({ x: 3, y: 4 });

    const loaded = Result.getOrThrow(await loadRuntimeMapPackage(fsReader(dir)));
    expect(loaded.placements[0]).toMatchObject({ x: 3, y: 4 });
  });

  it("calls the active mode's exporter with the neutral projections and namespaces its section", async () => {
    const dir = await makeTempDir();
    let seenSettings: unknown;
    let seenPlacements = 0;
    const assembled = await Effect.runPromise(
      assembleRuntimeMapPackage({
        ...baseInput(dir),
        modeDataExporter: (context) => {
          seenSettings = context.settings;
          seenPlacements = context.placements.length;
          return Result.succeed({ zone: { phases: 3 } });
        },
      }),
    );
    expect(seenSettings).toEqual({ maxPlayers: 4 });
    expect(seenPlacements).toBe(1);
    expect(assembled.mapPackage.modeData).toEqual({ [PLUGIN]: { zone: { phases: 3 } } });
  });

  it('fails fast when a placement references a type missing from the merged catalog', async () => {
    const dir = await makeTempDir();
    const result = await Effect.runPromise(
      Effect.result(
        assembleRuntimeMapPackage({
          ...baseInput(dir),
          pluginCatalogs: [],
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain('missing from the merged catalog');
    }
  });

  it('fails when the exporter rejects the map', async () => {
    const dir = await makeTempDir();
    const result = await Effect.runPromise(
      Effect.result(
        assembleRuntimeMapPackage({
          ...baseInput(dir),
          modeDataExporter: () =>
            Result.fail(new ModeDataExportError({ pluginId: PLUGIN, message: 'no zone config' })),
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain('no zone config');
    }
  });

  it('rejects asset paths outside assets/', async () => {
    const dir = await makeTempDir();
    const result = await Effect.runPromise(
      Effect.result(
        assembleRuntimeMapPackage({
          ...baseInput(dir),
          assets: [{ path: '../escape.png', bytes: new Uint8Array([1]) }],
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
  });
});

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AssetPackManifest,
  AssetPackManifestAsset,
  assetPackManifestToJson,
  License,
} from '@tileborne/asset-pipeline';
import { hashBytes, makeAssetId, makePackId, type AssetId, type PackId } from '@tileborne/core';
import { writeTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import { importTiled } from '@tileborne/sdk-tileset/tiled';
import { FoundationLayer, JobService } from '@tileborne/services-foundation';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { AssetService, DirectoryAssetPackSource } from './asset/index.js';
import { detectPackCapability } from './asset/capability.js';
import { MapService } from './map/index.js';
import { ProjectService } from './project/index.js';
import { ServicesAppLayer } from './index.js';
import { withTempHome } from './test-utils.js';

const appLayer = ServicesAppLayer.pipe(Layer.provideMerge(FoundationLayer));
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const textEncoder = new TextEncoder();

const runApp = <A, E>(
  effect: Effect.Effect<A, E, ProjectService | MapService | AssetService | JobService>,
) => Effect.runPromise(effect.pipe(Effect.provide(appLayer)));

const license = new License({
  spdxId: 'CC0-1.0',
  attribution: Option.none(),
  sourceUrl: Option.none(),
  notes: Option.none(),
});

const packDir = (home: string, packId: PackId, version = '1.0.0') =>
  path.join(home, 'assets', 'packs', `${packId}-${version}`);

const writeAssetOnlyPack = async (
  root: string,
  packId: PackId,
  assetId: AssetId = makeAssetId('550e8400-e29b-41d4-a716-446655440100'),
): Promise<string> => {
  const source = path.join(root, String(packId).replace(':', '-'));
  await mkdir(path.join(source, 'tiles'), { recursive: true });
  await writeFile(path.join(source, 'tiles', 'terrain.png'), png);
  const manifest = new AssetPackManifest({
    id: packId,
    name: 'Asset Only',
    version: '1.0.0',
    license,
    assets: [
      new AssetPackManifestAsset({
        id: assetId,
        path: 'tiles/terrain.png',
        mime: 'image/png',
        size: png.byteLength,
        hash: hashBytes(png),
        license: Option.some(license),
      }),
    ],
  });
  await writeFile(
    path.join(source, 'tileborne-asset-pack.json'),
    `${JSON.stringify(assetPackManifestToJson(manifest), null, 2)}\n`,
    'utf8',
  );
  return source;
};

const writePlaceableAssetOnlyPack = async (root: string, packId: PackId): Promise<string> => {
  const assetId = makeAssetId('550e8400-e29b-41d4-a716-446655440101');
  const source = await writeAssetOnlyPack(root, packId, assetId);
  const manifestPath = path.join(source, 'tileborne-asset-pack.json');
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  raw['placeables'] = [
    {
      id: 'placeable:550e8400-e29b-41d4-a716-446655440101',
      name: 'Placed Statue',
      size: { width: 16, height: 16 },
      frames: [
        {
          assetId,
          tileId: 'tile:550e8400-e29b-41d4-a716-446655440101',
          uv: { x: 0, y: 0, w: 16, h: 16 },
        },
      ],
      tags: [],
      placementMode: 'object',
      source: {
        format: 'tiled',
        tilesetName: 'Objects',
        localTileId: 0,
        image: 'tiles/terrain.png',
        imageWidth: 16,
        imageHeight: 16,
        properties: {},
      },
    },
  ];
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return source;
};

const writeBrokenTilesetPack = async (root: string): Promise<string> => {
  const packId = makePackId('550e8400-e29b-41d4-a716-446655440201');
  const source = await writeAssetOnlyPack(root, packId);
  const raw = JSON.parse(
    await readFile(path.join(source, 'tileborne-asset-pack.json'), 'utf8'),
  ) as Record<string, unknown>;
  raw['schemaVersion'] = 1;
  raw['terrainClasses'] = [];
  raw['tilesets'] = [
    {
      id: 'tileset:550e8400-e29b-41d4-a716-446655440201',
      name: 'Broken',
      atlasAssetId: 'asset:550e8400-e29b-41d4-a716-446655440299',
      cellSize: { width: 16, height: 16 },
      margin: 0,
      spacing: 0,
    },
  ];
  raw['tiles'] = [
    {
      id: 'tile:550e8400-e29b-41d4-a716-446655440201',
      tilesetId: 'tileset:550e8400-e29b-41d4-a716-446655440201',
      uv: { x: 0, y: 0, w: 16, h: 16 },
      tags: [],
    },
  ];
  raw['autotileRules'] = [];
  raw['variantFilters'] = [];
  raw['animations'] = [];
  raw['terrainTransitions'] = [];
  raw['collisionMasks'] = [];
  await writeFile(
    path.join(source, 'tileborne-asset-pack.json'),
    `${JSON.stringify(raw, null, 2)}\n`,
    'utf8',
  );
  return source;
};

describe('Asset pack capability', () => {
  it('marks the bundled sample fixture as paintable', () =>
    withTempHome(async () => {
      const source = path.join(repoRoot, 'packages/test-fixtures/fixtures/asset-packs/smoke-pack');
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: source }),
          );
          return yield* assets.getPack(packId);
        }),
      );

      expect(pack.capability.paintable).toBe(true);
      expect(pack.capability.tilesetCount).toBeGreaterThanOrEqual(1);
      expect(pack.capability.tileCount).toBeGreaterThanOrEqual(1);
    }));

  it('imports the CC0 Tiled compatibility source fixture with inventory and semantic roles', () =>
    withTempHome(async (home) => {
      const source = path.join(
        repoRoot,
        'packages/test-fixtures/fixtures/tiled-sources/compat-hardening/TiledMap Editor',
      );
      const result = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packId = yield* assets.importTiledSourcePackNow(source);
          const pack = yield* assets.getPack(packId);
          return { packId, pack };
        }),
      );
      const manifest = JSON.parse(
        await readFile(path.join(packDir(home, result.packId), 'tileborne-asset-pack.json'), 'utf8'),
      ) as {
        readonly assetSemanticRoles?: readonly { readonly role: string }[];
        readonly tiledSourceInventory?: { readonly summary?: Record<string, number> };
      };

      expect(result.pack.capability.paintable).toBe(true);
      expect(result.pack.capability.sourceInventory).toMatchObject({
        tilesetCount: 2,
        ruleMapCount: 1,
        rulesIndexCount: 1,
        exampleMapCount: 1,
        animationFrameCount: 2,
        collisionObjectCount: 1,
      });
      expect(manifest.tiledSourceInventory?.summary).toMatchObject({
        imageCollectionTileCount: 1,
        tileProbabilityCount: 3,
        wangColorProbabilityCount: 2,
      });
      expect(manifest.assetSemanticRoles?.map((role) => role.role)).toEqual(
        expect.arrayContaining(['floor', 'wall', 'water', 'decoration', 'collision']),
      );
    }));

  it('keeps packs paintable when legacy autotile masks contain dangling tile refs', () => {
    const packId = makePackId('550e8400-e29b-41d4-a716-446655440207');
    const assetId = makeAssetId('550e8400-e29b-41d4-a716-446655440207');
    const tilesetId = 'tileset:550e8400-e29b-41d4-a716-446655440207';
    const validTileId = 'tile:550e8400-e29b-41d4-a716-446655440207';
    const danglingTileId = 'tile:550e8400-e29b-41d4-a716-446655440208';

    const capability = detectPackCapability(packId, {
      schemaVersion: 1,
      id: packId,
      name: 'Legacy Wang Pack',
      version: '1.0.0',
      license: { spdxId: 'CC0-1.0', redistributable: true },
      assets: [{ id: assetId, path: 'tiles/terrain.png', mime: 'image/png' }],
      terrainClasses: ['grass'],
      tilesets: [
        {
          id: tilesetId,
          name: 'Terrain',
          atlasAssetId: assetId,
          cellSize: { width: 16, height: 16 },
          margin: 0,
          spacing: 0,
        },
      ],
      tiles: [{ id: validTileId, tilesetId, uv: { x: 0, y: 0, w: 16, h: 16 }, tags: [] }],
      autotileRules: [
        {
          _tag: 'wang2corner',
          tilesetId,
          id: 'autotile-rule:550e8400-e29b-41d4-a716-446655440207',
          name: 'ground',
          terrainClasses: ['grass'],
          maskToTileIds: { '1111': [validTileId, danglingTileId] },
        },
      ],
      variantFilters: [],
      animations: [],
      terrainTransitions: [],
      collisionMasks: [],
    });

    expect(capability.paintable).toBe(true);
    expect(capability.source).toBe('tileborne');
    expect(capability.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: 'PACK.unsupported-schema',
          severity: 'warning',
          message: 'Autotile rule references an unknown tile',
        }),
      ]),
    );
  });

  it('exposes generic Tiled source inventory in pack capability', () => {
    const packId = makePackId('550e8400-e29b-41d4-a716-446655440217');
    const assetId = makeAssetId('550e8400-e29b-41d4-a716-446655440217');
    const tilesetId = 'tileset:550e8400-e29b-41d4-a716-446655440217';
    const tileId = 'tile:550e8400-e29b-41d4-a716-446655440217';

    const capability = detectPackCapability(packId, {
      schemaVersion: 1,
      id: packId,
      name: 'Tiled Source Pack',
      version: '1.0.0',
      license: { spdxId: 'UNKNOWN', redistributable: false },
      assets: [{ id: assetId, path: 'tiles/terrain.png', mime: 'image/png' }],
      terrainClasses: [],
      tilesets: [
        {
          id: tilesetId,
          name: 'Terrain',
          atlasAssetId: assetId,
          cellSize: { width: 16, height: 16 },
          margin: 0,
          spacing: 0,
        },
      ],
      tiles: [{ id: tileId, tilesetId, uv: { x: 0, y: 0, w: 16, h: 16 }, tags: [] }],
      autotileRules: [],
      variantFilters: [],
      animations: [],
      terrainTransitions: [],
      collisionMasks: [],
      tiledSourceInventory: {
        summary: {
          tilesetCount: 1,
          tileCount: 1,
          frameCount: 1,
          imageCollectionTileCount: 0,
          wangSetCount: 1,
          animationCount: 0,
          animationFrameCount: 0,
          tileProbabilityCount: 0,
          wangColorProbabilityCount: 0,
          collisionObjectCount: 0,
          ruleMapCount: 1,
          rulesIndexCount: 1,
          exampleMapCount: 1,
        },
      },
    });

    expect(capability.sourceInventory).toMatchObject({
      tilesetCount: 1,
      frameCount: 1,
      ruleMapCount: 1,
      rulesIndexCount: 1,
      exampleMapCount: 1,
    });
  });

  it('recomputes stale no-tile capability locks for canonical tileset manifests', () =>
    withTempHome(async (home) => {
      const source = path.join(repoRoot, 'packages/test-fixtures/fixtures/asset-packs/smoke-pack');
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: source }),
          );
          return yield* assets.getPack(packId);
        }),
      );
      expect(pack.capability.paintable).toBe(true);

      const lockPath = path.join(packDir(home, pack.id, pack.version), 'lock.json');
      const staleLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly manifestHash: string;
        capability?: {
          integrityHash?: string;
          capability?: Record<string, unknown>;
        };
      };
      staleLock.capability ??= {};
      staleLock.capability.integrityHash = staleLock.manifestHash;
      staleLock.capability.capability = {
        ...(staleLock.capability.capability ?? {}),
        paintable: false,
        tilesetCount: 0,
        tileCount: 0,
        placeableCount: 67,
        diagnostics: [{ _tag: 'PACK.no-tilesets', message: 'Pack does not contain paintable tilesets.' }],
      };
      await writeFile(lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, 'utf8');

      const migrated = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return (yield* assets.listPacks()).find((candidate) => candidate.id === pack.id);
        }),
      );

      expect(migrated?.capability.paintable).toBe(true);
      expect(migrated?.capability.tileCount).toBeGreaterThan(0);
      expect(migrated?.capability.placeableCount).toBe(0);
      const nextLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly capability?: { readonly integrityHash?: string };
        readonly manifestHash: string;
      };
      expect(nextLock.capability?.integrityHash).not.toBe(nextLock.manifestHash);
    }));

  it('recomputes old-version capability locks after capability semantics change', () =>
    withTempHome(async (home) => {
      const source = path.join(repoRoot, 'packages/test-fixtures/fixtures/asset-packs/smoke-pack');
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: source }),
          );
          return yield* assets.getPack(packId);
        }),
      );
      expect(pack.capability.paintable).toBe(true);

      const installedRoot = packDir(home, pack.id, pack.version);
      const manifestRaw = await readFile(path.join(installedRoot, 'tileborne-asset-pack.json'), 'utf8');
      const oldVersionHash = hashBytes(textEncoder.encode(`pack-capability-v4\n${manifestRaw}`));
      const lockPath = path.join(installedRoot, 'lock.json');
      const staleLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        capability?: {
          integrityHash?: string;
          capability?: Record<string, unknown>;
        };
      };
      staleLock.capability ??= {};
      staleLock.capability.integrityHash = oldVersionHash;
      staleLock.capability.capability = {
        ...(staleLock.capability.capability ?? {}),
        paintable: false,
        source: 'asset-only',
        tilesetCount: 0,
        tileCount: 0,
        diagnostics: [{ _tag: 'PACK.no-tilesets', message: 'Pack does not contain paintable tilesets.' }],
      };
      await writeFile(lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, 'utf8');

      const migrated = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return (yield* assets.listPacks()).find((candidate) => candidate.id === pack.id);
        }),
      );

      expect(migrated?.capability.paintable).toBe(true);
      expect(migrated?.capability.source).toBe('tileborne');
      expect(migrated?.capability.tileCount).toBeGreaterThan(0);
      const nextLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly capability?: {
          readonly integrityHash?: string;
          readonly capability?: Record<string, unknown>;
        };
      };
      expect(nextLock.capability?.integrityHash).not.toBe(oldVersionHash);
      expect(nextLock.capability?.capability?.['source']).toBe('tileborne');
    }));

  it('migrates a v6 lock and recomputes SDK warnings with non-blocking severity', () =>
    withTempHome(async (home) => {
      const fixture = path.join(repoRoot, 'packages/test-fixtures/fixtures/asset-packs/smoke-pack');
      const source = path.join(home, 'legacy-v6-warning-pack');
      await cp(fixture, source, { recursive: true });
      const manifestPath = path.join(source, 'tileborne-asset-pack.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        readonly id: PackId;
        readonly tilesets: readonly { readonly id: string }[];
        readonly tiles: readonly { readonly id: string }[];
        autotileRules: unknown[];
      };
      manifest.autotileRules = [{
        _tag: 'wang2corner',
        tilesetId: manifest.tilesets[0]!.id,
        id: 'autotile-rule:550e8400-e29b-41d4-a716-446655440209',
        name: 'legacy-warning',
        terrainClasses: ['floor'],
        maskToTileIds: {
          '1111': [manifest.tiles[0]!.id, 'tile:550e8400-e29b-41d4-a716-446655449999'],
        },
      }];
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

      const imported = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packId = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          return yield* assets.getPack(packId);
        }),
      );
      expect(imported.capability.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          message: 'Autotile rule references an unknown tile',
        }),
      ]));

      const installedRoot = packDir(home, imported.id, imported.version);
      const installedManifestRaw = await readFile(
        path.join(installedRoot, 'tileborne-asset-pack.json'),
        'utf8',
      );
      const v6Hash = hashBytes(textEncoder.encode(`pack-capability-v6\n${installedManifestRaw}`));
      const lockPath = path.join(installedRoot, 'lock.json');
      const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        capability: {
          integrityHash: string;
          capability: { diagnostics: Array<Record<string, unknown>> };
        };
      };
      lock.capability.integrityHash = v6Hash;
      lock.capability.capability.diagnostics = lock.capability.capability.diagnostics.map(
        ({ severity, ...diagnostic }) => {
          expect(severity).toBe('warning');
          return diagnostic;
        },
      );
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

      const migrated = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return (yield* assets.listPacks()).find((candidate) => candidate.id === imported.id);
        }),
      );
      const warning = migrated?.capability.diagnostics.find(
        (diagnostic) => diagnostic.message === 'Autotile rule references an unknown tile',
      );
      expect(warning?.severity).toBe('warning');
      expect(migrated?.capability.paintable).toBe(true);

      const nextLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly capability: {
          readonly integrityHash: string;
          readonly capability: { readonly diagnostics: readonly { readonly severity: string }[] };
        };
      };
      expect(nextLock.capability.integrityHash).not.toBe(v6Hash);
      expect(nextLock.capability.capability.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: 'warning' }),
      ]));
    }));

  it('marks an asset-only manifest as non-paintable and caches the result', () =>
    withTempHome(async (home) => {
      const packId = makePackId('550e8400-e29b-41d4-a716-446655440200');
      const source = await writeAssetOnlyPack(home, packId);
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const imported = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: source }),
          );
          return yield* assets.getPack(imported);
        }),
      );

      expect(pack.capability.paintable).toBe(false);
      expect(pack.capability.source).toBe('asset-only');
      expect(pack.capability.diagnostics.map((diagnostic) => diagnostic._tag)).toContain(
        'PACK.no-tilesets',
      );

      const lock = JSON.parse(
        await readFile(path.join(packDir(home, packId), 'lock.json'), 'utf8'),
      ) as {
        readonly capability?: { readonly integrityHash?: string };
      };
      expect(lock.capability?.integrityHash).toMatch(/^sha256:/);
    }));

  it('rebuilds stale cached capabilities missing placeableCount during service boot', () =>
    withTempHome(async (home) => {
      const packId = makePackId('550e8400-e29b-41d4-a716-446655440206');
      const source = await writePlaceableAssetOnlyPack(home, packId);
      await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );

      const lockPath = path.join(packDir(home, packId), 'lock.json');
      const staleLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly capability?: { readonly capability?: Record<string, unknown> };
      };
      const staleCapability = staleLock.capability?.capability;
      expect(staleCapability?.['placeableCount']).toBe(1);
      delete staleCapability?.['placeableCount'];
      await writeFile(lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, 'utf8');

      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packs = yield* assets.listPacks();
          return packs.find((candidate) => candidate.id === packId);
        }),
      );

      expect(pack?.capability.placeableCount).toBe(1);
      const migratedLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly capability?: { readonly capability?: { readonly placeableCount?: number } };
      };
      expect(migratedLock.capability?.capability?.placeableCount).toBe(1);
    }));

  it('marks image-collection placeable packs as non-paintable', async () => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 1,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          name: 'objects',
          tilewidth: 32,
          tileheight: 32,
          tilecount: 1,
          columns: 0,
          tiles: [
            {
              id: 0,
              type: 'tree',
              image: 'tree.png',
              imagewidth: 64,
              imageheight: 96,
            },
          ],
        },
      ],
      layers: [
        {
          type: 'objectgroup',
          name: 'props',
          objects: [{ id: 1, gid: 1, x: 0, y: 96, width: 64, height: 96 }],
        },
      ],
    });
    const imported = await importTiled(
      { sourcePath: '/project/maps/objects.tmj', projectRoot: '/project', raw },
      { packIdSeed: '/project/maps/objects.tmj' },
    );
    const pack = imported.value!.pack;
    const capability = detectPackCapability(pack.id, writeTilesetManifest(pack));

    expect(pack.tilesets[0]?.tiles).toHaveLength(0);
    expect(pack.placeables).toHaveLength(1);
    expect(capability.paintable).toBe(false);
    expect(capability.tileCount).toBe(0);
    expect(capability.placeableCount).toBe(1);
  });

  it('keeps grid atlas tiles paintable while image collections add placeables', async () => {
    const raw = JSON.stringify({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      width: 1,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [
        {
          firstgid: 1,
          name: 'terrain',
          tilewidth: 32,
          tileheight: 32,
          tilecount: 4,
          columns: 2,
          image: 'terrain.png',
          imagewidth: 64,
          imageheight: 64,
          wangsets: [
            {
              name: 'ground',
              type: 'corner',
              colors: [{ name: 'grass', color: '#00ff00', tile: 0 }],
              wangtiles: [{ tileid: 1, wangid: [0, 1, 0, 1, 0, 1, 0, 1] }],
            },
          ],
        },
        {
          firstgid: 5,
          name: 'objects',
          tilewidth: 32,
          tileheight: 32,
          tilecount: 1,
          columns: 0,
          tiles: [
            {
              id: 0,
              type: 'statue',
              image: 'statue.png',
              imagewidth: 64,
              imageheight: 96,
            },
          ],
        },
      ],
      layers: [
        { type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1] },
        {
          type: 'objectgroup',
          name: 'objects',
          objects: [{ id: 1, gid: 5, x: 0, y: 96, width: 64, height: 96 }],
        },
      ],
    });
    const imported = await importTiled(
      { sourcePath: '/project/maps/mixed.tmj', projectRoot: '/project', raw },
      { packIdSeed: '/project/maps/mixed.tmj' },
    );
    const pack = imported.value!.pack;
    const capability = detectPackCapability(pack.id, writeTilesetManifest(pack));

    expect(pack.tilesets.find((tileset) => tileset.name === 'terrain')?.tiles).toHaveLength(4);
    expect(pack.placeables).toHaveLength(1);
    expect(capability.paintable).toBe(true);
    expect(capability.tileCount).toBe(4);
    expect(capability.placeableCount).toBe(1);
  });

  it('surfaces missing tile asset references as diagnostics', () =>
    withTempHome(async (home) => {
      const source = await writeBrokenTilesetPack(home);
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: source }),
          );
          return yield* assets.getPack(packId);
        }),
      );

      expect(pack.capability.paintable).toBe(false);
      expect(pack.capability.diagnostics.map((diagnostic) => diagnostic._tag)).toContain(
        'PACK.missing-asset',
      );
    }));

  it('returns capability from listPacks', () =>
    withTempHome(async (home) => {
      const source = await writeAssetOnlyPack(
        home,
        makePackId('550e8400-e29b-41d4-a716-446655440202'),
      );
      const packs = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          return yield* assets.listPacks();
        }),
      );

      expect(packs[0]?.capability.source).toBe('asset-only');
    }));

  it('emits a structured duplicate-id diagnostic when importing an installed pack id', () =>
    withTempHome(async (home) => {
      const packId = makePackId('550e8400-e29b-41d4-a716-446655440203');
      const source = await writeAssetOnlyPack(home, packId);
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          const imported = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: source }),
          );
          return yield* assets.getPack(imported);
        }),
      );

      const duplicate = pack.capability.diagnostics.find(
        (diagnostic) => diagnostic._tag === 'PACK.duplicate-id',
      );
      expect(duplicate).toMatchObject({
        _tag: 'PACK.duplicate-id',
        existingPackId: packId,
        newPackId: packId,
        integrityHashesMatch: true,
      });
    }));

  it('does not emit duplicate-id diagnostics for distinct pack ids', () =>
    withTempHome(async (home) => {
      const first = await writeAssetOnlyPack(
        home,
        makePackId('550e8400-e29b-41d4-a716-446655440204'),
      );
      const second = await writeAssetOnlyPack(
        home,
        makePackId('550e8400-e29b-41d4-a716-446655440205'),
      );
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          yield* assets.importPackNow(new DirectoryAssetPackSource({ path: first }));
          const imported = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: second }),
          );
          return yield* assets.getPack(imported);
        }),
      );

      expect(pack.capability.diagnostics.map((diagnostic) => diagnostic._tag)).not.toContain(
        'PACK.duplicate-id',
      );
    }));
});

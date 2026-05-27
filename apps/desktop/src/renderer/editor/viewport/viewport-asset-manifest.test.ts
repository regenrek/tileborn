import {
  makeAssetId,
  makePackId,
  makePlaceableId,
  makeTileId,
  type ContentHash,
  type Uuid,
} from '@tileborne/core';
import { createRuntimeAssetManifest, type RuntimeAssetManifest } from '@tileborne/runtime';
import {
  BitmaskCollisionMask,
  CellSize,
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  Tile,
  Tileset,
  TilesetId,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  TiledPlaceableSource,
  UVRect,
} from '@tileborne/sdk-tileset/schemas';
import { writeTilesetManifest } from '@tileborne/sdk-tileset/manifest';
import { Effect, Option, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRuntimeViewportManifest,
  clearViewportAssetBundleCache,
  createBlankViewportManifest,
  loadViewportAssetBundle,
  loadViewportAssetManifest,
} from './viewport-asset-manifest.js';

const mountMock = vi.fn();
const loadAssetsMock = vi.fn();
const disposeMock = vi.fn();

vi.mock('@tileborne/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tileborne/runtime')>();
  return {
    ...actual,
    PixiRendererAdapter: class PixiRendererAdapter {
      mount = mountMock.mockReturnValue(Effect.succeed({ container: {} }));
      loadAssets = loadAssetsMock.mockReturnValue(Effect.succeed(new Map()));
      dispose = disposeMock.mockReturnValue(Effect.succeed(undefined));
    },
  };
});

const fakePackManifest = createRuntimeAssetManifest({
  id: makePackId('a6ffcd59-011f-4f05-a4e2-832b87155ade'),
  name: 'Tiled source',
  version: '1.0.0-sample',
  license: {
    spdxId: 'CC0-1.0',
    attribution: Option.none(),
    sourceUrl: Option.some('https://example.invalid/tileborne-sample-fixture'),
    notes: Option.none(),
  },
  assets: [
    {
      id: makeAssetId('660e8400-e29b-41d4-a716-446655440011'),
      path: 'tiles/sample.png',
      mime: 'image/png',
      size: 289,
      hash: 'sha256:720b55b57d2f4f665c9edfdcfa0d49efaee3f61951183afc4d5219879c8f3707' as ContentHash,
      license: Option.none(),
    },
  ],
});

const uuid = (suffix: string): Uuid =>
  `660e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;

const fakeTilesetPack = new TilesetPack({
  schemaVersion: 1,
  id: fakePackManifest.id,
  name: 'Tiled source',
  version: '1.0.0-sample',
  license: new TilesetPackLicense({
    spdxId: 'CC0-1.0',
    attribution: Option.none(),
    sourceUrl: Option.some('https://example.invalid/tileborne-sample-fixture'),
    notes: Option.none(),
    redistributable: true,
  }),
  tilesets: [
    new Tileset({
      id: Schema.decodeUnknownSync(TilesetId)(`tileset:${uuid('100')}`),
      name: 'Sample Terrain',
      atlasAssetId: fakePackManifest.assets[0]!.id,
      cellSize: new CellSize({ width: 32, height: 32 }),
      margin: 0,
      spacing: 0,
      tiles: [
        new Tile({
          id: makeTileId(uuid('200')),
          uv: new UVRect({ x: 0, y: 0, w: 32, h: 32 }),
          tags: ['terrain'],
          terrainClass: Option.none(),
          collisionMask: Option.some(new BitmaskCollisionMask({ passable: 0, blocked: 15 })),
          animation: Option.none(),
        }),
      ],
      autotileRules: [],
      variantFilters: [],
      terrainTransitions: [],
    }),
  ],
  assets: [
    new TilesetPackAsset({
      id: fakePackManifest.assets[0]!.id,
      path: 'tiles/sample.png',
      mime: 'image/png',
    }),
  ],
});

const fakeTextureDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('viewport asset manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearViewportAssetBundleCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a runtime manifest with data-url texture paths', () => {
    const manifest = buildRuntimeViewportManifest(
      fakeTilesetPack,
      new Map([['tiles/sample.png', fakeTextureDataUrl]]),
    );

    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]?.path).toBe(fakeTextureDataUrl);
    expect(manifest.assets[0]?.mime).toBe('image/png');
  });

  it('uses a blank texture fallback manifest when no pack resolves', async () => {
    vi.stubGlobal('window', {
      tileborne: {
        assets: {
          listPacks: vi.fn().mockResolvedValue({ packs: [] }),
        },
        projects: {
          get: vi.fn().mockResolvedValue({ project: { assetPacks: [] } }),
        },
      },
    });

    const manifest = await Effect.runPromise(loadViewportAssetManifest({ projectId: 'project:test' }));
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.name).toBe('viewport-blank-fallback');
    expect(manifest.assets[0]?.path.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('loads textures from IPC and passes a populated manifest into loadAssets on mount', async () => {
    const manifestJson = JSON.stringify(writeTilesetManifest(fakeTilesetPack));
    const manifestDataUrl = `data:application/json;base64,${btoa(manifestJson)}`;

    const getAssetDataUrl = vi.fn(async ({ assetPath }: { assetPath: string }) => {
      if (assetPath === 'tileborne-asset-pack.json') {
        return { dataUrl: manifestDataUrl };
      }
      if (assetPath === 'tiles/sample.png') {
        return { dataUrl: fakeTextureDataUrl };
      }
      throw new Error(`unexpected asset path: ${assetPath}`);
    });
    vi.stubGlobal('window', {
      tileborne: {
        assets: {
          listPacks: vi.fn().mockResolvedValue({
            packs: [{ id: fakePackManifest.id, name: fakePackManifest.name, version: fakePackManifest.version }],
          }),
          getAssetDataUrl,
        },
        projects: {
          get: vi.fn(),
        },
      },
    });

    const { PixiRendererAdapter } = await import('@tileborne/runtime');
    const adapter = new PixiRendererAdapter();
    const container = document.createElement('div');

    const bundle = await Effect.runPromise(
      adapter.mount(container).pipe(
        Effect.flatMap(() => loadViewportAssetBundle()),
        Effect.flatMap((bundle) => adapter.loadAssets(bundle.manifest).pipe(Effect.as(bundle))),
      ),
    );

    expect(loadAssetsMock).toHaveBeenCalledTimes(1);
    const loadedManifest = loadAssetsMock.mock.calls[0]?.[0] as RuntimeAssetManifest;
    expect(loadedManifest.assets.length).toBeGreaterThan(0);
    expect(loadedManifest.assets[0]?.path).toBe(fakeTextureDataUrl);
    expect(loadedManifest.name).toBe('Tiled source');
    expect(bundle.frameIndex?.lookup(fakeTilesetPack.tilesets[0]!.tiles[0]!.id)?.sourceAssetPaths).toEqual([
      'tiles/sample.png',
    ]);
    expect(bundle.tileIdByTileIndex.get(1)).toBe(fakeTilesetPack.tilesets[0]!.tiles[0]!.id);
    expect(bundle.collisionMaskByTileIndex.get(1)?._tag).toBe('bitmask');
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(1);
    // Only the manifest + the single atlas image are fetched. The viewport
    // does NOT eager-load every image asset in the pack (see
    // .refs/v0.1.x-paint-bug/diag/diag.md — sequential 673-asset loads
    // produced ~13 min spinning fallbacks before paint).
    const fetchedPaths = getAssetDataUrl.mock.calls.map((call) => call[0]?.assetPath);
    expect(fetchedPaths.sort()).toEqual(['tileborne-asset-pack.json', 'tiles/sample.png']);
  });

  it('only fetches atlas images (not sprite or sample assets) when loading the bundle', async () => {
    const decoyAssetId = makeAssetId('660e8400-e29b-41d4-a716-446655440099');
    const packWithDecoy = new TilesetPack({
      schemaVersion: fakeTilesetPack.schemaVersion,
      id: fakeTilesetPack.id,
      name: fakeTilesetPack.name,
      version: fakeTilesetPack.version,
      license: fakeTilesetPack.license,
      tilesets: fakeTilesetPack.tilesets,
      assets: [
        ...fakeTilesetPack.assets,
        new TilesetPackAsset({
          id: decoyAssetId,
          path: 'props/decoy-sprite.png',
          mime: 'image/png',
        }),
      ],
    });
    const manifestJson = JSON.stringify(writeTilesetManifest(packWithDecoy));
    const manifestDataUrl = `data:application/json;base64,${btoa(manifestJson)}`;

    const getAssetDataUrl = vi.fn(async ({ assetPath }: { assetPath: string }) => {
      if (assetPath === 'tileborne-asset-pack.json') {
        return { dataUrl: manifestDataUrl };
      }
      if (assetPath === 'tiles/sample.png') {
        return { dataUrl: fakeTextureDataUrl };
      }
      throw new Error(`unexpected asset path: ${assetPath}`);
    });
    vi.stubGlobal('window', {
      tileborne: {
        assets: {
          listPacks: vi.fn().mockResolvedValue({
            packs: [{ id: packWithDecoy.id, name: packWithDecoy.name, version: packWithDecoy.version }],
          }),
          getAssetDataUrl,
        },
        projects: { get: vi.fn() },
      },
    });

    const bundle = await Effect.runPromise(loadViewportAssetBundle());
    const fetchedPaths = getAssetDataUrl.mock.calls.map((call) => call[0]?.assetPath);
    expect(fetchedPaths).toContain('tiles/sample.png');
    expect(fetchedPaths).not.toContain('props/decoy-sprite.png');
    expect(bundle.renderableAssetIdByPath.get('props/decoy-sprite.png')).toBeUndefined();
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(1);
  });

  it('fetches only selected placeable frames from image-collection packs', async () => {
    const selectedPlaceableId = makePlaceableId(uuid('300'));
    const selectedAssetId = makeAssetId(uuid('301'));
    const selectedTileId = makeTileId(uuid('302'));
    const hiddenPlaceableId = makePlaceableId(uuid('303'));
    const hiddenAssetId = makeAssetId(uuid('304'));
    const hiddenTileId = makeTileId(uuid('305'));
    const packWithPlaceables = new TilesetPack({
      schemaVersion: fakeTilesetPack.schemaVersion,
      id: fakeTilesetPack.id,
      name: fakeTilesetPack.name,
      version: fakeTilesetPack.version,
      license: fakeTilesetPack.license,
      tilesets: fakeTilesetPack.tilesets,
      assets: [
        ...fakeTilesetPack.assets,
        new TilesetPackAsset({
          id: selectedAssetId,
          path: 'props/selected.png',
          mime: 'image/png',
        }),
        new TilesetPackAsset({
          id: hiddenAssetId,
          path: 'props/hidden.png',
          mime: 'image/png',
        }),
      ],
      placeables: [
        new Placeable({
          id: selectedPlaceableId,
          name: 'Selected',
          size: new PlaceableSize({ width: 64, height: 64 }),
          frames: [
            new PlaceableFrameRef({
              assetId: selectedAssetId,
              tileId: selectedTileId,
              uv: new UVRect({ x: 0, y: 0, w: 64, h: 64 }),
              durationMs: Option.none(),
            }),
          ],
          tags: [],
          placementMode: 'object',
          source: new TiledPlaceableSource({
            format: 'tiled',
            tilesetName: 'Props',
            localTileId: 0,
            image: Option.some('props/selected.png'),
            imageWidth: Option.some(64),
            imageHeight: Option.some(64),
            objectType: Option.none(),
            objectClass: Option.none(),
            properties: {},
          }),
        }),
        new Placeable({
          id: hiddenPlaceableId,
          name: 'Hidden',
          size: new PlaceableSize({ width: 64, height: 64 }),
          frames: [
            new PlaceableFrameRef({
              assetId: hiddenAssetId,
              tileId: hiddenTileId,
              uv: new UVRect({ x: 0, y: 0, w: 64, h: 64 }),
              durationMs: Option.none(),
            }),
          ],
          tags: [],
          placementMode: 'object',
          source: new TiledPlaceableSource({
            format: 'tiled',
            tilesetName: 'Props',
            localTileId: 1,
            image: Option.some('props/hidden.png'),
            imageWidth: Option.some(64),
            imageHeight: Option.some(64),
            objectType: Option.none(),
            objectClass: Option.none(),
            properties: {},
          }),
        }),
      ],
    });
    const manifestJson = JSON.stringify(writeTilesetManifest(packWithPlaceables));
    const manifestDataUrl = `data:application/json;base64,${btoa(manifestJson)}`;

    const getAssetDataUrl = vi.fn(async ({ assetPath }: { assetPath: string }) => {
      if (assetPath === 'tileborne-asset-pack.json') {
        return { dataUrl: manifestDataUrl };
      }
      if (assetPath === 'tiles/sample.png' || assetPath === 'props/selected.png') {
        return { dataUrl: fakeTextureDataUrl };
      }
      throw new Error(`unexpected asset path: ${assetPath}`);
    });
    vi.stubGlobal('window', {
      tileborne: {
        assets: {
          listPacks: vi.fn().mockResolvedValue({
            packs: [
              {
                id: packWithPlaceables.id,
                name: packWithPlaceables.name,
                version: packWithPlaceables.version,
              },
            ],
          }),
          getAssetDataUrl,
        },
        projects: { get: vi.fn() },
      },
    });

    const bundle = await Effect.runPromise(
      loadViewportAssetBundle({
        renderablePlaceableRefs: [
          { packId: packWithPlaceables.id, placeableId: selectedPlaceableId },
        ],
      }),
    );
    const fetchedPaths = getAssetDataUrl.mock.calls.map((call) => call[0]?.assetPath);
    expect(fetchedPaths).toContain('tiles/sample.png');
    expect(fetchedPaths).toContain('props/selected.png');
    expect(fetchedPaths).not.toContain('props/hidden.png');
    expect(bundle.renderableAssetIdByPath.get('props/selected.png')).toBe(2);
    expect(bundle.renderableAssetIdByPath.get('props/hidden.png')).toBeUndefined();
  });

  it('keeps the primary map pack renderable when an optional palette pack is stale', async () => {
    const missingPackId = makePackId('660e8400-e29b-41d4-a716-446655440088');
    const manifestJson = JSON.stringify(writeTilesetManifest(fakeTilesetPack));
    const manifestDataUrl = `data:application/json;base64,${btoa(manifestJson)}`;

    const getAssetDataUrl = vi.fn(
      async ({ packId, assetPath }: { packId: string; assetPath: string }) => {
        if (packId === missingPackId) {
          throw new Error(`asset pack not found: ${packId}`);
        }
        if (assetPath === 'tileborne-asset-pack.json') {
          return { dataUrl: manifestDataUrl };
        }
        if (assetPath === 'tiles/sample.png') {
          return { dataUrl: fakeTextureDataUrl };
        }
        throw new Error(`unexpected asset path: ${assetPath}`);
      },
    );
    vi.stubGlobal('window', {
      tileborne: {
        assets: {
          listPacks: vi.fn(),
          getAssetDataUrl,
        },
        projects: { get: vi.fn() },
      },
    });

    const bundle = await Effect.runPromise(
      loadViewportAssetBundle({
        packId: fakeTilesetPack.id,
        extraPackIds: [missingPackId],
      }),
    );

    expect(bundle.packs.map((pack) => pack.id)).toEqual([fakeTilesetPack.id]);
    expect(bundle.manifest.assets).toHaveLength(1);
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(1);
  });

  it('loads an extra palette pack when the primary map pack is stale', async () => {
    const missingPackId = makePackId('660e8400-e29b-41d4-a716-446655440089');
    const manifestJson = JSON.stringify(writeTilesetManifest(fakeTilesetPack));
    const manifestDataUrl = `data:application/json;base64,${btoa(manifestJson)}`;

    const getAssetDataUrl = vi.fn(
      async ({ packId, assetPath }: { packId: string; assetPath: string }) => {
        if (packId === missingPackId) {
          throw new Error(`asset pack not found: ${packId}`);
        }
        if (assetPath === 'tileborne-asset-pack.json') {
          return { dataUrl: manifestDataUrl };
        }
        if (assetPath === 'tiles/sample.png') {
          return { dataUrl: fakeTextureDataUrl };
        }
        throw new Error(`unexpected asset path: ${assetPath}`);
      },
    );
    vi.stubGlobal('window', {
      tileborne: {
        assets: {
          listPacks: vi.fn(),
          getAssetDataUrl,
        },
        projects: { get: vi.fn() },
      },
    });

    const bundle = await Effect.runPromise(
      loadViewportAssetBundle({
        packId: missingPackId,
        extraPackIds: [fakeTilesetPack.id],
      }),
    );

    expect(bundle.packs.map((pack) => pack.id)).toEqual([fakeTilesetPack.id]);
    expect(bundle.manifest.name).toBe(fakeTilesetPack.name);
    expect(bundle.manifest.assets).toHaveLength(1);
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(1);
  });

  it('reuses the viewport asset bundle for repeated loads of the same pack', async () => {
    const manifestJson = JSON.stringify(writeTilesetManifest(fakeTilesetPack));
    const manifestDataUrl = `data:application/json;base64,${btoa(manifestJson)}`;

    const getAssetDataUrl = vi.fn(async ({ assetPath }: { assetPath: string }) => {
      if (assetPath === 'tileborne-asset-pack.json') {
        return { dataUrl: manifestDataUrl };
      }
      if (assetPath === 'tiles/sample.png') {
        return { dataUrl: fakeTextureDataUrl };
      }
      throw new Error(`unexpected asset path: ${assetPath}`);
    });
    vi.stubGlobal('window', {
      tileborne: {
        assets: {
          listPacks: vi.fn().mockResolvedValue({
            packs: [{ id: fakeTilesetPack.id, name: fakeTilesetPack.name, version: fakeTilesetPack.version }],
          }),
          getAssetDataUrl,
        },
        projects: { get: vi.fn() },
      },
    });

    const [first, second] = await Promise.all([
      Effect.runPromise(loadViewportAssetBundle()),
      Effect.runPromise(loadViewportAssetBundle()),
    ]);

    expect(second).toBe(first);
    expect(getAssetDataUrl).toHaveBeenCalledTimes(2);
    expect(getAssetDataUrl.mock.calls.map((call) => call[0]?.assetPath).sort()).toEqual([
      'tileborne-asset-pack.json',
      'tiles/sample.png',
    ]);
  });

  it('creates a single-image blank fallback manifest', () => {
    const manifest = createBlankViewportManifest();
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]?.mime).toBe('image/png');
  });
});

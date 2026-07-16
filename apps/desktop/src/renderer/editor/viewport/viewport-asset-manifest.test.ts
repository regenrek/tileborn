import { makeAssetId, makePackId, makePlaceableId, makeTileId, type Uuid } from '@tileborne/core';
import { type RuntimeAssetManifest } from '@tileborne/runtime';
import { buildEditorTilesetIndex } from '@tileborne/sdk-tileset/editor-index';
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
import { Effect, Option, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetProtocolUrl } from '@/lib/asset-url';
import {
  clearViewportAssetBundleCache,
  createBlankViewportManifest,
  loadViewportAssetBundle,
  loadViewportAssetManifest,
  viewportControllerAtlas,
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

/**
 * Serves editor indexes through the IPC bridge (the renderer now consumes the
 * persisted compact index instead of parsing the full manifest). Each pack's
 * index is built from its synthetic `TilesetPack` exactly as the main process
 * would.
 */
const stubEditorIndexBridge = (
  packsById: ReadonlyMap<string, TilesetPack>,
): ReturnType<typeof vi.fn> => {
  const getEditorIndex = vi.fn(async (input: { packId: string }) => {
    const pack = packsById.get(String(input.packId));
    if (pack === undefined) {
      throw new Error(`no editor index for pack ${input.packId}`);
    }
    const integrityHash = `sha256:${String(input.packId)}`;
    const index = buildEditorTilesetIndex(pack, integrityHash);
    return {
      packId: input.packId,
      integrityHash,
      schemaVersion: 1,
      indexJson: JSON.stringify(index),
    };
  });
  return getEditorIndex;
};

const stubWindow = (input: {
  readonly packsById?: ReadonlyMap<string, TilesetPack>;
  readonly listPacks?: ReturnType<typeof vi.fn>;
}): ReturnType<typeof vi.fn> => {
  const getEditorIndex = stubEditorIndexBridge(input.packsById ?? new Map());
  vi.stubGlobal('window', {
    tileborne: {
      assets: {
        listPacks: input.listPacks ?? vi.fn().mockResolvedValue({ packs: [] }),
      },
      assetLibrary: { getEditorIndex },
      projects: { get: vi.fn() },
    },
  });
  return getEditorIndex;
};

const uuid = (suffix: string): Uuid =>
  `660e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;

const fakePackId = makePackId('a6ffcd59-011f-4f05-a4e2-832b87155ade');

const fakeTilesetPack = new TilesetPack({
  schemaVersion: 1,
  id: fakePackId,
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
      atlasAssetId: makeAssetId(uuid('11')),
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
      id: makeAssetId(uuid('11')),
      path: 'tiles/sample.png',
      mime: 'image/png',
    }),
  ],
});

const sampleTileId = fakeTilesetPack.tilesets[0]!.tiles[0]!.id;
const sampleAssetId = fakeTilesetPack.assets[0]!.id;

describe('viewport asset manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearViewportAssetBundleCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a blank texture fallback manifest when no pack resolves', async () => {
    vi.stubGlobal('window', {
      tileborne: {
        assets: { listPacks: vi.fn().mockResolvedValue({ packs: [] }) },
        assetLibrary: { getEditorIndex: vi.fn() },
        projects: { get: vi.fn().mockResolvedValue({ project: { assetPacks: [] } }) },
      },
    });

    const manifest = await Effect.runPromise(
      loadViewportAssetManifest({ projectId: 'project:test' }),
    );
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.name).toBe('viewport-blank-fallback');
    expect(manifest.assets[0]?.path.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('builds the bundle from the editor index and passes protocol-url textures to loadAssets', async () => {
    const getEditorIndex = stubWindow({
      packsById: new Map([[fakeTilesetPack.id, fakeTilesetPack]]),
      listPacks: vi.fn().mockResolvedValue({
        packs: [
          { id: fakeTilesetPack.id, name: fakeTilesetPack.name, version: fakeTilesetPack.version },
        ],
      }),
    });

    const { PixiRendererAdapter } = await import('@tileborne/runtime');
    const adapter = new PixiRendererAdapter();
    const container = document.createElement('div');

    const bundle = await Effect.runPromise(
      adapter.mount(container).pipe(
        Effect.flatMap(() => loadViewportAssetBundle()),
        Effect.flatMap((loaded) => adapter.loadAssets(loaded.manifest).pipe(Effect.as(loaded))),
      ),
    );

    expect(loadAssetsMock).toHaveBeenCalledTimes(1);
    const loadedManifest = loadAssetsMock.mock.calls[0]?.[0] as RuntimeAssetManifest;
    expect(loadedManifest.assets[0]?.path).toBe(
      assetProtocolUrl(fakeTilesetPack.id, 'tiles/sample.png'),
    );
    expect(loadedManifest.name).toBe('Tiled source');
    expect(bundle.tileFramesByIndex.get(1)).toMatchObject({
      assetPath: 'tiles/sample.png',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    });
    expect(bundle.tileIndexByTileId.get(sampleTileId)).toBe(1);
    expect(bundle.collisionMaskByTileIndex.get(1)?._tag).toBe('bitmask');
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(sampleAssetId);
    // The renderer no longer parses the full manifest: it fetches the compact
    // editor index exactly once per pack.
    expect(getEditorIndex).toHaveBeenCalledTimes(1);
  });

  it('only renders atlas images (not decoy sprite/sample assets) from the bundle', async () => {
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
    stubWindow({
      packsById: new Map([[packWithDecoy.id, packWithDecoy]]),
      listPacks: vi.fn().mockResolvedValue({
        packs: [{ id: packWithDecoy.id, name: packWithDecoy.name, version: packWithDecoy.version }],
      }),
    });

    const bundle = await Effect.runPromise(loadViewportAssetBundle());
    expect(bundle.renderableAssetIdByPath.get('props/decoy-sprite.png')).toBeUndefined();
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(sampleAssetId);
    expect(bundle.manifest.assets.map((asset) => asset.path)).toEqual([
      assetProtocolUrl(packWithDecoy.id, 'tiles/sample.png'),
    ]);
  });

  it('renders only selected placeable frames from image-collection packs', async () => {
    const selectedPlaceableId = makePlaceableId(uuid('300'));
    const selectedAssetId = makeAssetId(uuid('301'));
    const selectedTileId = makeTileId(uuid('302'));
    const hiddenPlaceableId = makePlaceableId(uuid('303'));
    const hiddenAssetId = makeAssetId(uuid('304'));
    const hiddenTileId = makeTileId(uuid('305'));
    const makeImagePlaceable = (
      id: ReturnType<typeof makePlaceableId>,
      assetId: ReturnType<typeof makeAssetId>,
      tileId: ReturnType<typeof makeTileId>,
      image: string,
      localTileId: number,
    ) =>
      new Placeable({
        id,
        name: image,
        size: new PlaceableSize({ width: 64, height: 64 }),
        frames: [
          new PlaceableFrameRef({
            assetId,
            tileId,
            uv: new UVRect({ x: 0, y: 0, w: 64, h: 64 }),
            durationMs: Option.none(),
          }),
        ],
        tags: [],
        placementMode: 'object',
        source: new TiledPlaceableSource({
          format: 'tiled',
          tilesetName: 'Props',
          localTileId,
          image: Option.some(image),
          imageWidth: Option.some(64),
          imageHeight: Option.some(64),
          objectType: Option.none(),
          objectClass: Option.none(),
          properties: {},
        }),
      });
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
        new TilesetPackAsset({ id: hiddenAssetId, path: 'props/hidden.png', mime: 'image/png' }),
      ],
      placeables: [
        makeImagePlaceable(
          selectedPlaceableId,
          selectedAssetId,
          selectedTileId,
          'props/selected.png',
          0,
        ),
        makeImagePlaceable(hiddenPlaceableId, hiddenAssetId, hiddenTileId, 'props/hidden.png', 1),
      ],
    });
    stubWindow({
      packsById: new Map([[packWithPlaceables.id, packWithPlaceables]]),
      listPacks: vi.fn().mockResolvedValue({
        packs: [
          {
            id: packWithPlaceables.id,
            name: packWithPlaceables.name,
            version: packWithPlaceables.version,
          },
        ],
      }),
    });

    const bundle = await Effect.runPromise(
      loadViewportAssetBundle({
        renderablePlaceableRefs: [
          { packId: packWithPlaceables.id, placeableId: selectedPlaceableId },
        ],
      }),
    );
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(sampleAssetId);
    expect(bundle.renderableAssetIdByPath.get('props/selected.png')).toBe(selectedAssetId);
    expect(bundle.renderableAssetIdByPath.get('props/hidden.png')).toBeUndefined();
  });

  it('discovers the owning pack for an unscoped catalog visual-ref', async () => {
    // Catalog visual-refs deliberately carry globally unique placeable ids
    // without duplicating an asset-pack id. The viewport must discover the
    // owner and load only the referenced sprite frames.
    const objectPackId = makePackId('660e8400-e29b-41d4-a716-446655440077');
    const objectPlaceableId = makePlaceableId(uuid('400'));
    const objectAssetId = makeAssetId(uuid('401'));
    const objectTileId = makeTileId(uuid('402'));
    const objectPack = new TilesetPack({
      schemaVersion: 1,
      id: objectPackId,
      name: 'Object Props',
      version: '1.0.0',
      license: fakeTilesetPack.license,
      tilesets: [],
      assets: [
        new TilesetPackAsset({ id: objectAssetId, path: 'props/object.png', mime: 'image/png' }),
      ],
      placeables: [
        new Placeable({
          id: objectPlaceableId,
          name: 'props/object.png',
          size: new PlaceableSize({ width: 64, height: 64 }),
          frames: [
            new PlaceableFrameRef({
              assetId: objectAssetId,
              tileId: objectTileId,
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
            image: Option.some('props/object.png'),
            imageWidth: Option.some(64),
            imageHeight: Option.some(64),
            objectType: Option.none(),
            objectClass: Option.none(),
            properties: {},
          }),
        }),
      ],
    });
    stubWindow({
      packsById: new Map([
        [fakeTilesetPack.id, fakeTilesetPack],
        [objectPackId, objectPack],
      ]),
      listPacks: vi.fn().mockResolvedValue({
        packs: [
          { id: fakeTilesetPack.id, name: fakeTilesetPack.name, version: fakeTilesetPack.version },
          { id: objectPackId, name: objectPack.name, version: objectPack.version },
        ],
      }),
    });

    const bundle = await Effect.runPromise(
      loadViewportAssetBundle({
        packId: fakeTilesetPack.id,
        renderablePlaceableRefs: [{ placeableId: objectPlaceableId }],
      }),
    );

    expect(
      bundle.placeables.some(
        (entry) => entry.packId === objectPackId && entry.placeable.id === objectPlaceableId,
      ),
    ).toBe(true);
    expect(bundle.renderableAssetIdByPath.get('props/object.png')).toBe(objectAssetId);
  });

  it('keeps the primary map pack renderable when an optional palette pack is stale', async () => {
    const missingPackId = makePackId('660e8400-e29b-41d4-a716-446655440088');
    stubWindow({ packsById: new Map([[fakeTilesetPack.id, fakeTilesetPack]]) });

    const bundle = await Effect.runPromise(
      loadViewportAssetBundle({ packId: fakeTilesetPack.id, extraPackIds: [missingPackId] }),
    );

    expect(bundle.packId).toBe(fakeTilesetPack.id);
    expect(bundle.manifest.assets).toHaveLength(1);
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(sampleAssetId);
  });

  it('loads an extra palette pack when the primary map pack is stale', async () => {
    const missingPackId = makePackId('660e8400-e29b-41d4-a716-446655440089');
    stubWindow({ packsById: new Map([[fakeTilesetPack.id, fakeTilesetPack]]) });

    const bundle = await Effect.runPromise(
      loadViewportAssetBundle({ packId: missingPackId, extraPackIds: [fakeTilesetPack.id] }),
    );

    expect(bundle.packId).toBe(fakeTilesetPack.id);
    expect(bundle.manifest.name).toBe(fakeTilesetPack.name);
    expect(bundle.renderableAssetIdByPath.get('tiles/sample.png')).toBe(sampleAssetId);
  });

  it('reuses the viewport asset bundle for repeated loads of the same pack', async () => {
    const getEditorIndex = stubWindow({
      packsById: new Map([[fakeTilesetPack.id, fakeTilesetPack]]),
      listPacks: vi.fn().mockResolvedValue({
        packs: [
          { id: fakeTilesetPack.id, name: fakeTilesetPack.name, version: fakeTilesetPack.version },
        ],
      }),
    });

    const [first, second] = await Promise.all([
      Effect.runPromise(loadViewportAssetBundle()),
      Effect.runPromise(loadViewportAssetBundle()),
    ]);

    expect(second).toBe(first);
    expect(getEditorIndex).toHaveBeenCalledTimes(1);
  });

  it('creates a single-image blank fallback manifest', () => {
    const manifest = createBlankViewportManifest();
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]?.mime).toBe('image/png');
  });

  it('projects a loaded bundle into the controller tile-atlas lookups', async () => {
    stubWindow({
      packsById: new Map([[fakeTilesetPack.id, fakeTilesetPack]]),
      listPacks: vi.fn().mockResolvedValue({
        packs: [
          { id: fakeTilesetPack.id, name: fakeTilesetPack.name, version: fakeTilesetPack.version },
        ],
      }),
    });

    const bundle = await Effect.runPromise(loadViewportAssetBundle());
    const atlas = viewportControllerAtlas(bundle);

    // The playtest viewports rely on these lookups to resolve real terrain
    // textures instead of the missing-texture diagnostic fallback, so they must
    // carry through unchanged from the loaded bundle.
    expect(atlas.tileFramesByIndex).toBe(bundle.tileFramesByIndex);
    expect(atlas.collisionMaskByTileIndex).toBe(bundle.collisionMaskByTileIndex);
    expect(atlas.renderableAssetIdByPath).toBe(bundle.renderableAssetIdByPath);
    expect(atlas.placeables).toBe(bundle.placeables);
    expect(atlas.assetPathByPackAndId).toBe(bundle.assetPathByPackAndId);
    expect(atlas.assetPathById).toBe(bundle.assetPathById);
    expect(atlas.autotileRules).toBe(bundle.autotileRules);
    expect(atlas.terrainTransitions).toBe(bundle.terrainTransitions);
    expect(atlas.renderableAssetIdByPath.get('tiles/sample.png')).toBe(sampleAssetId);
  });
});

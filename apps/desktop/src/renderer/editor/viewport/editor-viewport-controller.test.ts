import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Option } from 'effect';
import { Container, Sprite, Text, Texture } from 'pixi.js';
import { CompositeTilemap, Tilemap, POINT_STRUCT_SIZE } from '@pixi/tilemap';
import type { PixiRendererAdapter } from '@tileborne/runtime';
import {
  type AssetId,
  CollisionFootprintComponent,
  CollisionFootprintPart,
  MapObject,
  MapObjectPlacement,
  ObjectLayer,
  PLACEABLE_OBJECT_TYPE_ID,
  TileborneMap,
  TileLayer,
  makeAssetId,
  makeGameObjectTypeId,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makePackId,
  makePlaceableId,
  makeTileId,
  makeTileborneMap,
  type GameObjectTypeId,
  type Uuid,
} from '@tileborne/core';
import {
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  TiledPlaceableSource,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  UVRect,
} from '@tileborne/sdk-tileset/schemas';

import {
  EDITOR_GRID_OUTLINE_COLOR,
  EDITOR_GRID_STROKE_COLOR,
  EditorViewportController,
  MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR,
  OBJECT_FOOTPRINT_LAYER_LABEL,
  missingTileTextureDiagnosticColor,
  type EditorViewportTileAtlas,
} from './editor-viewport-controller.js';

/** Builds index-derived placeable/asset atlas fields from synthetic packs. */
const atlasFromPacks = (
  packs: readonly TilesetPack[],
  renderableAssetIdByPath: ReadonlyMap<string, AssetId | number>,
): EditorViewportTileAtlas => {
  const assetPathByPackAndId = new Map<string, string>();
  const assetPathById = new Map<string, string>();
  for (const pack of packs) {
    for (const asset of pack.assets) {
      assetPathByPackAndId.set(`${pack.id}:${asset.id}`, asset.path);
      assetPathById.set(String(asset.id), asset.path);
    }
  }
  return {
    placeables: packs.flatMap((pack) =>
      (pack.placeables ?? []).map((placeable) => ({ packId: pack.id, placeable })),
    ),
    assetPathByPackAndId,
    assetPathById,
    renderableAssetIdByPath,
  };
};
import { EditorLayerZIndex } from './layers.js';
import { createTileEditCommand } from '../editor-commands.js';
import { setLayerVisible, setTileIndex } from '../map-utils.js';
import { createTestMap, TEST_TILE_LAYER_ID } from '../test-fixtures.js';

describe('EditorViewportController texture diagnostics', () => {
  it('keeps the editor grid visible without using the missing-texture pink', () => {
    expect(EDITOR_GRID_OUTLINE_COLOR).toBe(0x020617);
    expect(EDITOR_GRID_STROKE_COLOR).toBe(0xf8fafc);
    expect(EDITOR_GRID_OUTLINE_COLOR).not.toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
    expect(EDITOR_GRID_STROKE_COLOR).not.toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
  });

  it('uses an explicit missing-texture diagnostic instead of index-colour fallback', () => {
    expect(missingTileTextureDiagnosticColor(1)).toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
    expect(missingTileTextureDiagnosticColor(2)).toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
  });

  it('renders the grid as an overlay above tile chunks', () => {
    expect(EditorLayerZIndex.gridOverlay).toBeGreaterThan(EditorLayerZIndex.tileChunks);
    expect(EditorLayerZIndex.gridOverlay).toBeLessThan(EditorLayerZIndex.collisionOverlay);
  });
});

describe('EditorViewportController render batching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coalesces render requests into one animation frame', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestRender = vi.fn(() => Effect.void);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const adapter = {
      getEditorWorldRoot: () => new Container(),
      requestRender,
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);

    controller.requestRender();
    controller.requestRender();

    expect(callbacks).toHaveLength(1);
    expect(requestRender).not.toHaveBeenCalled();

    callbacks[0]?.(performance.now());
    await Promise.resolve();

    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('requests a render after resizing clears the Pixi framebuffer', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const events: string[] = [];
    const requestRender = vi.fn(() =>
      Effect.sync(() => {
        events.push('render');
      }),
    );
    const resize = vi.fn(() =>
      Effect.sync(() => {
        events.push('resize');
      }),
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const adapter = {
      getEditorWorldRoot: () => new Container(),
      requestRender,
      resize,
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);

    controller.resize(700, 792);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resize).toHaveBeenCalledWith(700, 792);
    expect(callbacks).toHaveLength(1);
    expect(requestRender).not.toHaveBeenCalled();

    callbacks[0]?.(performance.now());
    await Promise.resolve();

    expect(events).toEqual(['resize', 'render']);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('patches a newly created tile chunk after map content is synced', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);
    const map = createTestMap();
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const edited = command.apply(map);

    controller.setMap(map);
    controller.syncMapContent(edited);
    controller.patchFromCommand(command.preview);

    const tileLayerRoot = worldRoot.children.find((child) => child.label === 'tiles') as
      | Container
      | undefined;
    const patchedChunk = tileLayerRoot?.children.find(
      (child) => child.label === `${TEST_TILE_LAYER_ID}:0:0`,
    );

    expect(patchedChunk).toBeDefined();
    expect((patchedChunk as Container | undefined)?.children.length).toBeGreaterThan(0);
  });

  it('patches repeated paint without clearing unrelated existing chunks', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);
    const map = setTileIndex(
      setTileIndex(createTestMap(), TEST_TILE_LAYER_ID, 2, 3, 4),
      TEST_TILE_LAYER_ID,
      33,
      3,
      5,
    );
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 4, 6);
    const edited = command.apply(map);

    controller.setMap(map);
    controller.syncMapContent(edited);
    controller.patchFromCommand(command.preview);

    const tileLayerRoot = worldRoot.children.find((child) => child.label === 'tiles') as
      | Container
      | undefined;
    const patchedChunk = tileLayerRoot?.children.find(
      (child) => child.label === `${TEST_TILE_LAYER_ID}:0:0`,
    );
    const unrelatedChunk = tileLayerRoot?.children.find(
      (child) => child.label === `${TEST_TILE_LAYER_ID}:32:0`,
    );

    expect(patchedChunk).toBeDefined();
    expect(unrelatedChunk).toBeDefined();
    expect((patchedChunk as Container | undefined)?.children.length).toBeGreaterThan(0);
    expect((unrelatedChunk as Container | undefined)?.children.length).toBeGreaterThan(0);
  });

  it('renders hidden tile layers as dimmed map context instead of dropping them', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);
    const paintedMap = setTileIndex(createTestMap(), TEST_TILE_LAYER_ID, 2, 3, 4);
    const hiddenMap = setLayerVisible(paintedMap, TEST_TILE_LAYER_ID, false);

    controller.setMap(hiddenMap);

    const tileLayerRoot = worldRoot.children.find((child) => child.label === 'tiles') as
      | Container
      | undefined;
    const chunk = tileLayerRoot?.children.find(
      (child) => child.label === `${TEST_TILE_LAYER_ID}:0:0`,
    ) as Container | undefined;

    expect(chunk).toBeDefined();
    expect(chunk?.alpha).toBeGreaterThan(0);
    expect(chunk?.alpha).toBeLessThan(1);
  });

  it('renders placement objects as sprites', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const uuid = (suffix: string): Uuid =>
      `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;
    const assetId = makeAssetId(uuid('21'));
    const tileId = makeTileId(uuid('22'));
    const placeableId = makePlaceableId(uuid('23'));
    const layerId = makeLayerId(uuid('24'));
    const objectId = makeObjectId(uuid('25'));
    const pack = new TilesetPack({
      schemaVersion: 1,
      id: makePackId(uuid('26')),
      name: 'Objects',
      version: '1.0.0',
      license: new TilesetPackLicense({
        spdxId: 'CC0-1.0',
        attribution: Option.none(),
        sourceUrl: Option.none(),
        notes: Option.none(),
        redistributable: true,
      }),
      tilesets: [],
      assets: [new TilesetPackAsset({ id: assetId, path: 'objects/statue.png', mime: 'image/png' })],
      placeables: [
        new Placeable({
          id: placeableId,
          name: 'Statue',
          size: new PlaceableSize({ width: 96, height: 128 }),
          frames: [
            new PlaceableFrameRef({
              assetId,
              tileId,
              uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
              durationMs: Option.none(),
            }),
          ],
          tags: ['prop'],
          placementMode: 'object',
          source: new TiledPlaceableSource({
            format: 'tiled',
            tilesetName: 'objects',
            localTileId: 0,
            image: Option.some('objects/statue.png'),
            imageWidth: Option.some(96),
            imageHeight: Option.some(128),
            objectType: Option.none(),
            objectClass: Option.some('statue'),
            properties: {},
          }),
        }),
      ],
    });
    const map = new TileborneMap({
      id: makeMapId(uuid('27')),
      schemaVersion: 1,
      size: { width: 4, height: 4 },
      tileSize: { width: 32, height: 32 },
      layers: [
        new ObjectLayer({
          id: layerId,
          name: 'objects',
          visible: true,
          opacity: 1,
          objectIds: [objectId],
        }),
      ],
      objects: [
        new MapObject({
          id: objectId,
          kind: PLACEABLE_OBJECT_TYPE_ID,
          x: 32,
          y: 64,
          width: Option.some(96),
          height: Option.some(128),
          layerId,
          properties: {},
          placement: new MapObjectPlacement({
            packId: Option.some(pack.id),
            placeableId,
            source: 'manual',
            assetId: Option.some(assetId),
            tileId: Option.some(tileId),
            gid: Option.none(),
          }),
        }),
      ],
      properties: {},
    });
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
      textureForRenderableAssetId: vi.fn(() => Texture.WHITE),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(
      adapter,
      atlasFromPacks([pack], new Map([['objects/statue.png', 1]])),
    );

    controller.setMap(map);

    const objectLayerRoot = worldRoot.children.find((child) => child.label === 'objects') as
      | Container
      | undefined;
    const renderedObject = objectLayerRoot?.children[0] as Container | undefined;
    expect(renderedObject?.children[0]).toBeInstanceOf(Sprite);
    expect((renderedObject?.children[0] as Sprite | undefined)?.width).toBe(96);
  });

  it('renders duplicate placeable ids from the placement pack', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const uuid = (suffix: string): Uuid =>
      `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;
    const assetId = makeAssetId(uuid('41'));
    const tileId = makeTileId(uuid('42'));
    const placeableId = makePlaceableId(uuid('43'));
    const layerId = makeLayerId(uuid('44'));
    const objectId = makeObjectId(uuid('45'));
    const firstPackId = makePackId(uuid('46'));
    const selectedPackId = makePackId(uuid('47'));
    const makePack = (id: typeof firstPackId, path: string) =>
      new TilesetPack({
        schemaVersion: 1,
        id,
        name: path,
        version: '1.0.0',
        license: new TilesetPackLicense({
          spdxId: 'CC0-1.0',
          attribution: Option.none(),
          sourceUrl: Option.none(),
          notes: Option.none(),
          redistributable: true,
        }),
        tilesets: [],
        assets: [new TilesetPackAsset({ id: assetId, path, mime: 'image/png' })],
        placeables: [
          new Placeable({
            id: placeableId,
            name: 'Duplicate Statue',
            size: new PlaceableSize({ width: 96, height: 128 }),
            frames: [
              new PlaceableFrameRef({
                assetId,
                tileId,
                uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
                durationMs: Option.none(),
              }),
            ],
            tags: ['prop'],
            placementMode: 'object',
            source: new TiledPlaceableSource({
              format: 'tiled',
              tilesetName: 'objects',
              localTileId: 0,
              image: Option.some(path),
              imageWidth: Option.some(96),
              imageHeight: Option.some(128),
              objectType: Option.none(),
              objectClass: Option.some('statue'),
              properties: {},
            }),
          }),
        ],
      });
    const map = new TileborneMap({
      id: makeMapId(uuid('48')),
      schemaVersion: 1,
      size: { width: 4, height: 4 },
      tileSize: { width: 32, height: 32 },
      layers: [
        new ObjectLayer({
          id: layerId,
          name: 'objects',
          visible: true,
          opacity: 1,
          objectIds: [objectId],
        }),
      ],
      objects: [
        new MapObject({
          id: objectId,
          kind: PLACEABLE_OBJECT_TYPE_ID,
          x: 32,
          y: 64,
          width: Option.some(96),
          height: Option.some(128),
          layerId,
          properties: {},
          placement: new MapObjectPlacement({
            packId: Option.some(selectedPackId),
            placeableId,
            source: 'manual',
            assetId: Option.some(assetId),
            tileId: Option.some(tileId),
            gid: Option.none(),
          }),
        }),
      ],
      properties: {},
    });
    const textureForRenderableAssetId = vi.fn(() => Texture.WHITE);
    const controller = new EditorViewportController(
      {
        getEditorWorldRoot: () => new Container(),
        requestRender: vi.fn(() => Effect.void),
        textureForRenderableAssetId,
      } as unknown as PixiRendererAdapter,
      atlasFromPacks(
        [makePack(firstPackId, 'first/statue.png'), makePack(selectedPackId, 'selected/statue.png')],
        new Map([
          ['first/statue.png', 1],
          ['selected/statue.png', 2],
        ]),
      ),
    );

    controller.setMap(map);

    expect(textureForRenderableAssetId).toHaveBeenCalledWith(2);
  });

  // Builds a tiny single-frame (static, non-animated) placeable object scene for
  // exercising the initial map-load object render path.
  const staticPlacementScene = () => {
    const uuid = (suffix: string): Uuid =>
      `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;
    const assetId = makeAssetId(uuid('51'));
    const tileId = makeTileId(uuid('52'));
    const placeableId = makePlaceableId(uuid('53'));
    const layerId = makeLayerId(uuid('54'));
    const objectId = makeObjectId(uuid('55'));
    const pack = new TilesetPack({
      schemaVersion: 1,
      id: makePackId(uuid('56')),
      name: 'Objects',
      version: '1.0.0',
      license: new TilesetPackLicense({
        spdxId: 'CC0-1.0',
        attribution: Option.none(),
        sourceUrl: Option.none(),
        notes: Option.none(),
        redistributable: true,
      }),
      tilesets: [],
      assets: [new TilesetPackAsset({ id: assetId, path: 'objects/statue.png', mime: 'image/png' })],
      placeables: [
        new Placeable({
          id: placeableId,
          name: 'Statue',
          size: new PlaceableSize({ width: 96, height: 128 }),
          frames: [
            new PlaceableFrameRef({
              assetId,
              tileId,
              uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
              durationMs: Option.none(),
            }),
          ],
          tags: ['prop'],
          placementMode: 'object',
          source: new TiledPlaceableSource({
            format: 'tiled',
            tilesetName: 'objects',
            localTileId: 0,
            image: Option.some('objects/statue.png'),
            imageWidth: Option.some(96),
            imageHeight: Option.some(128),
            objectType: Option.none(),
            objectClass: Option.some('statue'),
            properties: {},
          }),
        }),
      ],
    });
    const map = new TileborneMap({
      id: makeMapId(uuid('57')),
      schemaVersion: 1,
      size: { width: 4, height: 4 },
      tileSize: { width: 32, height: 32 },
      layers: [
        new ObjectLayer({
          id: layerId,
          name: 'objects',
          visible: true,
          opacity: 1,
          objectIds: [objectId],
        }),
      ],
      objects: [
        new MapObject({
          id: objectId,
          kind: PLACEABLE_OBJECT_TYPE_ID,
          x: 32,
          y: 64,
          width: Option.some(96),
          height: Option.some(128),
          layerId,
          properties: {},
          placement: new MapObjectPlacement({
            packId: Option.some(pack.id),
            placeableId,
            source: 'manual',
            assetId: Option.some(assetId),
            tileId: Option.some(tileId),
            gid: Option.none(),
          }),
        }),
      ],
      properties: {},
    });
    return { map, atlas: atlasFromPacks([pack], new Map([['objects/statue.png', 1]])) };
  };

  it('renders placement sprites from IPC-serialized option values', async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const requestRender = vi.fn(() => Effect.void);
    const { map, atlas } = staticPlacementScene();
    const placeableEntry = atlas.placeables?.[0];
    const frame = placeableEntry?.placeable.frames[0];
    expect(placeableEntry).toBeDefined();
    expect(frame).toBeDefined();
    const serializedOptionMap = {
      ...map,
      objects: map.objects.map((object) => ({
        ...object,
        width: { value: 96 },
        height: { value: 128 },
        placement:
          object.placement === undefined
            ? undefined
            : {
                ...object.placement,
                packId: { value: placeableEntry!.packId },
                assetId: { value: frame!.assetId },
                tileId: { value: frame!.tileId },
                gid: {},
              },
      })),
    } as unknown as TileborneMap;
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender,
      textureForRenderableAssetId: vi.fn(() => Texture.WHITE),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter, atlas);

    controller.setMap(serializedOptionMap);
    expect(callbacks).toHaveLength(1);

    callbacks[0]?.(performance.now());
    await Promise.resolve();
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);

    const objectLayerRoot = worldRoot.children.find((child) => child.label === 'objects') as
      | Container
      | undefined;
    const renderedObject = objectLayerRoot?.children[0] as Container | undefined;
    expect(renderedObject?.children[0]).toBeInstanceOf(Sprite);
    expect((renderedObject?.children[0] as Sprite | undefined)?.width).toBe(96);
  });
});

describe('EditorViewportController chunk culling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LARGE_LAYER_ID = makeLayerId('00000000-0000-4000-8000-000000000099');

  // 128x128 tiles → chunk origins {0, 32, 64, 96} on each axis, one populated
  // tile per chunk so every chunk exists in the layer.
  const createLargeMap = (): TileborneMap => {
    let map = makeTileborneMap({
      id: makeMapId('00000000-0000-4000-8000-000000000098'),
      width: 128,
      height: 128,
      tileWidth: 32,
      tileHeight: 32,
      layers: [
        new TileLayer({
          id: LARGE_LAYER_ID,
          name: 'ground',
          visible: true,
          opacity: 1,
          chunks: [],
        }),
      ],
    });
    for (let chunkY = 0; chunkY < 128; chunkY += 32) {
      for (let chunkX = 0; chunkX < 128; chunkX += 32) {
        map = setTileIndex(map, LARGE_LAYER_ID, chunkX, chunkY, 1);
      }
    }
    return map;
  };

  const builtChunkKeys = (worldRoot: Container): Set<string> => {
    const tileLayerRoot = worldRoot.children.find((child) => child.label === 'tiles') as
      | Container
      | undefined;
    return new Set((tileLayerRoot?.children ?? []).map((child) => child.label));
  };

  const setup = () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
      resize: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    return { worldRoot, controller: new EditorViewportController(adapter) };
  };

  it('builds only the in-view chunks plus one chunk of padding for a large map', () => {
    const { worldRoot, controller } = setup();
    controller.resize(100, 100);
    controller.setCamera(1, 0, 0);
    controller.setMap(createLargeMap());

    const built = builtChunkKeys(worldRoot);
    // View covers tiles 0..3 → chunk origin 0; +1 chunk padding → {0, 32}.
    expect(built).toEqual(
      new Set([
        `${LARGE_LAYER_ID}:0:0`,
        `${LARGE_LAYER_ID}:32:0`,
        `${LARGE_LAYER_ID}:0:32`,
        `${LARGE_LAYER_ID}:32:32`,
      ]),
    );
    expect(built.has(`${LARGE_LAYER_ID}:64:0`)).toBe(false);
    expect(built.has(`${LARGE_LAYER_ID}:96:96`)).toBe(false);
  });

  it('reveals newly visible chunks and drops scrolled-out chunks when panning', () => {
    const { worldRoot, controller } = setup();
    controller.resize(100, 100);
    controller.setCamera(1, 0, 0);
    controller.setMap(createLargeMap());

    expect(builtChunkKeys(worldRoot).has(`${LARGE_LAYER_ID}:0:0`)).toBe(true);
    expect(builtChunkKeys(worldRoot).has(`${LARGE_LAYER_ID}:64:0`)).toBe(false);

    // Pan content left so world x ≈ 2100..2200 (tiles 65..68 → chunk origin 64).
    controller.setCamera(1, -2100, 0);

    const built = builtChunkKeys(worldRoot);
    expect(built.has(`${LARGE_LAYER_ID}:64:0`)).toBe(true);
    expect(built.has(`${LARGE_LAYER_ID}:0:0`)).toBe(false);
  });

  it('renders every chunk before canvas dimensions are known', () => {
    const { worldRoot, controller } = setup();
    // No resize/setCamera with dimensions → fall back to rendering all chunks.
    controller.setMap(createLargeMap());

    const built = builtChunkKeys(worldRoot);
    // 4x4 chunk origins = 16 chunks all built.
    expect(built.size).toBe(16);
    expect(built.has(`${LARGE_LAYER_ID}:96:96`)).toBe(true);
  });
});

describe('EditorViewportController tilemap chunks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const uuid = (suffix: string): Uuid =>
    `74696c65-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

  // Resolves tile index 1 → a 32x32 frame on a single shared atlas asset so the
  // controller batches real tiles instead of falling back to the diagnostic overlay.
  const resolvableAtlas = (): EditorViewportTileAtlas => {
    const tileId = makeTileId(uuid('01'));
    const assetId = makeAssetId(uuid('02'));
    return {
      tileFramesByIndex: new Map([
        [1, { tileId, assetPath: 'ground.png', x: 0, y: 0, width: 32, height: 32 }],
      ]),
      renderableAssetIdByPath: new Map([['ground.png', assetId]]),
    };
  };

  const tileCount = (tilemap: CompositeTilemap): number =>
    tilemap.children.reduce((total, child) => {
      if (child instanceof Tilemap) {
        const points = (child as unknown as { pointsBuf: number[] }).pointsBuf;
        return total + points.length / POINT_STRUCT_SIZE;
      }
      return total;
    }, 0);

  const setup = () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const textureForRenderableAssetId = vi.fn(() => Texture.WHITE);
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
      textureForRenderableAssetId,
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter, resolvableAtlas());
    return { worldRoot, controller, textureForRenderableAssetId };
  };

  const chunkAt = (worldRoot: Container, key: string): CompositeTilemap | undefined => {
    const tileLayerRoot = worldRoot.children.find((child) => child.label === 'tiles') as
      | Container
      | undefined;
    return tileLayerRoot?.children.find((child) => child.label === key) as
      | CompositeTilemap
      | undefined;
  };

  it('renders a chunk as one CompositeTilemap with the expected resolved tile count', () => {
    const { worldRoot, controller } = setup();
    const map = setTileIndex(
      setTileIndex(createTestMap(), TEST_TILE_LAYER_ID, 2, 3, 1),
      TEST_TILE_LAYER_ID,
      4,
      5,
      1,
    );

    controller.setMap(map);

    const chunk = chunkAt(worldRoot, `${TEST_TILE_LAYER_ID}:0:0`);
    expect(chunk).toBeInstanceOf(CompositeTilemap);
    expect(tileCount(chunk!)).toBe(2);
  });

  it('resolves tile frame atlas textures by loaded asset id', () => {
    const { worldRoot, controller, textureForRenderableAssetId } = setup();
    const map = setTileIndex(createTestMap(), TEST_TILE_LAYER_ID, 2, 3, 1);

    controller.setMap(map);

    const chunk = chunkAt(worldRoot, `${TEST_TILE_LAYER_ID}:0:0`);
    expect(chunk).toBeInstanceOf(CompositeTilemap);
    expect(tileCount(chunk!)).toBe(1);
    expect(textureForRenderableAssetId).toHaveBeenCalledWith(makeAssetId(uuid('02')));
  });

  it('rebuilds the chunk tilemap when patchChunk applies a new edit', () => {
    const { worldRoot, controller } = setup();
    const map = setTileIndex(createTestMap(), TEST_TILE_LAYER_ID, 2, 3, 1);
    // Paint a second resolvable tile (index 1) in the same chunk.
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 4, 6, 1);
    const edited = command.apply(map);

    controller.setMap(map);
    expect(tileCount(chunkAt(worldRoot, `${TEST_TILE_LAYER_ID}:0:0`)!)).toBe(1);

    controller.syncMapContent(edited);
    controller.patchFromCommand(command.preview);

    const rebuilt = chunkAt(worldRoot, `${TEST_TILE_LAYER_ID}:0:0`);
    expect(rebuilt).toBeInstanceOf(CompositeTilemap);
    expect(tileCount(rebuilt!)).toBe(2);
  });
});

describe('EditorViewportController debug overlay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const debugText = (worldRoot: Container): Text | undefined => {
    const debugLayer = worldRoot.children.find((child) => child.label === 'debug') as
      | Container
      | undefined;
    return debugLayer?.children[0] as Text | undefined;
  };

  const setup = () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);
    controller.setMap(createTestMap());
    return { worldRoot, controller };
  };

  it('leaves the debug text empty until the overlay is enabled', () => {
    const { worldRoot, controller } = setup();

    controller.tickDebugOverlay();

    expect(debugText(worldRoot)?.text).toBe('');
  });

  it('refreshes the FPS readout from tickDebugOverlay alone (playtest render path)', () => {
    // The playtest viewports drive the adapter directly via `renderFromEntities`
    // and never call the controller's `renderNow`, so `tickDebugOverlay` is the
    // only thing that keeps the debug/FPS readout live there.
    const { worldRoot, controller } = setup();
    controller.setShowDebug(true);

    controller.tickDebugOverlay();

    expect(debugText(worldRoot)?.text).toContain('FPS');
  });

  it('recomputes the FPS value once a sampling window elapses', () => {
    let now = 1_000;
    vi.stubGlobal('performance', { now: () => now } as Performance);
    const { worldRoot, controller } = setup();
    controller.setShowDebug(true);

    for (let frame = 0; frame < 30; frame += 1) {
      controller.tickDebugOverlay();
    }
    now += 500;
    controller.tickDebugOverlay();

    expect(debugText(worldRoot)?.text).toMatch(/FPS [1-9]\d*/);
  });
});

describe('EditorViewportController collision footprint overlay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const uuid = (suffix: string): Uuid =>
    `666f6f74-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

  const FOOTPRINT_TYPE_ID = makeGameObjectTypeId(uuid('01'));

  const footprintComponent = (): CollisionFootprintComponent =>
    new CollisionFootprintComponent({
      source: 'manual',
      reviewed: true,
      parts: [
        new CollisionFootprintPart({
          x: 0,
          y: 0,
          width: 24,
          height: 24,
          blocksMovement: true,
          blocksProjectiles: false,
          blocksVision: false,
        }),
      ],
    });

  // A single placed object (no placement sprite) on a visible object layer,
  // stamped with `kind`, so the footprint lookup can key on `object.kind`.
  const sceneWithObject = (kind: GameObjectTypeId): TileborneMap => {
    const layerId = makeLayerId(uuid('02'));
    const objectId = makeObjectId(uuid('03'));
    return new TileborneMap({
      id: makeMapId(uuid('04')),
      schemaVersion: 1,
      size: { width: 4, height: 4 },
      tileSize: { width: 32, height: 32 },
      layers: [
        new ObjectLayer({
          id: layerId,
          name: 'objects',
          visible: true,
          opacity: 1,
          objectIds: [objectId],
        }),
      ],
      objects: [
        new MapObject({
          id: objectId,
          kind,
          x: 32,
          y: 64,
          width: Option.some(32),
          height: Option.some(32),
          layerId,
          properties: {},
        }),
      ],
      properties: {},
    });
  };

  const setup = () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    return { worldRoot, controller: new EditorViewportController(adapter) };
  };

  const footprintLayer = (worldRoot: Container): Container | undefined => {
    const collisionLayerRoot = worldRoot.children.find((child) => child.label === 'collision') as
      | Container
      | undefined;
    return collisionLayerRoot?.children.find(
      (child) => child.label === OBJECT_FOOTPRINT_LAYER_LABEL,
    ) as Container | undefined;
  };

  it('draws the footprint of a placed object whose type carries the component', () => {
    const { worldRoot, controller } = setup();
    controller.setMap(sceneWithObject(FOOTPRINT_TYPE_ID));
    controller.setCollisionFootprints(new Map([[FOOTPRINT_TYPE_ID, footprintComponent()]]));
    controller.setShowCollision(true);

    expect(footprintLayer(worldRoot)).toBeDefined();
  });

  it('draws no footprint for a placed object whose type has no footprint component', () => {
    const { worldRoot, controller } = setup();
    controller.setMap(sceneWithObject(FOOTPRINT_TYPE_ID));
    // Catalog footprints exist but for a DIFFERENT type, so this object matches none.
    controller.setCollisionFootprints(
      new Map([[makeGameObjectTypeId(uuid('99')), footprintComponent()]]),
    );
    controller.setShowCollision(true);

    expect(footprintLayer(worldRoot)).toBeUndefined();
  });

  it('hides object footprints when the Collision overlay toggle is off', () => {
    const { worldRoot, controller } = setup();
    controller.setMap(sceneWithObject(FOOTPRINT_TYPE_ID));
    controller.setCollisionFootprints(new Map([[FOOTPRINT_TYPE_ID, footprintComponent()]]));

    controller.setShowCollision(true);
    expect(footprintLayer(worldRoot)).toBeDefined();

    controller.setShowCollision(false);
    expect(footprintLayer(worldRoot)).toBeUndefined();
  });
});

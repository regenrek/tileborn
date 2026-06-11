import { describe, expect, it } from 'vitest';
import {
  makeAssetId,
  makeObjectId,
  TileChunk,
  TileLayer,
  TileborneMap,
  MapObject,
  makeLayerId,
  makeMapId,
  makeTileborneMap,
  makePackId,
  makeTileId,
  gameObjectTypeIdForKey,
  PLACEABLE_OBJECT_TYPE_ID,
  type AssetId,
  ObjectLayer,
  type PlaceableId,
  type ProjectId,
  type TileId,
  type Uuid,
} from '@tileborne/core';
import { MapsUpdateRequest } from '@tileborne/ipc-contracts';
import {
  AutotileRuleId,
  CellSize,
  TerrainClass,
  Tile,
  Tileset,
  TilesetId,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  type TileIdType,
  UVRect,
  Wang2EdgeAutotileRule,
} from '@tileborne/sdk-tileset/schemas';
import { Option, Schema } from 'effect';

import {
  createFillSelectionCommand,
  createFillSelectionTileCommand,
  dispatchPointerDown,
  dispatchPointerMove,
  dispatchPointerUp,
  type PointerPoint,
} from './viewport/tool-state.js';
import {
  createObjectPlaceCommand,
  createSetLayerVisibilityCommand,
  createStrokeTileCommand,
  createTileEditCommand,
} from './editor-commands.js';
import { getTileIndex } from './map-utils.js';
import {
  createTestMap,
  TEST_COLLISION_LAYER_ID,
  TEST_OBJECT_LAYER_ID,
  TEST_TILE_LAYER_ID,
} from './test-fixtures.js';
import { createAutotilePaintResolver } from './viewport/autotile-paint.js';

const point = (tileX: number, tileY: number): PointerPoint => ({
  tileX,
  tileY,
  clientX: tileX * 32,
  clientY: tileY * 32,
});
const paintBrush = (tileIndex: number) => ({ kind: 'paintTile', tileIndex }) as const;
const importedLayerId = makeLayerId('00000000-0000-4000-8000-000000000091');
const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const tileBrush = {
  kind: 'tile',
  tileId: 'tile:00000000-0000-4000-8000-000000000001' as TileIdType,
} as const;
const autotileBrush = {
  kind: 'autotile',
  ruleId: Schema.decodeUnknownSync(AutotileRuleId)(
    'autotile-rule:00000000-0000-4000-8000-000000000001',
  ),
} as const;
const terrainBrush = {
  kind: 'terrain',
  classId: Schema.decodeUnknownSync(TerrainClass)('grass'),
} as const;
const autoTerrain = Schema.decodeUnknownSync(TerrainClass)('auto-grass');
const edgeRuleId = Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid('101')}`);
const isolatedTileId = makeTileId(uuid('102'));
const eastConnectedTileId = makeTileId(uuid('103'));
const westConnectedTileId = makeTileId(uuid('104'));
const eastWestConnectedTileId = makeTileId(uuid('105'));
const autotilePack = new TilesetPack({
  schemaVersion: 1,
  id: makePackId(uuid('106')),
  name: 'Autotile Test Pack',
  version: '1.0.0',
  license: new TilesetPackLicense({
    spdxId: 'CC0-1.0',
    attribution: Option.none(),
    sourceUrl: Option.none(),
    notes: Option.none(),
    redistributable: false,
  }),
  assets: [
    new TilesetPackAsset({
      id: makeAssetId(uuid('107')),
      path: 'tiles/autotile.png',
      mime: 'image/png',
    }),
  ],
  tilesets: [
    new Tileset({
      id: Schema.decodeUnknownSync(TilesetId)(`tileset:${uuid('108')}`),
      name: 'Autotiles',
      atlasAssetId: makeAssetId(uuid('107')),
      cellSize: new CellSize({ width: 32, height: 32 }),
      margin: 0,
      spacing: 0,
      tiles: [
        isolatedTileId,
        eastConnectedTileId,
        westConnectedTileId,
        eastWestConnectedTileId,
      ].map(
        (id, index) =>
          new Tile({
            id,
            uv: new UVRect({ x: index * 32, y: 0, w: 32, h: 32 }),
            tags: [],
            terrainClass: Option.none(),
            collisionMask: Option.none(),
            animation: Option.none(),
          }),
      ),
      autotileRules: [
        new Wang2EdgeAutotileRule({
          id: edgeRuleId,
          name: 'Auto Grass',
          terrainClasses: [autoTerrain],
          maskToTileIds: {
            '0000': [isolatedTileId],
            '0100': [eastConnectedTileId],
            '0001': [westConnectedTileId],
            '0101': [eastWestConnectedTileId],
          },
          fallbackTileId: Option.none(),
        }),
      ],
      variantFilters: [],
      terrainTransitions: [],
    }),
  ],
});
const autotileIndexes = new Map<TileIdType, number>([
  [isolatedTileId, 10],
  [eastConnectedTileId, 20],
  [westConnectedTileId, 30],
  [eastWestConnectedTileId, 40],
]);
const autotileResolver = createAutotilePaintResolver({
  autotileRules: autotilePack.tilesets.flatMap((tileset) => tileset.autotileRules),
  tileIndexByTileId: autotileIndexes,
  directTileIndexByTerrainClass: new Map(),
})!;
const resolvedAutotileBrush = autotileResolver.brushForRuleId(edgeRuleId)!;
const placeableId =
  'placeable:00000000-0000-4000-8000-000000000041' as PlaceableId;
const placeableBrush = {
  kind: 'placeable',
  placeableId,
} as const;
const resolvedPlaceableBrush = {
  kind: 'placeObject',
  packId: makePackId('00000000-0000-4000-8000-000000000044' as Uuid),
  placeableId,
  width: 96,
  height: 128,
  frame: {
    assetId: 'asset:00000000-0000-4000-8000-000000000042' as AssetId,
    tileId: 'tile:00000000-0000-4000-8000-000000000043' as TileId,
    uv: { x: 0, y: 0, w: 96, h: 128 },
  },
} as const;

describe('tool state machine', () => {
  it('tileBrush emits live commands before pointer up', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'tileBrush' as const,
      brushIntent: tileBrush,
      resolvedBrush: paintBrush(3),
      activeLayerId: TEST_TILE_LAYER_ID,
      selection: new Set<string>(),
      shiftKey: false,
    };
    const down = dispatchPointerDown(context, point(2, 2), {});
    const afterDown = down.result.command?.apply(map);
    const move = dispatchPointerMove({ ...context, map: afterDown! }, point(3, 2), down.session);
    const afterMove = move.result.command?.apply(afterDown!);
    const up = dispatchPointerUp({ ...context, map: afterMove! }, point(3, 2), move.session);

    expect(down.result.command?.kind).toBe('tile-rectangle-fill');
    expect(down.result.historyMode).toBe('push');
    expect(afterDown && getTileIndex(afterDown, TEST_TILE_LAYER_ID, 2, 2)).toBe(3);
    expect(move.result.command?.kind).toBe('tile-rectangle-fill');
    expect(move.result.historyMode).toBe('replace');
    expect(afterMove && getTileIndex(afterMove, TEST_TILE_LAYER_ID, 2, 2)).toBe(3);
    expect(afterMove && getTileIndex(afterMove, TEST_TILE_LAYER_ID, 3, 2)).toBe(3);
    expect(up.result.command).toBeUndefined();
  });

  it('tileBrush accepts resolved autotile and terrain brush intents', () => {
    const map = createTestMap();
    for (const brushIntent of [autotileBrush, terrainBrush]) {
      const down = dispatchPointerDown(
        {
          map,
          activeTool: 'tileBrush',
          brushIntent,
          resolvedBrush: paintBrush(7),
          activeLayerId: TEST_TILE_LAYER_ID,
          selection: new Set(),
          shiftKey: false,
        },
        point(2, 2),
        {},
      );
      const edited = down.result.command?.apply(map);

      expect(down.result.command?.kind).toBe('tile-rectangle-fill');
      expect(down.result.brushPreview).toMatchObject({ x: 2, y: 2, tileIndex: 7 });
      expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 2, 2)).toBe(7);
    }
  });

  it('autotile brush chooses variants from neighboring same-autotile cells', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'tileBrush' as const,
      brushIntent: { kind: 'autotile' as const, ruleId: edgeRuleId },
      resolvedBrush: resolvedAutotileBrush,
      autotileResolver,
      activeLayerId: TEST_TILE_LAYER_ID,
      selection: new Set<string>(),
      shiftKey: false,
    };

    const firstDown = dispatchPointerDown(context, point(1, 1), {});
    const firstEdit = firstDown.result.command?.apply(map);

    expect(firstEdit && getTileIndex(firstEdit, TEST_TILE_LAYER_ID, 1, 1)).toBe(10);

    const secondContext = { ...context, map: firstEdit! };
    const secondDown = dispatchPointerDown(secondContext, point(2, 1), {});
    const secondEdit = secondDown.result.command?.apply(firstEdit!);

    expect(secondEdit && getTileIndex(secondEdit, TEST_TILE_LAYER_ID, 1, 1)).toBe(20);
    expect(secondEdit && getTileIndex(secondEdit, TEST_TILE_LAYER_ID, 2, 1)).toBe(30);
  });

  it('autotile brush refreshes neighbor variants during the live stroke', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'tileBrush' as const,
      brushIntent: { kind: 'autotile' as const, ruleId: edgeRuleId },
      resolvedBrush: resolvedAutotileBrush,
      autotileResolver,
      activeLayerId: TEST_TILE_LAYER_ID,
      selection: new Set<string>(),
      shiftKey: false,
    };

    const down = dispatchPointerDown(context, point(1, 1), {});
    const afterDown = down.result.command?.apply(map);
    const move = dispatchPointerMove({ ...context, map: afterDown! }, point(2, 1), down.session);
    const afterMove = move.result.command?.apply(afterDown!);
    const historyEdit = move.result.historyCommand?.apply(map);

    expect(afterDown && getTileIndex(afterDown, TEST_TILE_LAYER_ID, 1, 1)).toBe(10);
    expect(move.result.command).toBeDefined();
    expect(move.result.historyMode).toBe('replace');
    expect(afterMove && getTileIndex(afterMove, TEST_TILE_LAYER_ID, 1, 1)).toBe(20);
    expect(afterMove && getTileIndex(afterMove, TEST_TILE_LAYER_ID, 2, 1)).toBe(30);
    expect(historyEdit && getTileIndex(historyEdit, TEST_TILE_LAYER_ID, 1, 1)).toBe(20);
    expect(historyEdit && getTileIndex(historyEdit, TEST_TILE_LAYER_ID, 2, 1)).toBe(30);
  });

  it('erasing an autotile cell refreshes adjacent autotile variants', () => {
    const baseMap = createTestMap();
    const mapWithTwoCells = createStrokeTileCommand(TEST_TILE_LAYER_ID, [
      { tileX: 1, tileY: 1, oldIndex: 0, newIndex: 20 },
      { tileX: 2, tileY: 1, oldIndex: 0, newIndex: 30 },
    ]).apply(baseMap);
    const context = {
      map: mapWithTwoCells,
      activeTool: 'eraser' as const,
      brushIntent: { kind: 'eraser' as const },
      autotileResolver,
      activeLayerId: TEST_TILE_LAYER_ID,
      selection: new Set<string>(),
      shiftKey: false,
    };

    const down = dispatchPointerDown(context, point(2, 1), {});
    const edited = down.result.command?.apply(mapWithTwoCells);

    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 2, 1)).toBe(0);
    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 1, 1)).toBe(10);
  });

  it('tileBrush does not paint a different layer when the active layer is not paintable', () => {
    const map = createTestMap();
    const down = dispatchPointerDown(
      {
        map,
        activeTool: 'tileBrush',
        brushIntent: tileBrush,
        resolvedBrush: paintBrush(3),
        activeLayerId: TEST_OBJECT_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 2),
      {},
    );
    const edited = down.result.command?.apply(map);

    expect(down.result.command).toBeUndefined();
    expect(edited).toBeUndefined();
  });

  it('tileBrush emits a persistable paint command for an imported map palette brush', () => {
    const map = new TileborneMap({
      id: makeMapId('00000000-0000-4000-8000-000000000090'),
      schemaVersion: 1,
      size: { width: 2, height: 1 },
      tileSize: { width: 16, height: 16 },
      layers: [
        new TileLayer({
          id: importedLayerId,
          name: 'ground',
          visible: true,
          opacity: 1,
          chunks: [
            new TileChunk({
              x: 0,
              y: 0,
              width: 2,
              height: 1,
              tiles: [1, 2],
            }),
          ],
        }),
      ],
      objects: [],
      properties: {
        tiledSourcePath: '/fixtures/imported/gapped-firstgid.tmj',
        tilesetPackId: 'pack:00000000-0000-4000-8000-000000000093',
      },
    });
    const down = dispatchPointerDown(
      {
        map,
        activeTool: 'tileBrush',
        brushIntent: tileBrush,
        resolvedBrush: paintBrush(2),
        activeLayerId: undefined,
        selection: new Set(),
        shiftKey: false,
      },
      point(0, 0),
      {},
    );
    const edited = down.result.command?.apply(map);

    expect(down.result.command?.kind).toBe('tile-rectangle-fill');
    expect(edited && getTileIndex(edited, importedLayerId, 0, 0)).toBe(2);
    expect(() =>
      Schema.encodeUnknownSync(MapsUpdateRequest)({
        projectId: 'project:00000000-0000-4000-8000-000000000092' as ProjectId,
        map: edited!,
      }),
    ).not.toThrow();
  });

  it('tileBrush skips passive hover, same-cell drags, and no-op paints', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'tileBrush' as const,
      brushIntent: tileBrush,
      resolvedBrush: paintBrush(3),
      activeLayerId: TEST_TILE_LAYER_ID,
      selection: new Set<string>(),
      shiftKey: false,
    };

    const hover = dispatchPointerMove(context, point(2, 2), {});
    expect(hover.result.command).toBeUndefined();
    expect(hover.result.brushPreview).toMatchObject({ x: 2, y: 2, tileIndex: 3 });

    const down = dispatchPointerDown(context, point(2, 2), {});
    expect(down.result.command).toBeDefined();

    const sameCellMove = dispatchPointerMove(context, point(2, 2), down.session);
    expect(sameCellMove.result.command).toBeUndefined();

    const paintedMap = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 2, 3).apply(map);
    const noOpDown = dispatchPointerDown({ ...context, map: paintedMap }, point(2, 2), {});
    expect(noOpDown.result.command).toBeUndefined();
  });

  it('eraser pointer down paints live', () => {
    const baseMap = createTestMap();
    const map = createTileEditCommand(baseMap, TEST_TILE_LAYER_ID, 1, 1, 3).apply(baseMap);
    const down = dispatchPointerDown(
      {
        map,
        activeTool: 'eraser',
        brushIntent: { kind: 'eraser' },
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(1, 1),
      {},
    );
    const edited = down.result.command?.apply(map);

    expect(down.result.command?.kind).toBe('tile-rectangle-fill');
    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 1, 1)).toBe(0);
  });

  it('rectangleFill drag release emits TileRectangleFillCommand', () => {
    const map = createTestMap();
    const down = dispatchPointerDown(
      {
        map,
        activeTool: 'rectangleFill',
        brushIntent: tileBrush,
        resolvedBrush: paintBrush(2),
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(1, 1),
      {},
    );
    const { result } = dispatchPointerUp(
      {
        map,
        activeTool: 'rectangleFill',
        brushIntent: tileBrush,
        resolvedBrush: paintBrush(2),
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(3, 3),
      down.session,
    );
    expect(result.command?.kind).toBe('tile-rectangle-fill');
  });

  it('rectangleFill previews and applies resolved terrain brush intents', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'rectangleFill' as const,
      brushIntent: terrainBrush,
      resolvedBrush: paintBrush(6),
      activeLayerId: TEST_TILE_LAYER_ID,
      selection: new Set<string>(),
      shiftKey: false,
    };
    const down = dispatchPointerDown(context, point(1, 1), {});
    const move = dispatchPointerMove(context, point(3, 2), down.session);
    const up = dispatchPointerUp(context, point(3, 2), down.session);
    const edited = up.result.command?.apply(map);

    expect(move.result.brushPreview).toMatchObject({ x: 1, y: 1, w: 3, h: 2 });
    expect(up.result.command?.kind).toBe('tile-rectangle-fill');
    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 3, 2)).toBe(6);
  });

  it('tileBrush creates a placement-bearing object for placeable brushes on object layers', () => {
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'tileBrush',
        brushIntent: placeableBrush,
        resolvedBrush: resolvedPlaceableBrush,
        activeLayerId: TEST_OBJECT_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 3),
      {},
    );
    const edited = result.command?.apply(map);
    const object = edited?.objects[0];

    expect(result.command?.kind).toBe('object-place');
    expect(object).toMatchObject({
      kind: PLACEABLE_OBJECT_TYPE_ID,
      x: 64,
      y: 96,
      layerId: TEST_OBJECT_LAYER_ID,
    });
    expect(Option.getOrUndefined(object?.width ?? Option.none())).toBe(96);
    expect(Option.getOrUndefined(object?.height ?? Option.none())).toBe(128);
    expect(object?.placement?.placeableId).toBe(placeableId);
    expect(Option.getOrUndefined(object?.placement?.packId ?? Option.none())).toBe(
      resolvedPlaceableBrush.packId,
    );
    expect(Option.getOrUndefined(object?.placement?.assetId ?? Option.none())).toBe(
      resolvedPlaceableBrush.frame.assetId,
    );
  });

  it('tileBrush can place after loading maps with encoded optional object dimensions', () => {
    const existingObjectId = makeObjectId('00000000-0000-4000-8000-000000000045' as Uuid);
    const baseMap = createTestMap();
    const map = {
      id: baseMap.id,
      schemaVersion: baseMap.schemaVersion,
      size: baseMap.size,
      tileSize: baseMap.tileSize,
      properties: baseMap.properties,
      layers: baseMap.layers.map((layer) =>
        layer.id === TEST_OBJECT_LAYER_ID && layer._tag === 'object'
          ? new ObjectLayer({
              id: layer.id,
              name: layer.name,
              visible: layer.visible,
              opacity: layer.opacity,
              objectIds: [existingObjectId],
            })
          : layer,
      ),
      objects: [
        {
          id: existingObjectId,
          kind: PLACEABLE_OBJECT_TYPE_ID,
          x: 0,
          y: 0,
          width: { value: 64 },
          height: { value: 64 },
          layerId: TEST_OBJECT_LAYER_ID,
          properties: {},
          placement: {
            packId: {},
            placeableId,
            source: 'manual',
            assetId: { value: resolvedPlaceableBrush.frame.assetId },
            tileId: { value: resolvedPlaceableBrush.frame.tileId },
            gid: {},
          },
        } as unknown as MapObject,
      ],
    } as unknown as TileborneMap;
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'tileBrush',
        brushIntent: placeableBrush,
        resolvedBrush: resolvedPlaceableBrush,
        activeLayerId: TEST_OBJECT_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(4, 5),
      {},
    );
    const edited = result.command?.apply(map);

    expect(edited?.objects).toHaveLength(2);
    expect(Option.getOrUndefined(edited?.objects[0]?.width ?? Option.none())).toBe(64);
    expect(Option.getOrUndefined(edited?.objects[1]?.placement?.packId ?? Option.none())).toBe(
      resolvedPlaceableBrush.packId,
    );
  });

  it('tileBrush places placeables on the existing object layer when a tile layer is active', () => {
    // The map has an object layer but a tile layer is nominally active. A
    // placeable must never be dropped or written with the tile layerId — it is
    // routed to the existing object layer instead.
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'tileBrush',
        brushIntent: placeableBrush,
        resolvedBrush: resolvedPlaceableBrush,
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 3),
      {},
    );
    const edited = result.command?.apply(map);
    const object = edited?.objects[0];

    expect(result.command?.kind).toBe('object-place');
    expect(object?.kind).toBe(PLACEABLE_OBJECT_TYPE_ID);
    expect(object?.layerId).toBe(TEST_OBJECT_LAYER_ID);
  });

  it('tileBrush auto-creates an object layer for placeables when the map has none', () => {
    // Generated maps used to ship only tile layers (terrain/props/entities), so
    // placing a placeable found no object layer. Placement now auto-creates one
    // instead of silently dropping the object.
    const tileOnlyMap = makeTileborneMap({
      id: makeMapId('00000000-0000-4000-8000-000000000099'),
      width: 16,
      height: 16,
      tileWidth: 32,
      tileHeight: 32,
      layers: [
        new TileLayer({
          id: TEST_TILE_LAYER_ID,
          name: 'terrain',
          visible: true,
          opacity: 1,
          chunks: [],
        }),
      ],
    });
    const { result } = dispatchPointerDown(
      {
        map: tileOnlyMap,
        activeTool: 'tileBrush',
        brushIntent: placeableBrush,
        resolvedBrush: resolvedPlaceableBrush,
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 2),
      {},
    );
    const edited = result.command?.apply(tileOnlyMap);
    const objectLayer = edited?.layers.find((layer) => layer._tag === 'object');
    const object = edited?.objects[0];

    expect(result.command?.kind).toBe('object-place');
    expect(objectLayer).toBeDefined();
    expect(object?.kind).toBe(PLACEABLE_OBJECT_TYPE_ID);
    expect(object?.layerId).toBe(objectLayer?.id);
  });

  it('collisionPaint pointer down emits CollisionPaintCommand', () => {
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'collisionPaint',
        brushIntent: { kind: 'eraser' },
        activeLayerId: TEST_COLLISION_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(4, 4),
      {},
    );
    expect(result.command?.kind).toBe('collision-paint');
  });

  it('collisionPaint does not mutate when the active layer is not a collision layer', () => {
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'collisionPaint',
        brushIntent: { kind: 'eraser' },
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(4, 4),
      {},
    );

    expect(result.command).toBeUndefined();
  });

  it('regionMark drag release emits RegionMarkCommand', () => {
    const map = createTestMap();
    const down = dispatchPointerDown(
      {
        map,
        activeTool: 'regionMark',
        brushIntent: { kind: 'eraser' },
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 2),
      {},
    );
    const { result } = dispatchPointerUp(
      {
        map,
        activeTool: 'regionMark',
        brushIntent: { kind: 'eraser' },
        selection: new Set(),
        shiftKey: false,
      },
      point(5, 5),
      down.session,
    );
    expect(result.command?.kind).toBe('region-mark');
  });

  it('select drag previews a marquee and commits a rectangle selection', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'select' as const,
      brushIntent: { kind: 'eraser' as const },
      selection: new Set<string>(),
      shiftKey: false,
    };
    const down = dispatchPointerDown(context, point(1, 1), {});
    const move = dispatchPointerMove(context, point(3, 2), down.session);
    const up = dispatchPointerUp(context, point(3, 2), down.session);

    expect(down.result.selection && [...down.result.selection]).toEqual(['1:1']);
    expect(move.result.brushPreview).toMatchObject({ x: 1, y: 1, w: 3, h: 2, variant: 'select' });
    expect(up.result.selection && [...up.result.selection].sort()).toEqual(
      ['1:1', '1:2', '2:1', '2:2', '3:1', '3:2'].sort(),
    );
    expect(up.result.brushPreview).toBeNull();
  });

  it('select click without drag keeps single-tile selection and clears the marquee', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'select' as const,
      brushIntent: { kind: 'eraser' as const },
      selection: new Set<string>(),
      shiftKey: false,
    };
    const down = dispatchPointerDown(context, point(2, 2), {});
    const up = dispatchPointerUp(context, point(2, 2), down.session);

    expect(down.result.selection && [...down.result.selection]).toEqual(['2:2']);
    expect(up.result.selection).toBeUndefined();
    expect(up.result.brushPreview).toBeNull();
  });

  it('select drags a clicked object to a new tile, preserving its layer', () => {
    const baseMap = createTestMap();
    const placed = createObjectPlaceCommand(baseMap, {
      kind: gameObjectTypeIdForKey('prop'),
      x: 2 * 32,
      y: 2 * 32,
      layerId: TEST_OBJECT_LAYER_ID,
    }).apply(baseMap);
    const object = placed.objects[0]!;
    const context = {
      map: placed,
      activeTool: 'select' as const,
      brushIntent: { kind: 'eraser' as const },
      selection: new Set<string>(),
      shiftKey: false,
    };

    const down = dispatchPointerDown(context, point(2, 2), {});
    expect(down.session.objectId).toBe(object.id);
    expect(down.result.selection && [...down.result.selection]).toEqual([object.id]);

    const up = dispatchPointerUp(context, point(5, 4), down.session);
    const moved = up.result.command?.apply(placed);
    const movedObject = moved?.objects.find((entry) => entry.id === object.id);

    expect(up.result.command?.kind).toBe('object-move');
    expect(movedObject?.x).toBe(5 * 32);
    expect(movedObject?.y).toBe(4 * 32);
    expect(movedObject?.layerId).toBe(TEST_OBJECT_LAYER_ID);
  });

  it('select click on an object selects without emitting a (snapping) move', () => {
    const baseMap = createTestMap();
    const placed = createObjectPlaceCommand(baseMap, {
      kind: gameObjectTypeIdForKey('prop'),
      x: 2 * 32,
      y: 2 * 32,
      layerId: TEST_OBJECT_LAYER_ID,
    }).apply(baseMap);
    const context = {
      map: placed,
      activeTool: 'select' as const,
      brushIntent: { kind: 'eraser' as const },
      selection: new Set<string>(),
      shiftKey: false,
    };

    const down = dispatchPointerDown(context, point(2, 2), {});
    const up = dispatchPointerUp(context, point(2, 2), down.session);

    expect(up.result.command).toBeUndefined();
  });

  it('select ignores objects sitting on a hidden layer', () => {
    const baseMap = createTestMap();
    const placed = createObjectPlaceCommand(baseMap, {
      kind: gameObjectTypeIdForKey('prop'),
      x: 2 * 32,
      y: 2 * 32,
      layerId: TEST_OBJECT_LAYER_ID,
    }).apply(baseMap);
    const hidden = createSetLayerVisibilityCommand(placed, TEST_OBJECT_LAYER_ID, false)!.apply(placed);
    const context = {
      map: hidden,
      activeTool: 'select' as const,
      brushIntent: { kind: 'eraser' as const },
      selection: new Set<string>(),
      shiftKey: false,
    };

    const down = dispatchPointerDown(context, point(2, 2), {});

    expect(down.session.objectId).toBeUndefined();
    expect(down.result.selection && [...down.result.selection]).toEqual(['2:2']);
  });

  it('createFillSelectionTileCommand paints the active index into selected tiles only', () => {
    const map = createTestMap();
    const selection = new Set<string>([
      '1:1',
      '2:1',
      'object:00000000-0000-4000-8000-000000000099',
    ]);
    const command = createFillSelectionTileCommand(map, TEST_TILE_LAYER_ID, selection, 5);
    const edited = command?.apply(map);

    expect(command?.kind).toBe('tile-rectangle-fill');
    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 1, 1)).toBe(5);
    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 2, 1)).toBe(5);
  });

  it('createFillSelectionCommand resolves autotile variants across the filled selection', () => {
    const map = createTestMap();
    const selection = new Set<string>(['1:1', '2:1']);
    const command = createFillSelectionCommand(
      map,
      TEST_TILE_LAYER_ID,
      selection,
      resolvedAutotileBrush,
    );
    const edited = command?.apply(map);

    // 1:1 connects east to 2:1, 2:1 connects west to 1:1 (same variants the
    // brush would paint), proving the fill resolves edges inside the region.
    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 1, 1)).toBe(20);
    expect(edited && getTileIndex(edited, TEST_TILE_LAYER_ID, 2, 1)).toBe(30);
  });

  it('objectPlace tool places the active plugin-object brush kind on the object layer', () => {
    // The plugin-object marker brush (Battle Royale spawn/anchor/loot and any
    // future RPG spawn) places its abstract objectKind on each click. The
    // editor keys only on the brush kind + contributed objectKind.
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'objectPlace',
        brushIntent: { kind: 'plugin-object', objectKind: 'spawn-point', label: 'Spawn point' },
        activeLayerId: TEST_OBJECT_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(3, 4),
      {},
    );
    const edited = result.command?.apply(map);
    const object = edited?.objects[0];

    expect(result.command?.kind).toBe('object-place');
    expect(object).toMatchObject({
      kind: gameObjectTypeIdForKey('spawn-point'),
      x: 96,
      y: 128,
      layerId: TEST_OBJECT_LAYER_ID,
    });
  });

  it('plugin-object marker preview is 1x1 even when a previous placeable size carries over', () => {
    // Regression: switching from a large placeable to a sizeless marker left a
    // stale `placeObject` resolvedBrush in context. The preview must reflect the
    // CURRENT marker (1x1), never the previous placeable's footprint (96x128 =>
    // 3x4 tiles). Preview size keys on the active brush intent, not on a stale
    // resolvedBrush.
    const map = createTestMap();
    const move = dispatchPointerMove(
      {
        map,
        activeTool: 'objectPlace',
        brushIntent: { kind: 'plugin-object', objectKind: 'spawn-point', label: 'Spawn point' },
        resolvedBrush: resolvedPlaceableBrush,
        activeLayerId: TEST_OBJECT_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(5, 6),
      {},
    );

    expect(move.result.brushPreview).toMatchObject({ x: 5, y: 6, w: 1, h: 1 });
  });

  it('plugin-object brush placement is sticky — repeated clicks each place without resetting the brush', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'objectPlace' as const,
      brushIntent: { kind: 'plugin-object' as const, objectKind: 'loot-crate', label: 'Loot crate' },
      activeLayerId: TEST_OBJECT_LAYER_ID,
      selection: new Set<string>(),
      shiftKey: false,
    };

    const firstDown = dispatchPointerDown(context, point(1, 1), {});
    const afterFirst = firstDown.result.command?.apply(map);
    // The session never carries a "single-shot done" signal; the brush stays
    // active so the next click on the freshly edited map places again.
    const secondDown = dispatchPointerDown({ ...context, map: afterFirst! }, point(2, 2), firstDown.session);
    const afterSecond = secondDown.result.command?.apply(afterFirst!);

    expect(firstDown.result.command?.kind).toBe('object-place');
    expect(secondDown.result.command?.kind).toBe('object-place');
    expect(
      afterSecond?.objects.filter((entry) => entry.kind === gameObjectTypeIdForKey('loot-crate')),
    ).toHaveLength(2);
  });

  it('plugin-object brush auto-creates an object layer when the map has none', () => {
    const tileOnlyMap = makeTileborneMap({
      id: makeMapId('00000000-0000-4000-8000-0000000000a1'),
      width: 16,
      height: 16,
      tileWidth: 32,
      tileHeight: 32,
      layers: [
        new TileLayer({
          id: TEST_TILE_LAYER_ID,
          name: 'terrain',
          visible: true,
          opacity: 1,
          chunks: [],
        }),
      ],
    });
    const { result } = dispatchPointerDown(
      {
        map: tileOnlyMap,
        activeTool: 'objectPlace',
        brushIntent: { kind: 'plugin-object', objectKind: 'spawn-point', label: 'Spawn point' },
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 2),
      {},
    );
    const edited = result.command?.apply(tileOnlyMap);
    const objectLayer = edited?.layers.find((layer) => layer._tag === 'object');
    const object = edited?.objects[0];

    expect(objectLayer).toBeDefined();
    expect(object?.kind).toBe(gameObjectTypeIdForKey('spawn-point'));
    expect(object?.layerId).toBe(objectLayer?.id);
  });

  it('select shift-drag adds the marquee rectangle to the existing selection', () => {
    const map = createTestMap();
    const context = {
      map,
      activeTool: 'select' as const,
      brushIntent: { kind: 'eraser' as const },
      selection: new Set<string>(['9:9']),
      shiftKey: true,
    };
    const down = dispatchPointerDown(context, point(1, 1), {});
    const up = dispatchPointerUp(context, point(2, 1), down.session);

    expect(up.result.selection && [...up.result.selection].sort()).toEqual(
      ['1:1', '2:1', '9:9'].sort(),
    );
  });
});

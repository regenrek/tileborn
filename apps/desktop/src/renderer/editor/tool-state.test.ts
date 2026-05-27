import { describe, expect, it } from 'vitest';
import {
  makeAssetId,
  makeObjectId,
  TileChunk,
  TileLayer,
  TileborneMap,
  MapObject,
  MapObjectPlacement,
  makeLayerId,
  makeMapId,
  makePackId,
  makeTileId,
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
  dispatchPointerDown,
  dispatchPointerMove,
  dispatchPointerUp,
  type PointerPoint,
} from './viewport/tool-state.js';
import { createStrokeTileCommand, createTileEditCommand } from './editor-commands.js';
import { getTileIndex } from './map-utils.js';
import {
  createTestMap,
  TEST_COLLISION_LAYER_ID,
  TEST_OBJECT_LAYER_ID,
  TEST_TILE_LAYER_ID,
} from './test-fixtures.js';
import { normalizeMapForIpc } from '@/lib/map-ipc-normalization';
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
const autotileResolver = createAutotilePaintResolver(autotilePack, autotileIndexes)!;
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
      stagedObjectKind: 'prop',
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
          stagedObjectKind: 'prop',
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
      stagedObjectKind: 'prop',
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
      stagedObjectKind: 'prop',
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
      stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
      Schema.decodeUnknownSync(MapsUpdateRequest)({
        projectId: 'project:00000000-0000-4000-8000-000000000092' as ProjectId,
        map: normalizeMapForIpc(edited!),
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
      stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
      stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
      kind: 'placeable',
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
          kind: 'placeable',
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
        stagedObjectKind: 'prop',
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

  it('tileBrush does not place objects on a different layer when the active layer is not an object layer', () => {
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'tileBrush',
        brushIntent: placeableBrush,
        resolvedBrush: resolvedPlaceableBrush,
        stagedObjectKind: 'prop',
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 3),
      {},
    );

    expect(result.command).toBeUndefined();
  });

  it('tileBrush ignores placeable brush intents on tile layers', () => {
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'tileBrush',
        brushIntent: placeableBrush,
        resolvedBrush: resolvedPlaceableBrush,
        stagedObjectKind: 'prop',
        activeLayerId: TEST_TILE_LAYER_ID,
        selection: new Set(),
        shiftKey: false,
      },
      point(2, 2),
      {},
    );

    expect(result.command).toBeUndefined();
  });

  it('collisionPaint pointer down emits CollisionPaintCommand', () => {
    const map = createTestMap();
    const { result } = dispatchPointerDown(
      {
        map,
        activeTool: 'collisionPaint',
        brushIntent: { kind: 'eraser' },
        stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
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
        stagedObjectKind: 'prop',
        selection: new Set(),
        shiftKey: false,
      },
      point(5, 5),
      down.session,
    );
    expect(result.command?.kind).toBe('region-mark');
  });
});

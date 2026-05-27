import { describe, expect, it } from 'vitest';
import { Effect, Schema } from 'effect';
import { makeLayerId, TileborneMap, type ProjectId } from '@tileborne/core';
import {
  createIpcClient,
  MapsIpcRegistry,
  MapsUpdateRequest,
  type IpcClientTransport,
} from '@tileborne/ipc-contracts';

import { mapToIpcJson, normalizeMapForIpc } from '@/lib/map-ipc-normalization';

import {
  createCollisionPaintCommand,
  createEraseCommand,
  createRectangleFillCommand,
  createTileEditCommand,
} from './editor-commands.js';
import { findCollisionLayer, findTileLayer, getTileIndex, mapDeepEqual } from './map-utils.js';
import {
  createTestMap,
  createTestMapWithoutCollision,
  TEST_TILE_LAYER_ID,
} from './test-fixtures.js';

const toPlainIpcMap = (map: ReturnType<typeof createTestMap>): ReturnType<typeof createTestMap> =>
  JSON.parse(JSON.stringify(map)) as ReturnType<typeof createTestMap>;

const decodeMap = Schema.decodeUnknownSync(TileborneMap);
const TEST_PROJECT_ID = 'project:00000000-0000-4000-8000-000000000030' as ProjectId;

const createGeneratedTerrainProjectionMap = (): TileborneMap =>
  decodeMap({
    id: 'map:00000000-0000-4000-8000-000000000031',
    schemaVersion: 1,
    size: { width: 32, height: 24 },
    tileSize: { width: 32, height: 32 },
    layers: [
      {
        kind: 'tile',
        id: 'layer:00000000-0000-4000-8000-000000000032',
        name: 'terrain',
        visible: true,
        opacity: 1,
        chunks: [
          {
            x: 0,
            y: 0,
            width: 32,
            height: 24,
            tiles: Array.from({ length: 32 * 24 }, (_entry, index) =>
              index % 7 === 0 ? 28971 : 2602,
            ),
          },
        ],
      },
      {
        kind: 'tile',
        id: 'layer:00000000-0000-4000-8000-000000000033',
        name: 'props',
        visible: true,
        opacity: 1,
        chunks: [],
      },
      {
        kind: 'tile',
        id: 'layer:00000000-0000-4000-8000-000000000034',
        name: 'entities',
        visible: true,
        opacity: 1,
        chunks: [],
      },
    ],
    objects: [],
    properties: {
      generated: true,
      preset: 'dungeon',
      seed: 7272,
      tilesetPackId: 'pack:a6ffcd59-011f-4f05-a4e2-832b87155ade',
      tilesetProjection: {
        schemaVersion: 1,
        kind: 'generated-terrain-v1',
        tilesetPackId: 'pack:a6ffcd59-011f-4f05-a4e2-832b87155ade',
        preset: 'dungeon',
        seed: 7272,
        semantics: {
          floor: {
            semantic: 'floor',
            tileIndex: 2602,
            tileId: 'tile:ae75acef-10cf-4096-b57e-fb87c4a8ea23',
            tilesetId: 'tileset:91cc71a0-c678-4f7d-b8ba-ac7ce3179632',
            tilesetName: 'Terrain - Sample Tileset',
            atlasAssetPath: 'Tilesets/Tileset-Terrain.png',
          },
          wall: {
            semantic: 'wall',
            tileIndex: 28971,
            tileId: 'tile:16dbc1fb-6418-49e3-847b-0b4907f803ca',
            tilesetId: 'tileset:be698f83-9c03-4a3d-a7ce-aac1c91c3e2f',
            tilesetName: 'wall-1',
            atlasAssetPath: 'Tilesets/wall-1 - 3 tiles tall.png',
          },
          path: {
            semantic: 'path',
            tileIndex: 2602,
            tileId: 'tile:ae75acef-10cf-4096-b57e-fb87c4a8ea23',
            tilesetId: 'tileset:91cc71a0-c678-4f7d-b8ba-ac7ce3179632',
            tilesetName: 'Terrain - Sample Tileset',
            atlasAssetPath: 'Tilesets/Tileset-Terrain.png',
          },
        },
        diagnostics: [],
      },
    },
  });

describe('editor commands', () => {
  it('TileEditCommand apply/inverse round-trips map state', () => {
    const map = createTestMap();
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const edited = command.apply(map);
    expect(getTileIndex(edited, TEST_TILE_LAYER_ID, 2, 3)).toBe(4);
    const restored = command.inverse(edited).apply(edited);
    expect(getTileIndex(restored, TEST_TILE_LAYER_ID, 2, 3)).toBe(0);
  });

  it('TileEditCommand structurally shares untouched map data', () => {
    const map = createTestMap();
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const edited = command.apply(map);

    expect(edited).not.toBe(map);
    expect(edited.objects).toStrictEqual(map.objects);
    expect(edited.properties).toStrictEqual(map.properties);
    expect(edited.layers[1]).toBe(map.layers[1]);
    expect(findTileLayer(edited, TEST_TILE_LAYER_ID)).not.toBe(
      findTileLayer(map, TEST_TILE_LAYER_ID),
    );

    const noOp = createTileEditCommand(edited, TEST_TILE_LAYER_ID, 2, 3, 4).apply(edited);
    expect(noOp).toBe(edited);
  });

  it('TileEditCommand applies to maps after IPC serialization', () => {
    const map = toPlainIpcMap(createTestMap());
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const edited = command.apply(map);

    expect(getTileIndex(edited, TEST_TILE_LAYER_ID, 2, 3)).toBe(4);
  });

  it('TileEditCommand output encodes for maps:update IPC persistence', () => {
    const map = toPlainIpcMap(createTestMap());
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const edited = command.apply(map);

    expect(() =>
      Schema.encodeUnknownSync(MapsUpdateRequest)({
        projectId: 'project:00000000-0000-4000-8000-000000000030',
        map: edited,
      }),
    ).not.toThrow();
  });

  it('TileEditCommand output encodes after editing a generated empty secondary layer', () => {
    const map = decodeMap({
      id: 'map:00000000-0000-4000-8000-000000000031',
      schemaVersion: 1,
      size: { width: 32, height: 24 },
      tileSize: { width: 32, height: 32 },
      layers: [
        {
          kind: 'tile',
          id: 'layer:00000000-0000-4000-8000-000000000032',
          name: 'terrain',
          visible: true,
          opacity: 1,
          chunks: [
            {
              x: 0,
              y: 0,
              width: 32,
              height: 24,
              tiles: Array.from({ length: 32 * 24 }, () => 2602),
            },
          ],
        },
        {
          kind: 'tile',
          id: 'layer:00000000-0000-4000-8000-000000000033',
          name: 'props',
          visible: true,
          opacity: 1,
          chunks: [],
        },
      ],
      objects: [],
      properties: {
        generated: true,
        tilesetProjection: {
          schemaVersion: 1,
          kind: 'generated-terrain-v1',
          diagnostics: [],
        },
      },
    });
    const propsLayerId = makeLayerId('00000000-0000-4000-8000-000000000033');
    const command = createTileEditCommand(map, propsLayerId, 2, 3, 28971);
    const edited = command.apply(map);

    expect(() =>
      Schema.encodeUnknownSync(MapsUpdateRequest)({
        projectId: 'project:00000000-0000-4000-8000-000000000030',
        map: edited,
      }),
    ).not.toThrow();
  });

  it('normalizes edited maps before maps:update IPC persistence', () => {
    const map = decodeMap(mapToIpcJson(createTestMap()));
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const edited = command.apply(map);
    const normalized = normalizeMapForIpc(edited);

    expect(() =>
      Schema.decodeUnknownSync(MapsUpdateRequest)({
        projectId: 'project:00000000-0000-4000-8000-000000000030',
        map: normalized,
      }),
    ).not.toThrow();
  });

  it('normalizes generated map edits into contextBridge-safe maps:update requests', async () => {
    const map = createGeneratedTerrainProjectionMap();
    const propsLayerId = makeLayerId('00000000-0000-4000-8000-000000000033');
    const command = createTileEditCommand(map, propsLayerId, 2, 3, 28971);
    const edited = command.apply(map);
    const normalized = normalizeMapForIpc(edited);
    const bridged = structuredClone(normalized) as {
      readonly layers: readonly Record<string, unknown>[];
    };

    expect(bridged.layers[1]?.kind).toBe('tile');
    expect(bridged.layers[1]).not.toHaveProperty('_tag');
    expect(() =>
      Schema.decodeUnknownSync(MapsUpdateRequest)({
        projectId: TEST_PROJECT_ID,
        map: bridged,
      }),
    ).not.toThrow();

    const captured: { readonly channel: string; readonly payload: unknown }[] = [];
    const transport: IpcClientTransport = {
      invoke: (channel, payload) => {
        captured.push({ channel, payload });
        return Effect.succeed({});
      },
      subscribe: () => () => {},
    };
    const client = createIpcClient(MapsIpcRegistry, transport);

    await Effect.runPromise(
      client['tileborne:maps:update']({
        projectId: TEST_PROJECT_ID,
        map: bridged as unknown as TileborneMap,
      }),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.channel).toBe('tileborne:maps:update');
    expect(() => Schema.decodeUnknownSync(MapsUpdateRequest)(captured[0]?.payload)).not.toThrow();
  });

  it('TileRectangleFillCommand apply/inverse round-trips map state', () => {
    const map = createTestMap();
    const command = createRectangleFillCommand(map, TEST_TILE_LAYER_ID, 1, 1, 3, 3, 2);
    const edited = command.apply(map);
    expect(getTileIndex(edited, TEST_TILE_LAYER_ID, 2, 2)).toBe(2);
    const restored = command.inverse(edited).apply(edited);
    expect(getTileIndex(restored, TEST_TILE_LAYER_ID, 2, 2)).toBe(0);
  });

  it('TileRectangleFillCommand applies cross-chunk edits as one batched map update', () => {
    const layerId = makeLayerId('00000000-0000-4000-8000-000000000040');
    const map = decodeMap({
      id: 'map:00000000-0000-4000-8000-000000000041',
      schemaVersion: 1,
      size: { width: 64, height: 64 },
      tileSize: { width: 32, height: 32 },
      layers: [
        {
          kind: 'tile',
          id: layerId,
          name: 'terrain',
          visible: true,
          opacity: 1,
          chunks: [],
        },
      ],
      objects: [],
      properties: {},
    });
    const command = createRectangleFillCommand(map, layerId, 31, 31, 33, 33, 6);
    const edited = command.apply(map);
    const layer = findTileLayer(edited, layerId)!;

    expect(layer.chunks).toHaveLength(4);
    expect(getTileIndex(edited, layerId, 31, 31)).toBe(6);
    expect(getTileIndex(edited, layerId, 32, 31)).toBe(6);
    expect(getTileIndex(edited, layerId, 31, 32)).toBe(6);
    expect(getTileIndex(edited, layerId, 33, 33)).toBe(6);
    const restored = command.inverse(edited).apply(edited);
    expect(findTileLayer(restored, layerId)?.chunks).toHaveLength(4);
    expect(getTileIndex(restored, layerId, 33, 33)).toBe(0);
  });

  it('EraseCommand apply/inverse round-trips map state', () => {
    const map = createTestMap();
    const staged = createTileEditCommand(map, TEST_TILE_LAYER_ID, 4, 4, 5);
    const withTile = staged.apply(map);
    const command = createEraseCommand(withTile, TEST_TILE_LAYER_ID, 4, 4);
    const erased = command.apply(withTile);
    expect(getTileIndex(erased, TEST_TILE_LAYER_ID, 4, 4)).toBe(0);
    const restored = command.inverse(erased).apply(erased);
    expect(getTileIndex(restored, TEST_TILE_LAYER_ID, 4, 4)).toBe(5);
  });

  it('CollisionPaintCommand apply/inverse round-trips map state', () => {
    const map = createTestMap();
    const command = createCollisionPaintCommand(map, 5, 5);
    const edited = command.apply(map);
    expect(getTileIndex(edited, command.layerId, 5, 5)).toBe(1);
    const restored = command.inverse(edited).apply(edited);
    expect(getTileIndex(restored, command.layerId, 5, 5)).toBe(0);
  });

  it('CollisionPaintCommand inverse removes layer created on apply', () => {
    const map = createTestMapWithoutCollision();
    expect(findCollisionLayer(map)).toBeUndefined();
    const command = createCollisionPaintCommand(map, 5, 5);
    const edited = command.apply(map);
    expect(findCollisionLayer(edited)).toBeDefined();
    const restored = command.inverse(edited).apply(edited);
    expect(findCollisionLayer(restored)).toBeUndefined();
    expect(mapDeepEqual(restored, map)).toBe(true);
  });

  it('redo reapplies the original command after undo, not the inverse', () => {
    const map = createTestMap();
    const original = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const afterApply = original.apply(map);
    const inverse = original.inverse(afterApply);
    const afterUndo = inverse.apply(afterApply);
    expect(getTileIndex(afterUndo, TEST_TILE_LAYER_ID, 2, 3)).toBe(0);
    const afterRedo = original.apply(afterUndo);
    expect(getTileIndex(afterRedo, TEST_TILE_LAYER_ID, 2, 3)).toBe(4);
    const wrongRedo = inverse.apply(afterUndo);
    expect(getTileIndex(wrongRedo, TEST_TILE_LAYER_ID, 2, 3)).toBe(0);
  });
});

import {
  CollisionLayer,
  makeLayerId,
  makeMapId,
  makeTileborneMap,
  ObjectLayer,
  TileLayer,
} from '@tileborne/core';

const TILE_LAYER_ID = makeLayerId('00000000-0000-4000-8000-000000000010');
const OBJECT_LAYER_ID = makeLayerId('00000000-0000-4000-8000-000000000011');
const COLLISION_LAYER_ID = makeLayerId('00000000-0000-4000-8000-000000000012');

export const createTestMap = () =>
  makeTileborneMap({
    id: makeMapId('00000000-0000-4000-8000-000000000020'),
    width: 16,
    height: 16,
    tileWidth: 32,
    tileHeight: 32,
    layers: [
      new TileLayer({
        id: TILE_LAYER_ID,
        name: 'ground',
        visible: true,
        opacity: 1,
        chunks: [],
      }),
      new ObjectLayer({
        id: OBJECT_LAYER_ID,
        name: 'objects',
        visible: true,
        opacity: 1,
        objectIds: [],
      }),
      new CollisionLayer({
        id: COLLISION_LAYER_ID,
        name: 'collision',
        visible: true,
        opacity: 1,
        chunks: [],
      }),
    ],
  });

export const TEST_TILE_LAYER_ID = TILE_LAYER_ID;
export const TEST_OBJECT_LAYER_ID = OBJECT_LAYER_ID;

/** Map without a collision layer — for inverse tests when apply creates the layer. */
export const createTestMapWithoutCollision = () =>
  makeTileborneMap({
    id: makeMapId('00000000-0000-4000-8000-000000000021'),
    width: 16,
    height: 16,
    tileWidth: 32,
    tileHeight: 32,
    layers: [
      new TileLayer({
        id: TILE_LAYER_ID,
        name: 'ground',
        visible: true,
        opacity: 1,
        chunks: [],
      }),
      new ObjectLayer({
        id: OBJECT_LAYER_ID,
        name: 'objects',
        visible: true,
        opacity: 1,
        objectIds: [],
      }),
    ],
  });

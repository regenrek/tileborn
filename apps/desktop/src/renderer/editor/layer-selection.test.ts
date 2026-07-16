import { makeLayerId, makeMapId, makeTileborneMap, TileLayer } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import { resolveActiveLayerId, resolveToolActiveLayerId } from './layer-selection.js';
import {
  createTestMap,
  TEST_COLLISION_LAYER_ID,
  TEST_OBJECT_LAYER_ID,
  TEST_TILE_LAYER_ID,
} from './test-fixtures.js';

const TILE_ONLY_LAYER_ID = makeLayerId('00000000-0000-4000-8000-000000000030');

/** Freshly generated map shape: tile layers only, no object/collision layer. */
const createTileOnlyMap = () =>
  makeTileborneMap({
    id: makeMapId('00000000-0000-4000-8000-000000000031'),
    width: 16,
    height: 16,
    tileWidth: 32,
    tileHeight: 32,
    layers: [
      new TileLayer({
        id: TILE_ONLY_LAYER_ID,
        name: 'ground',
        visible: true,
        opacity: 1,
        chunks: [],
      }),
    ],
  });

describe('resolveActiveLayerId', () => {
  it('keeps a valid active layer selected', () => {
    expect(resolveActiveLayerId(createTestMap(), TEST_OBJECT_LAYER_ID)).toBe(TEST_OBJECT_LAYER_ID);
  });

  it('selects the first map layer when no active layer is set', () => {
    expect(resolveActiveLayerId(createTestMap(), null)).toBe(TEST_TILE_LAYER_ID);
  });
});

describe('resolveToolActiveLayerId', () => {
  it('moves brush tools to the first compatible layer', () => {
    const map = createTestMap();

    expect(
      resolveToolActiveLayerId(map, TEST_OBJECT_LAYER_ID, 'tileBrush', {
        kind: 'tile',
        tileId: 'tile:test' as never,
      }),
    ).toBe(TEST_TILE_LAYER_ID);
    expect(
      resolveToolActiveLayerId(map, TEST_TILE_LAYER_ID, 'tileBrush', {
        kind: 'placeable',
        placeableId: 'placeable:test' as never,
      }),
    ).toBe(TEST_OBJECT_LAYER_ID);
    expect(resolveToolActiveLayerId(map, TEST_TILE_LAYER_ID, 'collisionPaint')).toBe(
      TEST_COLLISION_LAYER_ID,
    );
  });

  it('keeps a valid layer (never returns null) when no layer of the required kind exists', () => {
    // Regression: a placeable brush wants an object layer, but a freshly
    // generated map only has tile layers. Returning `null` here made the
    // layers panel resolve `null` back to the first layer, fighting this
    // resolver in an infinite activeLayerId update loop (Maximum update depth).
    const map = createTileOnlyMap();
    const resolved = resolveToolActiveLayerId(map, TILE_ONLY_LAYER_ID, 'tileBrush', {
      kind: 'placeable',
      placeableId: 'placeable:test' as never,
    });
    expect(resolved).toBe(TILE_ONLY_LAYER_ID);
    // Fixed point: resolving again with the result must not change it (no loop).
    expect(
      resolveToolActiveLayerId(map, resolved, 'tileBrush', {
        kind: 'placeable',
        placeableId: 'placeable:test' as never,
      }),
    ).toBe(resolved);
    // And it must agree with the layers-panel resolver so they can't oscillate.
    expect(resolveActiveLayerId(map, resolved)).toBe(resolved);
  });
});

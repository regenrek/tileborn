import { describe, expect, it } from 'vitest';

import { resolveActiveLayerId, resolveToolActiveLayerId } from './layer-selection.js';
import {
  createTestMap,
  TEST_COLLISION_LAYER_ID,
  TEST_OBJECT_LAYER_ID,
  TEST_TILE_LAYER_ID,
} from './test-fixtures.js';

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

    expect(resolveToolActiveLayerId(map, TEST_OBJECT_LAYER_ID, 'tileBrush', { kind: 'tile', tileId: 'tile:test' as never })).toBe(
      TEST_TILE_LAYER_ID,
    );
    expect(resolveToolActiveLayerId(map, TEST_TILE_LAYER_ID, 'tileBrush', {
      kind: 'placeable',
      placeableId: 'placeable:test' as never,
    })).toBe(
      TEST_OBJECT_LAYER_ID,
    );
    expect(resolveToolActiveLayerId(map, TEST_TILE_LAYER_ID, 'collisionPaint')).toBe(
      TEST_COLLISION_LAYER_ID,
    );
  });
});

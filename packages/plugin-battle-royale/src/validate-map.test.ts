import {
  MapObject,
  gameObjectTypeIdForKey,
  makeTileborneMap,
  type TileborneMap,
} from '@tileborne/core';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from './id-utils.js';
import { validateMap } from './validate-map.js';

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
  properties: Record<string, string | number> = {},
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kind),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties,
  });

const fixtureMap = (objects: MapObject[]): TileborneMap =>
  makeTileborneMap({
    id: TEST_MAP_ID,
    width: 64,
    height: 64,
    tileWidth: 32,
    tileHeight: 32,
    objects,
  });

describe('validateMap', () => {
  it('passes when spawn, anchor, and loot requirements are met', () => {
    const map = fixtureMap([
      makeTestObject(TEST_OBJECT_IDS[0], 'spawn-point', 64, 64),
      makeTestObject(TEST_OBJECT_IDS[1], 'spawn-point', 256, 64),
      makeTestObject(TEST_OBJECT_IDS[2], 'spawn-point', 64, 256),
      makeTestObject(TEST_OBJECT_IDS[3], 'spawn-point', 256, 256),
      makeTestObject(TEST_OBJECT_IDS[4], 'shrink-zone-anchor', 1024, 1024),
      makeTestObject(TEST_OBJECT_IDS[5], 'loot-crate', 512, 512, { tier: 'common' }),
    ]);
    expect(validateMap(map)).toEqual({ ok: true, issues: [] });
  });

  it('reports missing spawn points', () => {
    const map = fixtureMap([
      makeTestObject(TEST_OBJECT_IDS[0], 'spawn-point', 1, 1),
      makeTestObject(TEST_OBJECT_IDS[4], 'shrink-zone-anchor', 32, 32),
      makeTestObject(TEST_OBJECT_IDS[5], 'loot-crate', 10, 10),
    ]);
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('spawn-point'))).toBe(true);
  });

  it('warns when spawn points are too close for player clearance', () => {
    const map = fixtureMap([
      makeTestObject(TEST_OBJECT_IDS[0], 'spawn-point', 1, 1),
      makeTestObject(TEST_OBJECT_IDS[1], 'spawn-point', 2, 2),
      makeTestObject(TEST_OBJECT_IDS[2], 'spawn-point', 20, 20),
      makeTestObject(TEST_OBJECT_IDS[3], 'spawn-point', 30, 30),
      makeTestObject(TEST_OBJECT_IDS[4], 'shrink-zone-anchor', 32, 32),
      makeTestObject(TEST_OBJECT_IDS[5], 'loot-crate', 10, 10),
    ]);
    const result = validateMap(map);

    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual({
      severity: 'warning',
      message:
        'Closest spawn points are 1.4 world units apart; keep at least 40 for player clearance',
      location: 'objects',
    });
  });
});

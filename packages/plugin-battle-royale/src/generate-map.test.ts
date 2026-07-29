import { describe, expect, it } from 'vitest';
import { RuntimeMapPackage } from '@tileborne/core';
import { Schema } from 'effect';

import {
  BARRIER_KIND,
  DECOY_KIND,
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  TRAP_KIND,
} from './constants.js';
import { generateMap } from './generate-map.js';
import { buildTestMapPackage } from './test-map-package.js';

describe('generateMap', () => {
  it('returns identical output for the same seed', () => {
    const opts = { width: 40, height: 40, spawnCount: 6, lootDensity: 0.35 };
    const first = generateMap('seed-alpha', opts);
    const second = generateMap('seed-alpha', opts);
    expect(first).toEqual(second);
  });

  it('honors requested width and height', () => {
    const map = generateMap('sized', { width: 52, height: 44, spawnCount: 4, lootDensity: 0.25 });
    expect(map.size).toEqual({ width: 52, height: 44 });
  });

  it('includes loot, hazards, decoys, and collision barriers in generated maps', () => {
    const map = generateMap('content-rich', {
      width: 48,
      height: 40,
      spawnCount: 8,
      lootDensity: 0.4,
    });
    const kinds = new Set(map.objects.map((object) => object.kind));

    expect(kinds.has(LOOT_CRATE_KIND)).toBe(true);
    expect(kinds.has(TRAP_KIND)).toBe(true);
    expect(kinds.has(DECOY_KIND)).toBe(true);
    expect(kinds.has(BARRIER_KIND)).toBe(true);
  });

  it('stores generated object positions in authored pixels across the map', () => {
    const map = generateMap('world-space', {
      width: 48,
      height: 40,
      spawnCount: 8,
      lootDensity: 0.4,
    });
    const worldWidth = map.size.width * map.tileSize.width;
    const worldHeight = map.size.height * map.tileSize.height;

    for (const object of map.objects) {
      expect(object.x).toBeGreaterThanOrEqual(0);
      expect(object.y).toBeGreaterThanOrEqual(0);
      expect(object.x).toBeLessThan(worldWidth);
      expect(object.y).toBeLessThan(worldHeight);
      expect(object.x % map.tileSize.width).toBe(0);
      expect(object.y % map.tileSize.height).toBe(0);
    }

    const spawnPoints = map.objects.filter((object) => object.kind === SPAWN_POINT_KIND);
    expect(
      spawnPoints.some((object) => object.x === (map.size.width - 2) * map.tileSize.width),
    ).toBe(true);
    expect(
      spawnPoints.some((object) => object.y === (map.size.height - 2) * map.tileSize.height),
    ).toBe(true);

    expect(map.objects.find((object) => object.kind === SHRINK_ZONE_ANCHOR_KIND)).toMatchObject({
      x: worldWidth / 2,
      y: worldHeight / 2,
    });
  });

  it('projects generated authored pixels to runtime tile placements in package fixtures', () => {
    const map = generateMap('package-space', {
      width: 48,
      height: 40,
      spawnCount: 8,
      lootDensity: 0.4,
    });
    const pkg = Schema.decodeUnknownSync(RuntimeMapPackage)(buildTestMapPackage({ map }));

    const authoredAnchor = map.objects.find((object) => object.kind === SHRINK_ZONE_ANCHOR_KIND);
    const packagedAnchor = pkg.placements.find(
      (placement) => placement.typeId === SHRINK_ZONE_ANCHOR_KIND,
    );

    expect(authoredAnchor).toMatchObject({
      x: (map.size.width * map.tileSize.width) / 2,
      y: (map.size.height * map.tileSize.height) / 2,
    });
    expect(packagedAnchor).toMatchObject({
      x: map.size.width / 2,
      y: map.size.height / 2,
    });

    const packagedSpawns = pkg.placements.filter(
      (placement) => placement.typeId === SPAWN_POINT_KIND,
    );
    expect(packagedSpawns.some((placement) => placement.x === map.size.width - 2)).toBe(true);
    expect(packagedSpawns.some((placement) => placement.y === map.size.height - 2)).toBe(true);
  });
});

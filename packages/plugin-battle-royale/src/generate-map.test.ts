import { describe, expect, it } from 'vitest';

import { BARRIER_KIND, DECOY_KIND, LOOT_CRATE_KIND, TRAP_KIND } from './constants.js';
import { generateMap } from './generate-map.js';

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
});

import { describe, expect, it } from 'vitest';

import terrainTransitionGolden from './__goldens__/terrain-transition-grass-water/3x3-center-grass.json' with { type: 'json' };
import { assertGoldenMatch } from './helpers.js';
import { buildTerrainTransitionGolden } from './scenarios.js';

describe('terrain transition grass/water', () => {
  it('matches golden 3×3 grass center surrounded by water', () => {
    const golden = buildTerrainTransitionGolden();
    assertGoldenMatch(
      'terrain-transition-grass-water/3x3-center-grass.json',
      golden,
      terrainTransitionGolden,
    );
    expect(golden.center.overlays.length).toBeGreaterThan(0);
  });
});

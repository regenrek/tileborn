import { describe, expect, it } from 'vitest';

import wallRulesGolden from './__goldens__/tiled-wall-rules/wall-test-mask-table.json' with { type: 'json' };
import { assertGoldenMatch } from './helpers.js';
import { buildTiledSourceWallRulesGolden } from './scenarios.js';

describe('Tiled source wall rules', () => {
  it('matches golden compiled mask table from synthetic wall-rule TMX', () => {
    const golden = buildTiledSourceWallRulesGolden();
    assertGoldenMatch('tiled-wall-rules/wall-test-mask-table.json', golden, wallRulesGolden);
    expect(Object.keys(golden.maskTable).length).toBeGreaterThan(0);
  });
});

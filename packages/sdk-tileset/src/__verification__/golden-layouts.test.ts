import { describe, it } from 'vitest';

import layout16x16Basic from './__goldens__/layouts/16x16-basic.json' with { type: 'json' };
import layout4x4Basic from './__goldens__/layouts/4x4-basic.json' with { type: 'json' };
import layout4x4Variants from './__goldens__/layouts/4x4-variants.json' with { type: 'json' };
import layout8x8Basic from './__goldens__/layouts/8x8-basic.json' with { type: 'json' };
import { assertGoldenMatch } from './helpers.js';
import { buildLayoutGoldens } from './scenarios.js';

describe('golden layout snapshots', () => {
  it('matches committed 4×4, 8×8, and 16×16 layout goldens', () => {
    const layouts = buildLayoutGoldens();
    assertGoldenMatch('layouts/4x4-basic.json', layouts['4x4-basic'], layout4x4Basic);
    assertGoldenMatch('layouts/4x4-variants.json', layouts['4x4-variants'], layout4x4Variants);
    assertGoldenMatch('layouts/8x8-basic.json', layouts['8x8-basic'], layout8x8Basic);
    assertGoldenMatch('layouts/16x16-basic.json', layouts['16x16-basic'], layout16x16Basic);
  });
});

import { describe, it } from 'vitest';

import grid32MarginSpacingGolden from './__goldens__/uvs/grid-32-margin-spacing.json' with { type: 'json' };
import meadowFrameIndexGolden from './__goldens__/uvs/meadow-frame-index.json' with { type: 'json' };
import perfectGrid16Golden from './__goldens__/uvs/perfect-grid-16.json' with { type: 'json' };
import { assertGoldenMatch } from './helpers.js';
import { buildUvGoldens } from './scenarios.js';

describe('golden UV layout tables', () => {
  it('matches committed atlas slice and frame index goldens', () => {
    const uvs = buildUvGoldens();
    assertGoldenMatch('uvs/perfect-grid-16.json', uvs['perfect-grid-16'], perfectGrid16Golden);
    assertGoldenMatch(
      'uvs/grid-32-margin-spacing.json',
      uvs['grid-32-margin-spacing'],
      grid32MarginSpacingGolden,
    );
    assertGoldenMatch(
      'uvs/meadow-frame-index.json',
      uvs['meadow-frame-index'],
      meadowFrameIndexGolden,
    );
  });
});

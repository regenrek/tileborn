import { describe, expect, it } from 'vitest';

import { normalizeRouteParam } from './route-params';

describe('normalizeRouteParam', () => {
  it('decodes repeatedly encoded route params', () => {
    expect(normalizeRouteParam('project%25253Af317f4c8-1c50-4186-b22d-a530f1c3ff90')).toBe(
      'project:f317f4c8-1c50-4186-b22d-a530f1c3ff90',
    );
  });

  it('leaves malformed percent escapes unchanged', () => {
    expect(normalizeRouteParam('project%ZZ')).toBe('project%ZZ');
  });
});

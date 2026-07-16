import { describe, expect, it } from 'vitest';

import { hasMapDimensionErrors, validateMapDimensions } from './map-form-validation';

describe('validateMapDimensions', () => {
  it('accepts positive integer width and height', () => {
    expect(validateMapDimensions({ width: '64', height: '32' })).toEqual({});
    expect(hasMapDimensionErrors(validateMapDimensions({ width: '64', height: '32' }))).toBe(false);
  });

  it('rejects invalid dimensions and seed', () => {
    const errors = validateMapDimensions({ width: '0', height: 'x', seed: '1.5' });
    expect(errors.width).toBeDefined();
    expect(errors.height).toBeDefined();
    expect(errors.seed).toBeDefined();
    expect(hasMapDimensionErrors(errors)).toBe(true);
  });
});

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { FalloffSpec, LinearFalloff, NoFalloff, evaluateFalloff } from './falloff.js';

describe('evaluateFalloff', () => {
  it('NoFalloff is always full damage', () => {
    expect(evaluateFalloff(new NoFalloff(), 0)).toBe(1);
    expect(evaluateFalloff(new NoFalloff(), 1000)).toBe(1);
  });

  it('LinearFalloff is full inside start, floors past end, lerps between', () => {
    const spec = new LinearFalloff({ startDistance: 0, endDistance: 10, minMultiplier: 0 });
    expect(evaluateFalloff(spec, 0)).toBe(1);
    expect(evaluateFalloff(spec, 5)).toBeCloseTo(0.5);
    expect(evaluateFalloff(spec, 10)).toBe(0);
    expect(evaluateFalloff(spec, 100)).toBe(0);
  });

  it('clamps a degenerate window to the floor', () => {
    const spec = new LinearFalloff({ startDistance: 10, endDistance: 5, minMultiplier: 0.25 });
    expect(evaluateFalloff(spec, 12)).toBe(0.25);
  });

  it('decreases monotonically with distance', () => {
    const spec = new LinearFalloff({ startDistance: 2, endDistance: 20, minMultiplier: 0.2 });
    const near = evaluateFalloff(spec, 4);
    const far = evaluateFalloff(spec, 16);
    expect(near).toBeGreaterThan(far);
  });

  it('round-trips a FalloffSpec union', () => {
    const spec = new LinearFalloff({ startDistance: 1, endDistance: 9, minMultiplier: 0.3 });
    const encoded = Schema.encodeUnknownSync(FalloffSpec)(spec);
    const decoded = Schema.decodeUnknownSync(FalloffSpec)(encoded);
    expect(decoded._tag).toBe('LinearFalloff');
  });
});

import { describe, expect, it } from 'vitest';

import { createFixedClock } from './clock.js';

describe('createFixedClock', () => {
  it('starts at tick 0 by default', () => {
    const clock = createFixedClock({ dtMs: 16 });
    expect(clock.tick()).toBe(0);
    expect(clock.dtMs()).toBe(16);
    expect(clock.elapsedMs()).toBe(0);
  });

  it('advances deterministically and tracks elapsed virtual time', () => {
    const clock = createFixedClock({ dtMs: 20, startTick: 5 });
    expect(clock.advance()).toBe(6);
    expect(clock.advance(4)).toBe(10);
    expect(clock.elapsedMs()).toBe(200);
  });

  it('rejects invalid timesteps and advances', () => {
    expect(() => createFixedClock({ dtMs: 0 })).toThrow(RangeError);
    expect(() => createFixedClock({ dtMs: Number.NaN })).toThrow(RangeError);
    const clock = createFixedClock({ dtMs: 16 });
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(1.5)).toThrow(RangeError);
  });
});

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  HealthComponent,
  InvalidHealthError,
  applyDamageToHealth,
  fullHealth,
  makeHealth,
} from './health.js';

describe('makeHealth', () => {
  it('accepts a valid pool', () => {
    const result = makeHealth(80, 100);
    expect(Result.isSuccess(result)).toBe(true);
    const health = Result.getOrElse(result, () => fullHealth(0));
    expect(health.current).toBe(80);
    expect(health.max).toBe(100);
  });

  it('clamps current into [0, max]', () => {
    expect(Result.getOrElse(makeHealth(250, 100), () => fullHealth(0)).current).toBe(100);
    expect(Result.getOrElse(makeHealth(-5, 100), () => fullHealth(0)).current).toBe(0);
  });

  it('fails with InvalidHealthError on a negative or non-finite max', () => {
    const negative = makeHealth(10, -1);
    const nan = makeHealth(10, Number.NaN);
    expect(Result.isFailure(negative)).toBe(true);
    expect(Result.isFailure(nan)).toBe(true);
    if (Result.isFailure(negative)) {
      expect(negative.failure).toBeInstanceOf(InvalidHealthError);
    }
  });
});

describe('HealthComponent derived state', () => {
  it('reports defeat at current <= 0', () => {
    expect(fullHealth(100).isDefeated).toBe(false);
    expect(new HealthComponent({ current: 0, max: 100 }).isDefeated).toBe(true);
    expect(new HealthComponent({ current: -3, max: 100 }).isDefeated).toBe(true);
  });

  it('reports full state', () => {
    expect(fullHealth(50).isFull).toBe(true);
    expect(new HealthComponent({ current: 49, max: 50 }).isFull).toBe(false);
  });

  it('round-trips through schema encode/decode', () => {
    const health = fullHealth(120);
    const encoded = Schema.encodeUnknownSync(HealthComponent)(health);
    expect(encoded).toEqual({ current: 120, max: 120 });
    const decoded = Schema.decodeUnknownSync(HealthComponent)(encoded);
    expect(decoded.current).toBe(120);
    expect(decoded.isFull).toBe(true);
  });
});

describe('applyDamageToHealth', () => {
  it('subtracts and clamps non-lethal damage', () => {
    expect(applyDamageToHealth(fullHealth(100), 30).current).toBe(70);
  });

  it('clamps overkill to exactly 0', () => {
    expect(applyDamageToHealth(fullHealth(100), 999).current).toBe(0);
  });

  it('guards negative and non-finite amounts (never heals)', () => {
    const damaged = new HealthComponent({ current: 40, max: 100 });
    expect(applyDamageToHealth(damaged, -50).current).toBe(40);
    expect(applyDamageToHealth(damaged, Number.NaN).current).toBe(40);
    expect(applyDamageToHealth(damaged, Number.POSITIVE_INFINITY).current).toBe(40);
  });

  it('treats zero damage as a no-op', () => {
    expect(applyDamageToHealth(fullHealth(100), 0).current).toBe(100);
  });

  it('does not mutate the input pool', () => {
    const health = fullHealth(100);
    applyDamageToHealth(health, 25);
    expect(health.current).toBe(100);
  });
});

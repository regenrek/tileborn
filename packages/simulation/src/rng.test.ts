import { describe, expect, it } from 'vitest';

import { createSeededRng } from './rng.js';

const sequence = (seed: number, length: number): number[] => {
  const rng = createSeededRng(seed);
  return Array.from({ length }, () => rng.nextUint32());
};

describe('createSeededRng', () => {
  it('produces an identical sequence for the same seed', () => {
    expect(sequence(1234, 16)).toEqual(sequence(1234, 16));
  });

  it('produces a different sequence for a different seed', () => {
    expect(sequence(1, 16)).not.toEqual(sequence(2, 16));
  });

  it('yields floats in [0, 1)', () => {
    const rng = createSeededRng(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('yields integers in [0, maxExclusive)', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextInt(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it('returns 0 for a non-positive bound', () => {
    const rng = createSeededRng(7);
    expect(rng.nextInt(0)).toBe(0);
    expect(rng.nextInt(-5)).toBe(0);
  });

  it('clone resumes from the current state, reproducing the tail', () => {
    const rng = createSeededRng(42);
    rng.nextUint32();
    rng.nextUint32();
    const forked = rng.clone();
    const fromOriginal = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];
    const fromClone = [forked.nextUint32(), forked.nextUint32(), forked.nextUint32()];
    expect(fromClone).toEqual(fromOriginal);
  });

  it('exposes a 32-bit unsigned state snapshot', () => {
    const rng = createSeededRng(0);
    const value = rng.nextUint32();
    expect(rng.state()).toBe(value);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(0x100000000);
  });
});

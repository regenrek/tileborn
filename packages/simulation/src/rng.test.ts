import { describe, expect, it } from 'vitest';

import { createSeededRng, createSeededRngFromSnapshot } from './rng.js';

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

  it('floors a non-integer bound', () => {
    const rng = createSeededRng(11);
    for (let i = 0; i < 200; i += 1) {
      expect(rng.nextInt(3.9)).toBeLessThan(3);
    }
  });

  it('samples nextInt without modulo bias over a small range', () => {
    // 2^32 is not divisible by 7, so a naive `% 7` would over-represent the
    // first few buckets. Rejection sampling should keep buckets near-uniform.
    const buckets = 7;
    const samples = 35_000;
    const counts = new Array<number>(buckets).fill(0);
    const rng = createSeededRng(123_456);
    for (let i = 0; i < samples; i += 1) {
      counts[rng.nextInt(buckets)]! += 1;
    }
    const expected = samples / buckets;
    for (const count of counts) {
      // Within ~6% of the uniform expectation. This keeps the statistical
      // sanity check meaningful without weakening the sample under parallel load.
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.06);
    }
  }, 20_000);

  it('clone resumes from the current state, reproducing the tail', () => {
    const rng = createSeededRng(42);
    rng.nextUint32();
    rng.nextUint32();
    const forked = rng.clone();
    const fromOriginal = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];
    const fromClone = [forked.nextUint32(), forked.nextUint32(), forked.nextUint32()];
    expect(fromClone).toEqual(fromOriginal);
  });

  it('snapshot resumes from the exact current state after serialization', () => {
    const rng = createSeededRng(77);
    rng.nextUint32();
    rng.nextUint32();
    const snapshot = JSON.parse(JSON.stringify(rng.snapshot())) as ReturnType<typeof rng.snapshot>;
    const restored = createSeededRngFromSnapshot(snapshot);

    expect([restored.nextUint32(), restored.nextUint32(), restored.nextUint32()]).toEqual([
      rng.nextUint32(),
      rng.nextUint32(),
      rng.nextUint32(),
    ]);
  });

  it('exposes a stable 32-bit state fingerprint that advances with the stream', () => {
    const rng = createSeededRng(0);
    const before = rng.state();
    expect(Number.isInteger(before)).toBe(true);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThan(0x100000000);
    // The fingerprint is stable while the generator is idle...
    expect(rng.state()).toBe(before);
    // ...and changes once the stream advances.
    rng.nextUint32();
    expect(rng.state()).not.toBe(before);
  });

  it('reseeds zero deterministically (no degenerate all-zero state)', () => {
    expect(sequence(0, 8)).toEqual(sequence(0, 8));
    expect(sequence(0, 8).every((value) => value === 0)).toBe(false);
  });
});

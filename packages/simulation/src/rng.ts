/**
 * Deterministic entropy port. The *only* source of randomness in the
 * simulation — systems take a {@link SeededRng}, never `Math.random`. The
 * runtime/plugin inject one so replays are bit-identical for a fixed seed.
 */
export interface SeededRng {
  /** Next unsigned 32-bit integer, advancing internal state. */
  readonly nextUint32: () => number;
  /** Next float in `[0, 1)`, advancing internal state. */
  readonly nextFloat: () => number;
  /**
   * Next integer in `[0, maxExclusive)` with no modulo bias. `maxExclusive <= 0`
   * (or non-finite) yields `0`; a non-integer bound is floored.
   */
  readonly nextInt: (maxExclusive: number) => number;
  /**
   * A stable 32-bit fingerprint of the current internal state, for replay
   * checkpoints / change detection. It is *not* the full generator state (which
   * is 256-bit) and cannot reconstruct the generator — use {@link clone} for that.
   */
  readonly state: () => number;
  /** A new generator resuming from this generator's exact current state. */
  readonly clone: () => SeededRng;
}

const MASK_64 = (1n << 64n) - 1n;
const TWO_POW_32 = 0x1_0000_0000;
const MASK_32 = 0xffffffffn;

const rotl = (value: bigint, shift: number): bigint =>
  ((value << BigInt(shift)) & MASK_64) | (value >> BigInt(64 - shift));

/**
 * Derive the four 64-bit xoshiro lanes from a single seed. Ported (with the
 * same constants) from the repo's proven `Xoshiro256StarStarRng`
 * (`@tileborne/runtime-wasm` procgen) so the combat RNG matches the established
 * generator; copied rather than cross-imported to keep `@tileborne/simulation`
 * dependency-light (no `runtime-wasm` edge, per ADR-0018).
 */
const splitSeed = (seed: bigint): readonly [bigint, bigint, bigint, bigint] => {
  let state = seed & MASK_64;
  if (state === 0n) {
    state = 0x9e3779b97f4a7c15n;
  }
  const s0 = (state ^ 0x9e3779b97f4a7c15n) & MASK_64;
  const s1 = (state + 0xbf58476d1ce4e5b9n) & MASK_64;
  const s2 = (state + 0x94d049bb133111ebn) & MASK_64;
  const s3 = (state + 0x2545be4955c6a1bn) & MASK_64;
  return [s0 || 1n, s1 || 2n, s2 || 3n, s3 || 4n];
};

const normalizeSeed = (seed: number): bigint => BigInt(seed >>> 0);

interface Lanes {
  s0: bigint;
  s1: bigint;
  s2: bigint;
  s3: bigint;
}

/**
 * Internal factory over explicit lane state, shared by {@link createSeededRng}
 * (seed entry) and {@link SeededRng.clone} (exact-state resume). xoshiro256**:
 * a high-quality, equidistributed generator with unbiased integer draws.
 */
const fromLanes = (lanes: Lanes): SeededRng => {
  const nextUint64 = (): bigint => {
    const result = rotl(lanes.s1 * 5n, 7) * 9n;
    const t = lanes.s1 << 17n;

    lanes.s2 ^= lanes.s0;
    lanes.s3 ^= lanes.s1;
    lanes.s1 ^= lanes.s2;
    lanes.s0 ^= lanes.s3;
    lanes.s2 ^= t;
    lanes.s3 = rotl(lanes.s3, 45);

    return result & MASK_64;
  };

  const nextUint32 = (): number => Number(nextUint64() & MASK_32) >>> 0;

  const nextFloat = (): number => nextUint32() / TWO_POW_32;

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
      return 0;
    }
    const span = Math.floor(maxExclusive);
    if (span <= 0) {
      return 0;
    }
    // Unbiased rejection sampling: discard draws in the partial bucket above the
    // largest multiple of `span` <= 2^32, removing the modulo bias of a plain
    // `nextUint32() % span`. Expected rejections are < 1 for any reasonable span.
    const limit = Math.floor(TWO_POW_32 / span) * span;
    let draw = nextUint32();
    while (draw >= limit) {
      draw = nextUint32();
    }
    return draw % span;
  };

  return {
    nextUint32,
    nextFloat,
    nextInt,
    state: () => Number(lanes.s0 & MASK_32) >>> 0,
    clone: () => fromLanes({ s0: lanes.s0, s1: lanes.s1, s2: lanes.s2, s3: lanes.s3 }),
  };
};

/**
 * Create a seeded RNG backed by xoshiro256** with unbiased integer sampling.
 * Worker-safe and pure aside from the explicit, clone-able internal state; the
 * same seed always yields the same bit-identical sequence.
 */
export const createSeededRng = (seed: number): SeededRng => {
  const [s0, s1, s2, s3] = splitSeed(normalizeSeed(seed));
  return fromLanes({ s0, s1, s2, s3 });
};

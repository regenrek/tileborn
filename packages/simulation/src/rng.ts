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
  /** Next integer in `[0, maxExclusive)`. `maxExclusive <= 0` yields `0`. */
  readonly nextInt: (maxExclusive: number) => number;
  /** Snapshot of the current 32-bit state (for replay checkpoints). */
  readonly state: () => number;
  /** A new generator resuming from this generator's current state. */
  readonly clone: () => SeededRng;
}

const MASK_32 = 0x100000000;

const normalizeSeed = (seed: number): number => seed >>> 0;

/**
 * Create a seeded RNG using the same LCG discipline as the runtime's
 * `DeterministicClock.random` (`state = 1664525 * state + 1013904223 mod 2^32`).
 * Worker-safe and pure aside from the explicit, snapshot-able internal state.
 */
export const createSeededRng = (seed: number): SeededRng => {
  let rngState = normalizeSeed(seed);

  const nextUint32 = (): number => {
    rngState = (1664525 * rngState + 1013904223) >>> 0;
    return rngState;
  };

  const nextFloat = (): number => nextUint32() / MASK_32;

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
      return 0;
    }
    return Math.floor(nextFloat() * maxExclusive);
  };

  const self: SeededRng = {
    nextUint32,
    nextFloat,
    nextInt,
    state: () => rngState,
    clone: () => createSeededRng(rngState),
  };
  return self;
};

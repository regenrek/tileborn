/**
 * Deterministic time port for the simulation. Fixed-timestep, integer tick
 * counter — there is no `Date.now`/`performance.now` here so replays are
 * reproducible. The runtime/plugin drive {@link SimulationClock.advance} once
 * per fixed tick.
 */
export interface SimulationClock {
  /** Current integer tick. */
  readonly tick: () => number;
  /** Fixed timestep, in milliseconds, of a single tick. */
  readonly dtMs: () => number;
  /** Elapsed virtual milliseconds since tick `0` (`tick * dtMs`). */
  readonly elapsedMs: () => number;
  /** Advance by `ticks` (default `1`) and return the new tick. */
  readonly advance: (ticks?: number) => number;
}

export interface FixedClockOptions {
  /** Fixed timestep in milliseconds. Must be a finite, positive number. */
  readonly dtMs: number;
  /** Starting tick (default `0`). */
  readonly startTick?: number;
}

/**
 * Create a virtual, fixed-timestep {@link SimulationClock}. Mirrors the
 * runtime's virtual `DeterministicClock` (no ambient time source); time only
 * moves when `advance` is called.
 */
export const createFixedClock = (options: FixedClockOptions): SimulationClock => {
  const dt = options.dtMs;
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new RangeError('dtMs must be a finite, positive number');
  }
  let currentTick = options.startTick ?? 0;

  return {
    tick: () => currentTick,
    dtMs: () => dt,
    elapsedMs: () => currentTick * dt,
    advance: (ticks = 1) => {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new RangeError('advance ticks must be a non-negative integer');
      }
      currentTick += ticks;
      return currentTick;
    },
  };
};

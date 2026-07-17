import { Schema } from 'effect';

/**
 * Flat delivery: damage is independent of distance (multiplier always `1`).
 */
export class NoFalloff extends Schema.TaggedClass<NoFalloff>()('NoFalloff', {}) {}

/**
 * Linear damage-over-distance: full damage at or below `startDistance`, decaying
 * linearly to `minMultiplier` at `endDistance`, then flat. All three numbers are
 * plugin-supplied tuning — the simulation owns only the *curve shape*, never the
 * values.
 */
export class LinearFalloff extends Schema.TaggedClass<LinearFalloff>()('LinearFalloff', {
  /** Distance up to which damage is unscaled. */
  startDistance: Schema.Number,
  /** Distance at (and beyond) which damage is scaled by `minMultiplier`. */
  endDistance: Schema.Number,
  /** Floor multiplier applied at/after `endDistance` (`0..1`). */
  minMultiplier: Schema.Number,
}) {}

/**
 * Neutral damage-over-distance curve, expressed as serializable *parameters*
 * (the "injected curve" of ADR-0018) rather than an opaque function so it
 * round-trips with the rest of the weapon data. Evaluate with
 * {@link evaluateFalloff}.
 */
export const FalloffSpec = Schema.Union([NoFalloff, LinearFalloff]);
export type FalloffSpec = NoFalloff | LinearFalloff;

/**
 * Distance scale factor for a hit at `distance`. Pure and total: the result is
 * clamped to `[minMultiplier, 1]` and a degenerate `start >= end` window snaps
 * to the floor past the start so callers never divide by zero.
 */
export const evaluateFalloff = (spec: FalloffSpec, distance: number): number => {
  switch (spec._tag) {
    case 'NoFalloff':
      return 1;
    case 'LinearFalloff': {
      const floor = Math.min(1, Math.max(0, spec.minMultiplier));
      if (distance <= spec.startDistance) {
        return 1;
      }
      if (distance >= spec.endDistance) {
        return floor;
      }
      const span = spec.endDistance - spec.startDistance;
      if (span <= 0) {
        return floor;
      }
      const progress = (distance - spec.startDistance) / span;
      return 1 - progress * (1 - floor);
    }
  }
};

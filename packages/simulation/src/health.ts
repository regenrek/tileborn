import { Result, Schema } from 'effect';

/** Raised when a {@link HealthComponent} is constructed with an invalid pool. */
export class InvalidHealthError extends Schema.TaggedErrorClass<InvalidHealthError>()(
  'InvalidHealthError',
  {
    message: Schema.String,
  },
) {}

/**
 * Neutral vitality pool. No team/role coupling, no balance numbers — the engine
 * owns the *shape*; concrete `max` values come from plugin weapon/actor data.
 * Defeat is defined purely as `current <= 0`.
 */
export class HealthComponent extends Schema.Class<HealthComponent>('HealthComponent')({
  current: Schema.Number,
  max: Schema.Number,
}) {
  /** Whether this pool is depleted (the neutral defeat condition). */
  get isDefeated(): boolean {
    return this.current <= 0;
  }

  /** Whether the pool is at (or above) its maximum. */
  get isFull(): boolean {
    return this.current >= this.max;
  }
}

/**
 * Construct a validated {@link HealthComponent}. `max` must be a finite,
 * non-negative number; `current` is clamped into `[0, max]`. Returns a
 * {@link InvalidHealthError} rather than throwing so callers stay total.
 */
export const makeHealth = (
  current: number,
  max: number,
): Result.Result<HealthComponent, InvalidHealthError> => {
  if (!Number.isFinite(max) || max < 0) {
    return Result.fail(
      new InvalidHealthError({ message: `max must be a finite, non-negative number (got ${max})` }),
    );
  }
  if (!Number.isFinite(current)) {
    return Result.fail(
      new InvalidHealthError({ message: `current must be a finite number (got ${current})` }),
    );
  }
  return Result.succeed(new HealthComponent({ current: clamp(current, 0, max), max }));
};

/**
 * Construct a full-health pool of `max` points. Throws on an invalid `max`;
 * intended for trusted, internal spawn paths (tests, adapters).
 */
export const fullHealth = (max: number): HealthComponent => {
  if (!Number.isFinite(max) || max < 0) {
    throw new RangeError(`max must be a finite, non-negative number (got ${max})`);
  }
  return new HealthComponent({ current: max, max });
};

/**
 * Apply a raw damage amount to a health pool, returning a new pool. Pure and
 * total: negative/`NaN` amounts are guarded to `0` (damage never heals), and
 * the result is clamped to `[0, max]` so overkill settles at exactly `0`.
 */
export const applyDamageToHealth = (health: HealthComponent, amount: number): HealthComponent => {
  const damage = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return new HealthComponent({
    current: clamp(health.current - damage, 0, health.max),
    max: health.max,
  });
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

import { Option, Result, Schema } from 'effect';

import { WeaponDefinitionId } from './ids.js';

/** Raised when a {@link WeaponDefinition} is constructed with invalid fields. */
export class InvalidWeaponDefinitionError extends Schema.TaggedErrorClass<InvalidWeaponDefinitionError>()(
  'InvalidWeaponDefinitionError',
  {
    message: Schema.String,
  },
) {}

/**
 * Neutral *shape* of a weapon (ADR-0018 weapon firing runtime). It carries the
 * structural firing parameters — per-shot damage handed to the damage core,
 * cooldown cadence, magazine capacity and reload duration — but no balance
 * defaults: every value is supplied by plugin content data. How the shot
 * *reaches* a target (hitscan/projectile/pellet/…) is the `DamageDelivery`
 * family, deferred to Slice 3; this slice owns only the firing cadence.
 */
export class WeaponDefinition extends Schema.Class<WeaponDefinition>('WeaponDefinition')({
  id: WeaponDefinitionId,
  /** Damage one shot contributes; handed to `resolveDamage` by the caller. */
  damage: Schema.Number,
  /** Ticks the weapon is unavailable after firing (`0` = no cooldown). */
  cooldownTicks: Schema.Int,
  /** Rounds a full magazine holds (`>= 1`). */
  magazineSize: Schema.Int,
  /** Ticks a reload takes before loaded rounds enter the magazine (`0` = instant). */
  reloadTicks: Schema.Int,
}) {}

/**
 * Construct a validated {@link WeaponDefinition}. Enforces only *structural*
 * validity (non-negative integer timers, a non-empty magazine, finite
 * non-negative damage) — never balance ranges. Returns an
 * {@link InvalidWeaponDefinitionError} rather than throwing so callers stay total.
 */
export const makeWeaponDefinition = (fields: {
  readonly id: WeaponDefinitionId;
  readonly damage: number;
  readonly cooldownTicks: number;
  readonly magazineSize: number;
  readonly reloadTicks: number;
}): Result.Result<WeaponDefinition, InvalidWeaponDefinitionError> => {
  const fail = (message: string): Result.Result<WeaponDefinition, InvalidWeaponDefinitionError> =>
    Result.fail(new InvalidWeaponDefinitionError({ message }));

  if (!Number.isFinite(fields.damage) || fields.damage < 0) {
    return fail(`damage must be a finite, non-negative number (got ${fields.damage})`);
  }
  if (!Number.isInteger(fields.cooldownTicks) || fields.cooldownTicks < 0) {
    return fail(`cooldownTicks must be a non-negative integer (got ${fields.cooldownTicks})`);
  }
  if (!Number.isInteger(fields.magazineSize) || fields.magazineSize < 1) {
    return fail(`magazineSize must be an integer >= 1 (got ${fields.magazineSize})`);
  }
  if (!Number.isInteger(fields.reloadTicks) || fields.reloadTicks < 0) {
    return fail(`reloadTicks must be a non-negative integer (got ${fields.reloadTicks})`);
  }

  return Result.succeed(new WeaponDefinition(fields));
};

/**
 * Per-weapon firing state held in a neutral component and advanced once per
 * fixed simulation tick (see {@link advanceWeaponTick}). `reloadAmount` is the
 * number of rounds in flight for the active reload; the *reserve* those rounds
 * were pulled from is owned by the inventory system (ADR-0018 non-goal) — combat
 * only reports how many it consumed.
 */
export class WeaponState extends Schema.Class<WeaponState>('WeaponState')({
  /** Rounds currently chambered and available to fire. */
  ammoInMagazine: Schema.Int,
  /** Ticks remaining before the weapon may fire again (`0` = ready). */
  cooldownRemaining: Schema.Int,
  /** Ticks remaining on the active reload (`0` = not reloading). */
  reloadRemaining: Schema.Int,
  /** Rounds that will enter the magazine when the active reload completes. */
  reloadAmount: Schema.Int,
}) {
  /** Whether a reload is in progress. */
  get isReloading(): boolean {
    return this.reloadRemaining > 0;
  }

  /** Whether the weapon may fire this tick (loaded, off-cooldown, not reloading). */
  get isReady(): boolean {
    return this.cooldownRemaining <= 0 && this.reloadRemaining <= 0 && this.ammoInMagazine > 0;
  }
}

/**
 * Initial state for a freshly equipped weapon: a full magazine, ready to fire.
 * Magazine capacity comes from the definition, so no balance number is baked in.
 */
export const initialWeaponState = (definition: WeaponDefinition): WeaponState =>
  new WeaponState({
    ammoInMagazine: definition.magazineSize,
    cooldownRemaining: 0,
    reloadRemaining: 0,
    reloadAmount: 0,
  });

/** A shot was fired; `damage` is handed to the damage core by the caller. */
export class WeaponFired extends Schema.TaggedClass<WeaponFired>()('WeaponFired', {
  weapon: WeaponDefinitionId,
  damage: Schema.Number,
  ammoRemaining: Schema.Int,
}) {}

/** Fire was declined: the weapon is still on its post-shot cooldown. */
export class WeaponOnCooldown extends Schema.TaggedClass<WeaponOnCooldown>()('WeaponOnCooldown', {
  weapon: WeaponDefinitionId,
  cooldownRemaining: Schema.Int,
}) {}

/** Fire was declined: a reload is in progress. */
export class WeaponReloading extends Schema.TaggedClass<WeaponReloading>()('WeaponReloading', {
  weapon: WeaponDefinitionId,
  reloadRemaining: Schema.Int,
}) {}

/** Fire was declined: the magazine is empty (the caller should reload). */
export class WeaponOutOfAmmo extends Schema.TaggedClass<WeaponOutOfAmmo>()('WeaponOutOfAmmo', {
  weapon: WeaponDefinitionId,
}) {}

/** Neutral result variants produced by {@link fireWeapon}. */
export const WeaponFireOutcome = Schema.Union([
  WeaponFired,
  WeaponOnCooldown,
  WeaponReloading,
  WeaponOutOfAmmo,
]);
export type WeaponFireOutcome = WeaponFired | WeaponOnCooldown | WeaponReloading | WeaponOutOfAmmo;

/** New {@link WeaponState} plus the neutral result value of a fire attempt. */
export interface WeaponFireResult {
  readonly state: WeaponState;
  readonly outcome: WeaponFireOutcome;
}

/**
 * Attempt to fire a weapon. Pure and total: gating (reloading → cooldown →
 * empty magazine) is checked in priority order and a declined attempt returns
 * the *unchanged* state with the reason. A successful shot consumes one round
 * and re-arms the post-shot cooldown from the definition.
 */
export const fireWeapon = (definition: WeaponDefinition, state: WeaponState): WeaponFireResult => {
  if (state.reloadRemaining > 0) {
    return {
      state,
      outcome: new WeaponReloading({
        weapon: definition.id,
        reloadRemaining: state.reloadRemaining,
      }),
    };
  }
  if (state.cooldownRemaining > 0) {
    return {
      state,
      outcome: new WeaponOnCooldown({
        weapon: definition.id,
        cooldownRemaining: state.cooldownRemaining,
      }),
    };
  }
  if (state.ammoInMagazine <= 0) {
    return { state, outcome: new WeaponOutOfAmmo({ weapon: definition.id }) };
  }

  const ammoRemaining = state.ammoInMagazine - 1;
  return {
    state: new WeaponState({
      ammoInMagazine: ammoRemaining,
      cooldownRemaining: definition.cooldownTicks,
      reloadRemaining: 0,
      reloadAmount: 0,
    }),
    outcome: new WeaponFired({
      weapon: definition.id,
      damage: definition.damage,
      ammoRemaining,
    }),
  };
};

/** A reload finished and loaded rounds entered the magazine (the neutral completion result). */
export class ReloadCompleted extends Schema.TaggedClass<ReloadCompleted>()('ReloadCompleted', {
  weapon: WeaponDefinitionId,
  ammoLoaded: Schema.Int,
  ammoRemaining: Schema.Int,
}) {}

/** New {@link WeaponState} plus an optional {@link ReloadCompleted} for this tick. */
export interface WeaponTickResult {
  readonly state: WeaponState;
  readonly outcome: Option.Option<ReloadCompleted>;
}

/**
 * Advance a weapon's timers by `ticks` (default `1`), the way the runtime drives
 * it once per {@link SimulationClock} tick. Cooldown decays toward `0`; when an
 * active reload reaches `0` its `reloadAmount` rounds enter the magazine and a
 * {@link ReloadCompleted} is emitted. Purely deterministic — no entropy source.
 */
export const advanceWeaponTick = (
  definition: WeaponDefinition,
  state: WeaponState,
  ticks = 1,
): WeaponTickResult => {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('advanceWeaponTick ticks must be a non-negative integer');
  }

  const cooldownRemaining = Math.max(0, state.cooldownRemaining - ticks);

  if (state.reloadRemaining <= 0) {
    if (cooldownRemaining === state.cooldownRemaining) {
      return { state, outcome: Option.none() };
    }
    return {
      state: new WeaponState({
        ammoInMagazine: state.ammoInMagazine,
        cooldownRemaining,
        reloadRemaining: 0,
        reloadAmount: 0,
      }),
      outcome: Option.none(),
    };
  }

  const reloadRemaining = state.reloadRemaining - ticks;
  if (reloadRemaining > 0) {
    return {
      state: new WeaponState({
        ammoInMagazine: state.ammoInMagazine,
        cooldownRemaining,
        reloadRemaining,
        reloadAmount: state.reloadAmount,
      }),
      outcome: Option.none(),
    };
  }

  const ammoRemaining = state.ammoInMagazine + state.reloadAmount;
  return {
    state: new WeaponState({
      ammoInMagazine: ammoRemaining,
      cooldownRemaining,
      reloadRemaining: 0,
      reloadAmount: 0,
    }),
    outcome: Option.some(
      new ReloadCompleted({
        weapon: definition.id,
        ammoLoaded: state.reloadAmount,
        ammoRemaining,
      }),
    ),
  };
};

/** Why {@link beginReload} declined to start a reload. */
export const ReloadIgnoredReason = Schema.Literals([
  'already-full',
  'already-reloading',
  'no-reserve',
]);
export type ReloadIgnoredReason = typeof ReloadIgnoredReason.Type;

/** A reload was started; rounds load when {@link advanceWeaponTick} runs the timer down. */
export class ReloadStarted extends Schema.TaggedClass<ReloadStarted>()('ReloadStarted', {
  weapon: WeaponDefinitionId,
  reloadRemaining: Schema.Int,
}) {}

/** No reload was started (magazine full, already reloading, or no reserve). */
export class ReloadIgnored extends Schema.TaggedClass<ReloadIgnored>()('ReloadIgnored', {
  weapon: WeaponDefinitionId,
  reason: ReloadIgnoredReason,
}) {}

/** Neutral result variants produced by {@link beginReload}. */
export const ReloadOutcome = Schema.Union([ReloadStarted, ReloadCompleted, ReloadIgnored]);
export type ReloadOutcome = ReloadStarted | ReloadCompleted | ReloadIgnored;

/**
 * New {@link WeaponState} plus the reload result and the number of rounds pulled
 * from the inventory-owned reserve, so the caller can decrement its own counter.
 */
export interface WeaponReloadResult {
  readonly state: WeaponState;
  readonly outcome: ReloadOutcome;
  readonly ammoLoaded: number;
}

/**
 * Begin (or, for a zero-tick weapon, instantly complete) a reload. The reserve
 * is owned by the inventory system (ADR-0018 non-goal); combat only computes how
 * many rounds it would consume (`min(magazine deficit, reserve)`) and reports it
 * as `ammoLoaded`. Returns `ammoLoaded: 0` whenever no rounds are taken.
 */
export const beginReload = (
  definition: WeaponDefinition,
  state: WeaponState,
  reserveAvailable: number,
): WeaponReloadResult => {
  const ignored = (reason: ReloadIgnoredReason): WeaponReloadResult => ({
    state,
    outcome: new ReloadIgnored({ weapon: definition.id, reason }),
    ammoLoaded: 0,
  });

  if (state.reloadRemaining > 0) {
    return ignored('already-reloading');
  }
  if (state.ammoInMagazine >= definition.magazineSize) {
    return ignored('already-full');
  }

  const deficit = definition.magazineSize - state.ammoInMagazine;
  const reserve = Number.isFinite(reserveAvailable) ? Math.max(0, Math.floor(reserveAvailable)) : 0;
  const loaded = Math.min(deficit, reserve);
  if (loaded <= 0) {
    return ignored('no-reserve');
  }

  if (definition.reloadTicks <= 0) {
    const ammoRemaining = state.ammoInMagazine + loaded;
    return {
      state: new WeaponState({
        ammoInMagazine: ammoRemaining,
        cooldownRemaining: state.cooldownRemaining,
        reloadRemaining: 0,
        reloadAmount: 0,
      }),
      outcome: new ReloadCompleted({ weapon: definition.id, ammoLoaded: loaded, ammoRemaining }),
      ammoLoaded: loaded,
    };
  }

  return {
    state: new WeaponState({
      ammoInMagazine: state.ammoInMagazine,
      cooldownRemaining: state.cooldownRemaining,
      reloadRemaining: definition.reloadTicks,
      reloadAmount: loaded,
    }),
    outcome: new ReloadStarted({ weapon: definition.id, reloadRemaining: definition.reloadTicks }),
    ammoLoaded: loaded,
  };
};

import { Option, Result, Schema } from 'effect';

import { applyDamageToEntity, type CombatWorldView } from './world.js';
import type { DamageOutcome, DamageSource } from './damage.js';
import { evaluateFalloff, FalloffSpec } from './falloff.js';
import {
  addVec,
  distance,
  normalizeVec,
  pointToSegmentDistance,
  rayHitDistance,
  reflectVec,
  rotateVec,
  scaleVec,
  segmentAabbEntry,
  segmentIntersectsAabb,
  subVec,
  vecLength,
  Vec2,
  type Vec2Like,
} from './geometry.js';
import type { HitResolutionPolicy } from './hit-policy.js';
import { CombatEntityId } from './ids.js';
import type { SeededRng } from './rng.js';

// ---------------------------------------------------------------------------
// Cross-cutting outputs
// ---------------------------------------------------------------------------

/**
 * Knockback impulse a hit imparts on a target — a neutral *output value*. The
 * simulation owns no velocity component (only positions), so it reports the
 * impulse the plugin should apply; magnitude is the delivery's `knockback`
 * tuning along the hit direction.
 */
export class KnockbackImpulse extends Schema.Class<KnockbackImpulse>('KnockbackImpulse')({
  target: CombatEntityId,
  x: Schema.Number,
  y: Schema.Number,
}) {}

// ---------------------------------------------------------------------------
// Damage delivery families (tagged union)
// ---------------------------------------------------------------------------

/** Instant, line-of-sight-gated ray; damages the nearest target it reaches. */
export class HitscanDelivery extends Schema.TaggedClass<HitscanDelivery>()('HitscanDelivery', {
  damage: Schema.Number,
  range: Schema.Number,
  /** How close to the ray a target's center must be to register a hit. */
  hitRadius: Schema.Number,
  falloff: FalloffSpec,
  /** Impulse magnitude imparted along the hit direction (`0` = none). */
  knockback: Schema.Number,
}) {}

/**
 * Sustained beam re-applied each tick. Resolution matches a hitscan ray (nearest
 * line-of-sight target); the *continuous* per-tick cadence is the caller's.
 */
export class BeamDelivery extends Schema.TaggedClass<BeamDelivery>()('BeamDelivery', {
  damage: Schema.Number,
  range: Schema.Number,
  hitRadius: Schema.Number,
  falloff: FalloffSpec,
  knockback: Schema.Number,
}) {}

/** Travelling shot integrated forward up to `ttlTicks`; swept against targets. */
export class ProjectileDelivery extends Schema.TaggedClass<ProjectileDelivery>()(
  'ProjectileDelivery',
  {
    damage: Schema.Number,
    /** World units travelled per tick. */
    speed: Schema.Number,
    /** Maximum lifetime in ticks before the shot expires. */
    ttlTicks: Schema.Int,
    /** Collision radius swept along the flight path. */
    radius: Schema.Number,
    falloff: FalloffSpec,
    knockback: Schema.Number,
  },
) {}

/** Multi-sample spread: `pelletCount` rays jittered within `spread` (radians). */
export class PelletDelivery extends Schema.TaggedClass<PelletDelivery>()('PelletDelivery', {
  /** Damage per pellet that connects. */
  damage: Schema.Number,
  pelletCount: Schema.Int,
  range: Schema.Number,
  hitRadius: Schema.Number,
  /** Full cone width in radians; each pellet samples within `±spread/2`. */
  spread: Schema.Number,
  falloff: FalloffSpec,
  knockback: Schema.Number,
}) {}

/** Windup → release: damage scales from `minDamage` to `maxDamage` by charge. */
export class ChargeDelivery extends Schema.TaggedClass<ChargeDelivery>()('ChargeDelivery', {
  minDamage: Schema.Number,
  maxDamage: Schema.Number,
  /** Ticks required to reach full charge. */
  chargeTicks: Schema.Int,
  range: Schema.Number,
  hitRadius: Schema.Number,
  falloff: FalloffSpec,
  knockback: Schema.Number,
}) {}

/** Ray that reflects off blocking geometry up to `maxBounces` times. */
export class BounceDelivery extends Schema.TaggedClass<BounceDelivery>()('BounceDelivery', {
  damage: Schema.Number,
  /** Total path length budget across all bounce segments. */
  range: Schema.Number,
  hitRadius: Schema.Number,
  maxBounces: Schema.Int,
  falloff: FalloffSpec,
  knockback: Schema.Number,
}) {}

/** Ray that penetrates up to `maxTargets` along its path, damaging each. */
export class PierceDelivery extends Schema.TaggedClass<PierceDelivery>()('PierceDelivery', {
  damage: Schema.Number,
  range: Schema.Number,
  hitRadius: Schema.Number,
  maxTargets: Schema.Int,
  falloff: FalloffSpec,
  knockback: Schema.Number,
}) {}

/** Area blast centered on the delivery origin; all targets in `radius` are hit. */
export class ExplosiveDelivery extends Schema.TaggedClass<ExplosiveDelivery>()(
  'ExplosiveDelivery',
  {
    damage: Schema.Number,
    radius: Schema.Number,
    falloff: FalloffSpec,
    knockback: Schema.Number,
    /** When `true`, a target shielded by projectile-blocking geometry is spared. */
    requiresLineOfSight: Schema.Boolean,
  },
) {}

/** Short-range cone/arc swing; hits all targets within `range` and `arc`. */
export class MeleeDelivery extends Schema.TaggedClass<MeleeDelivery>()('MeleeDelivery', {
  damage: Schema.Number,
  range: Schema.Number,
  /** Full arc width in radians around the aim direction. */
  arc: Schema.Number,
  knockback: Schema.Number,
}) {}

/** Neutral tagged-union of *how* a weapon reaches its target(s). */
export const DamageDelivery = Schema.Union([
  HitscanDelivery,
  BeamDelivery,
  ProjectileDelivery,
  PelletDelivery,
  ChargeDelivery,
  BounceDelivery,
  PierceDelivery,
  ExplosiveDelivery,
  MeleeDelivery,
]);
export type DamageDelivery =
  | HitscanDelivery
  | BeamDelivery
  | ProjectileDelivery
  | PelletDelivery
  | ChargeDelivery
  | BounceDelivery
  | PierceDelivery
  | ExplosiveDelivery
  | MeleeDelivery;

// ---------------------------------------------------------------------------
// Structural validation (never balance ranges)
// ---------------------------------------------------------------------------

/** Raised when a {@link DamageDelivery} carries structurally invalid geometry. */
export class InvalidDamageDeliveryError extends Schema.TaggedErrorClass<InvalidDamageDeliveryError>()(
  'InvalidDamageDeliveryError',
  {
    message: Schema.String,
  },
) {}

const isNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const isPositiveInt = (value: number): boolean => Number.isInteger(value) && value >= 1;
const isNonNegativeInt = (value: number): boolean => Number.isInteger(value) && value >= 0;

/**
 * Validate a delivery's *structure* (finite non-negative geometry, sane integer
 * counts, ordered charge bounds) — never balance magnitudes. Returns an
 * {@link InvalidDamageDeliveryError} rather than throwing so callers stay total.
 */
export const validateDamageDelivery = (
  delivery: DamageDelivery,
): Result.Result<DamageDelivery, InvalidDamageDeliveryError> => {
  const fail = (message: string): Result.Result<DamageDelivery, InvalidDamageDeliveryError> =>
    Result.fail(new InvalidDamageDeliveryError({ message }));

  switch (delivery._tag) {
    case 'HitscanDelivery':
    case 'BeamDelivery': {
      if (!isNonNegative(delivery.damage)) return fail('damage must be finite and non-negative');
      if (!isNonNegative(delivery.range)) return fail('range must be finite and non-negative');
      if (!isNonNegative(delivery.hitRadius))
        return fail('hitRadius must be finite and non-negative');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
    case 'ProjectileDelivery': {
      if (!isNonNegative(delivery.damage)) return fail('damage must be finite and non-negative');
      if (!isNonNegative(delivery.speed)) return fail('speed must be finite and non-negative');
      if (!isPositiveInt(delivery.ttlTicks)) return fail('ttlTicks must be an integer >= 1');
      if (!isNonNegative(delivery.radius)) return fail('radius must be finite and non-negative');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
    case 'PelletDelivery': {
      if (!isNonNegative(delivery.damage)) return fail('damage must be finite and non-negative');
      if (!isPositiveInt(delivery.pelletCount)) return fail('pelletCount must be an integer >= 1');
      if (!isNonNegative(delivery.range)) return fail('range must be finite and non-negative');
      if (!isNonNegative(delivery.hitRadius))
        return fail('hitRadius must be finite and non-negative');
      if (!isNonNegative(delivery.spread)) return fail('spread must be finite and non-negative');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
    case 'ChargeDelivery': {
      if (!isNonNegative(delivery.minDamage))
        return fail('minDamage must be finite and non-negative');
      if (!isNonNegative(delivery.maxDamage))
        return fail('maxDamage must be finite and non-negative');
      if (delivery.maxDamage < delivery.minDamage) return fail('maxDamage must be >= minDamage');
      if (!isNonNegativeInt(delivery.chargeTicks))
        return fail('chargeTicks must be a non-negative integer');
      if (!isNonNegative(delivery.range)) return fail('range must be finite and non-negative');
      if (!isNonNegative(delivery.hitRadius))
        return fail('hitRadius must be finite and non-negative');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
    case 'BounceDelivery': {
      if (!isNonNegative(delivery.damage)) return fail('damage must be finite and non-negative');
      if (!isNonNegative(delivery.range)) return fail('range must be finite and non-negative');
      if (!isNonNegative(delivery.hitRadius))
        return fail('hitRadius must be finite and non-negative');
      if (!isNonNegativeInt(delivery.maxBounces))
        return fail('maxBounces must be a non-negative integer');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
    case 'PierceDelivery': {
      if (!isNonNegative(delivery.damage)) return fail('damage must be finite and non-negative');
      if (!isNonNegative(delivery.range)) return fail('range must be finite and non-negative');
      if (!isNonNegative(delivery.hitRadius))
        return fail('hitRadius must be finite and non-negative');
      if (!isPositiveInt(delivery.maxTargets)) return fail('maxTargets must be an integer >= 1');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
    case 'ExplosiveDelivery': {
      if (!isNonNegative(delivery.damage)) return fail('damage must be finite and non-negative');
      if (!isNonNegative(delivery.radius)) return fail('radius must be finite and non-negative');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
    case 'MeleeDelivery': {
      if (!isNonNegative(delivery.damage)) return fail('damage must be finite and non-negative');
      if (!isNonNegative(delivery.range)) return fail('range must be finite and non-negative');
      if (!isNonNegative(delivery.arc)) return fail('arc must be finite and non-negative');
      if (!isNonNegative(delivery.knockback))
        return fail('knockback must be finite and non-negative');
      break;
    }
  }

  return Result.succeed(delivery);
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Per-delivery inputs the resolver reasons over. `origin` is the delivery's
 * spatial source — the muzzle for ray/projectile families and the blast center
 * for {@link ExplosiveDelivery}. `aim` is the (unnormalized) firing direction.
 */
export interface DeliveryContext {
  readonly world: CombatWorldView;
  readonly source: DamageSource;
  readonly origin: Vec2Like;
  readonly aim: Vec2Like;
  readonly policy: HitResolutionPolicy;
  /** Entropy for spread sampling; only consumed by {@link PelletDelivery}. */
  readonly rng: SeededRng;
  /**
   * Ticks the weapon was held; only consumed by {@link ChargeDelivery}.
   * Omitted ⇒ treated as fully charged.
   */
  readonly heldTicks?: number;
}

/** Neutral result of resolving one fired delivery. */
export interface DeliveryResolution {
  /** Per-target damage results produced via Slice 1's `resolveDamage`. */
  readonly outcomes: readonly DamageOutcome[];
  /** Impulses the plugin should apply to hit targets. */
  readonly knockbacks: readonly KnockbackImpulse[];
}

interface MutableResolution {
  readonly outcomes: DamageOutcome[];
  readonly knockbacks: KnockbackImpulse[];
}

interface RayCandidate {
  readonly entity: CombatEntityId;
  readonly position: Vec2;
  readonly along: number;
}

const damageDealt = (outcome: DamageOutcome): boolean =>
  outcome._tag === 'DamageApplied' || outcome._tag === 'EntityDefeated';

/** Apply one hit through Slice 1's resolver, recording outcome + knockback. */
const applyHit = (
  ctx: DeliveryContext,
  out: MutableResolution,
  target: CombatEntityId,
  amount: number,
  hitDirection: Vec2Like,
  knockback: number,
): void => {
  const outcome = applyDamageToEntity(ctx.world, target, amount, ctx.source, ctx.policy);
  out.outcomes.push(outcome);
  if (knockback > 0 && damageDealt(outcome)) {
    const dir = normalizeVec(hitDirection);
    out.knockbacks.push(
      new KnockbackImpulse({ target, x: dir.x * knockback, y: dir.y * knockback }),
    );
  }
};

/** Targets whose center lies within `hitRadius` of a ray, sorted along it. */
const rayCandidates = (
  ctx: DeliveryContext,
  origin: Vec2Like,
  direction: Vec2Like,
  range: number,
  hitRadius: number,
): RayCandidate[] => {
  const candidates: RayCandidate[] = [];
  for (const entity of ctx.world.entities()) {
    const position = ctx.world.getPosition(entity);
    if (Option.isNone(position)) {
      continue;
    }
    const along = rayHitDistance(origin, direction, position.value, range, hitRadius);
    if (Option.isSome(along)) {
      candidates.push({ entity, position: position.value, along: along.value });
    }
  }
  return candidates.sort((a, b) => a.along - b.along || a.entity - b.entity);
};

const projectileBlocked = (ctx: DeliveryContext, from: Vec2Like, to: Vec2Like): boolean => {
  for (const blocker of ctx.world.blockers()) {
    if (blocker.blocksProjectiles && segmentIntersectsAabb(from, to, blocker)) {
      return true;
    }
  }
  return false;
};

/** Shared resolver for the single-target line-of-sight ray families. */
const resolveSingleRay = (
  ctx: DeliveryContext,
  out: MutableResolution,
  damage: number,
  range: number,
  hitRadius: number,
  falloff: FalloffSpec,
  knockback: number,
): void => {
  for (const candidate of rayCandidates(ctx, ctx.origin, ctx.aim, range, hitRadius)) {
    if (projectileBlocked(ctx, ctx.origin, candidate.position)) {
      continue;
    }
    const amount = damage * evaluateFalloff(falloff, candidate.along);
    applyHit(ctx, out, candidate.entity, amount, subVec(candidate.position, ctx.origin), knockback);
    return;
  }
};

const resolvePierce = (ctx: DeliveryContext, out: MutableResolution, d: PierceDelivery): void => {
  let hits = 0;
  for (const candidate of rayCandidates(ctx, ctx.origin, ctx.aim, d.range, d.hitRadius)) {
    if (projectileBlocked(ctx, ctx.origin, candidate.position)) {
      break;
    }
    const amount = d.damage * evaluateFalloff(d.falloff, candidate.along);
    applyHit(
      ctx,
      out,
      candidate.entity,
      amount,
      subVec(candidate.position, ctx.origin),
      d.knockback,
    );
    hits += 1;
    if (hits >= d.maxTargets) {
      break;
    }
  }
};

const resolvePellet = (ctx: DeliveryContext, out: MutableResolution, d: PelletDelivery): void => {
  const aim = normalizeVec(ctx.aim);
  const half = d.spread / 2;
  for (let i = 0; i < d.pelletCount; i += 1) {
    const jitter = (ctx.rng.nextFloat() * 2 - 1) * half;
    const direction = rotateVec(aim, jitter);
    for (const candidate of rayCandidates(ctx, ctx.origin, direction, d.range, d.hitRadius)) {
      if (projectileBlocked(ctx, ctx.origin, candidate.position)) {
        continue;
      }
      const amount = d.damage * evaluateFalloff(d.falloff, candidate.along);
      applyHit(
        ctx,
        out,
        candidate.entity,
        amount,
        subVec(candidate.position, ctx.origin),
        d.knockback,
      );
      break;
    }
  }
};

const chargeProgress = (heldTicks: number | undefined, chargeTicks: number): number => {
  if (heldTicks === undefined || chargeTicks <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, heldTicks / chargeTicks));
};

const resolveCharge = (ctx: DeliveryContext, out: MutableResolution, d: ChargeDelivery): void => {
  const progress = chargeProgress(ctx.heldTicks, d.chargeTicks);
  const damage = d.minDamage + (d.maxDamage - d.minDamage) * progress;
  resolveSingleRay(ctx, out, damage, d.range, d.hitRadius, d.falloff, d.knockback);
};

const resolveProjectile = (
  ctx: DeliveryContext,
  out: MutableResolution,
  d: ProjectileDelivery,
): void => {
  const step = scaleVec(normalizeVec(ctx.aim), d.speed);
  let current: Vec2Like = ctx.origin;
  let travelled = 0;

  for (let tick = 0; tick < d.ttlTicks; tick += 1) {
    const next = addVec(current, step);
    if (projectileBlocked(ctx, current, next)) {
      return;
    }

    let best: RayCandidate | undefined;
    for (const entity of ctx.world.entities()) {
      const position = ctx.world.getPosition(entity);
      if (Option.isNone(position)) {
        continue;
      }
      if (pointToSegmentDistance(position.value, current, next) <= d.radius) {
        const along = travelled + distance(current, position.value);
        if (
          best === undefined ||
          along < best.along ||
          (along === best.along && entity < best.entity)
        ) {
          best = { entity, position: position.value, along };
        }
      }
    }

    if (best !== undefined) {
      const amount = d.damage * evaluateFalloff(d.falloff, best.along);
      applyHit(ctx, out, best.entity, amount, subVec(best.position, ctx.origin), d.knockback);
      return;
    }

    travelled += d.speed;
    current = next;
  }
};

interface BlockerHit {
  readonly t: number;
  readonly normal: Vec2;
}

const nearestBlockerEntry = (
  ctx: DeliveryContext,
  from: Vec2Like,
  to: Vec2Like,
): BlockerHit | undefined => {
  let best: BlockerHit | undefined;
  for (const blocker of ctx.world.blockers()) {
    if (!blocker.blocksProjectiles) {
      continue;
    }
    const entry = segmentAabbEntry(from, to, blocker);
    if (Option.isSome(entry) && (best === undefined || entry.value.t < best.t)) {
      best = entry.value;
    }
  }
  return best;
};

const resolveBounce = (ctx: DeliveryContext, out: MutableResolution, d: BounceDelivery): void => {
  let origin: Vec2Like = ctx.origin;
  let direction = normalizeVec(ctx.aim);
  let remaining = d.range;

  for (let bounce = 0; bounce <= d.maxBounces; bounce += 1) {
    const segmentEnd = addVec(origin, scaleVec(direction, remaining));
    const blocker = nearestBlockerEntry(ctx, origin, segmentEnd);
    const blockerT = blocker?.t ?? Number.POSITIVE_INFINITY;

    for (const candidate of rayCandidates(ctx, origin, direction, remaining, d.hitRadius)) {
      // A target only counts if it is reached before the segment hits a wall.
      if (candidate.along / remaining > blockerT) {
        break;
      }
      const amount = d.damage * evaluateFalloff(d.falloff, candidate.along);
      applyHit(ctx, out, candidate.entity, amount, subVec(candidate.position, origin), d.knockback);
      return;
    }

    if (blocker === undefined) {
      return;
    }

    const hitPoint = addVec(origin, scaleVec(subVec(segmentEnd, origin), blocker.t));
    remaining -= remaining * blocker.t;
    if (remaining <= 0) {
      return;
    }
    // Nudge off the surface so the next segment does not immediately re-hit it.
    direction = normalizeVec(reflectVec(direction, blocker.normal));
    origin = addVec(hitPoint, scaleVec(direction, 1e-6));
  }
};

const resolveExplosive = (
  ctx: DeliveryContext,
  out: MutableResolution,
  d: ExplosiveDelivery,
): void => {
  for (const entity of ctx.world.entities()) {
    const position = ctx.world.getPosition(entity);
    if (Option.isNone(position)) {
      continue;
    }
    const dist = distance(ctx.origin, position.value);
    if (dist > d.radius) {
      continue;
    }
    if (d.requiresLineOfSight && projectileBlocked(ctx, ctx.origin, position.value)) {
      continue;
    }
    const amount = d.damage * evaluateFalloff(d.falloff, dist);
    applyHit(ctx, out, entity, amount, subVec(position.value, ctx.origin), d.knockback);
  }
};

const resolveMelee = (ctx: DeliveryContext, out: MutableResolution, d: MeleeDelivery): void => {
  const aim = normalizeVec(ctx.aim);
  const halfArc = d.arc / 2;
  for (const entity of ctx.world.entities()) {
    const position = ctx.world.getPosition(entity);
    if (Option.isNone(position)) {
      continue;
    }
    const toTarget = subVec(position.value, ctx.origin);
    const dist = vecLength(toTarget);
    if (dist > d.range) {
      continue;
    }
    if (dist > 0) {
      const direction = normalizeVec(toTarget);
      const cos = Math.min(1, Math.max(-1, direction.x * aim.x + direction.y * aim.y));
      if (Math.acos(cos) > halfArc) {
        continue;
      }
    }
    applyHit(ctx, out, entity, d.damage, dist > 0 ? toTarget : aim, d.knockback);
  }
};

/**
 * Resolve one fired delivery into concrete damage application(s) over the
 * {@link CombatWorldView}, feeding Slice 1's `resolveDamage` / `HitResolutionPolicy`
 * and the injected {@link SeededRng}. Pure aside from the `setHealth` writes the
 * damage core performs; deterministic for a fixed world + seed.
 */
export const resolveDelivery = (
  delivery: DamageDelivery,
  ctx: DeliveryContext,
): DeliveryResolution => {
  const out: MutableResolution = { outcomes: [], knockbacks: [] };

  switch (delivery._tag) {
    case 'HitscanDelivery':
    case 'BeamDelivery':
      resolveSingleRay(
        ctx,
        out,
        delivery.damage,
        delivery.range,
        delivery.hitRadius,
        delivery.falloff,
        delivery.knockback,
      );
      break;
    case 'ProjectileDelivery':
      resolveProjectile(ctx, out, delivery);
      break;
    case 'PelletDelivery':
      resolvePellet(ctx, out, delivery);
      break;
    case 'ChargeDelivery':
      resolveCharge(ctx, out, delivery);
      break;
    case 'BounceDelivery':
      resolveBounce(ctx, out, delivery);
      break;
    case 'PierceDelivery':
      resolvePierce(ctx, out, delivery);
      break;
    case 'ExplosiveDelivery':
      resolveExplosive(ctx, out, delivery);
      break;
    case 'MeleeDelivery':
      resolveMelee(ctx, out, delivery);
      break;
  }

  return { outcomes: out.outcomes, knockbacks: out.knockbacks };
};

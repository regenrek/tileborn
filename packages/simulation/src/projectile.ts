import { Option, Schema } from 'effect';

import { type DamageOutcome, type DamageSource } from './damage.js';
import { KnockbackImpulse } from './delivery.js';
import { evaluateFalloff, FalloffSpec } from './falloff.js';
import {
  distance,
  normalizeVec,
  pointToSegmentDistance,
  segmentIntersectsAabb,
  subVec,
  vecLength,
  Vec2,
  type Vec2Like,
} from './geometry.js';
import type { HitResolutionPolicy } from './hit-policy.js';
import { CombatEntityId, ProjectileId, TeamId } from './ids.js';
import { applyDamageToEntity, type CombatWorldView } from './world.js';

// ---------------------------------------------------------------------------
// Persisted in-flight state (Slice 4)
// ---------------------------------------------------------------------------

/**
 * A projectile in flight, persisted across ticks by {@link runCombatTick}.
 * Slice 3 integrated a projectile's entire flight in a single call against a
 * snapshot; Slice 4 instead carries it forward one tick at a time (matching the
 * BR projectile-system this neutralizes: spawn → advance per tick → hit/expire)
 * so the orchestrator can emit the {@link ProjectileSpawned} /
 * {@link ProjectileMoved} / {@link ProjectileExpired} lifecycle. Carries only
 * neutral geometry + the plugin-supplied damage payload — no balance defaults.
 */
export class Projectile extends Schema.Class<Projectile>('Projectile')({
  id: ProjectileId,
  /** The firing entity, recorded so hostility can be re-checked on impact. */
  source: CombatEntityId,
  /** Open team of the source at spawn, or absent. */
  sourceTeam: Schema.optional(TeamId),
  /** Current world position. */
  x: Schema.Number,
  y: Schema.Number,
  /** World units travelled per tick along each axis. */
  vx: Schema.Number,
  vy: Schema.Number,
  /** Ticks of life remaining before the shot expires (`<= 0` ⇒ expired). */
  ttlRemaining: Schema.Int,
  /** Damage one impact deals, before falloff. */
  damage: Schema.Number,
  /** Collision radius swept along the per-tick path. */
  radius: Schema.Number,
  falloff: FalloffSpec,
  /** Impulse magnitude imparted along the impact direction (`0` = none). */
  knockback: Schema.Number,
  /** Distance travelled so far, fed to falloff on impact. */
  travelled: Schema.Number,
}) {}

// ---------------------------------------------------------------------------
// Lifecycle result values
// ---------------------------------------------------------------------------

/** A new projectile entered flight this tick. */
export class ProjectileSpawned extends Schema.TaggedClass<ProjectileSpawned>()(
  'ProjectileSpawned',
  {
    projectile: ProjectileId,
    source: CombatEntityId,
    x: Schema.Number,
    y: Schema.Number,
    vx: Schema.Number,
    vy: Schema.Number,
  },
) {}

/** A projectile advanced to a new position this tick (still in flight). */
export class ProjectileMoved extends Schema.TaggedClass<ProjectileMoved>()('ProjectileMoved', {
  projectile: ProjectileId,
  x: Schema.Number,
  y: Schema.Number,
}) {}

/** Why a projectile left flight. */
export const ProjectileExpiredReason = Schema.Literals(['hit', 'blocked', 'ttl']);
export type ProjectileExpiredReason = typeof ProjectileExpiredReason.Type;

/** A projectile left flight this tick (impact, blocking geometry, or ttl). */
export class ProjectileExpired extends Schema.TaggedClass<ProjectileExpired>()(
  'ProjectileExpired',
  {
    projectile: ProjectileId,
    reason: ProjectileExpiredReason,
    x: Schema.Number,
    y: Schema.Number,
  },
) {}

/** Lifecycle results a single projectile step can produce. */
export type ProjectileLifecycle = ProjectileSpawned | ProjectileMoved | ProjectileExpired;

// ---------------------------------------------------------------------------
// Single-tick advance
// ---------------------------------------------------------------------------

/** Outcome of advancing one projectile by a single tick. */
export interface ProjectileStepResult {
  /** The surviving projectile, or `undefined` if it expired this tick. */
  readonly alive: Projectile | undefined;
  /** Ordered lifecycle + damage results, in emit order. */
  readonly events: readonly (ProjectileMoved | ProjectileExpired | DamageOutcome)[];
  /** Impulses the plugin should apply to a struck target. */
  readonly knockbacks: readonly KnockbackImpulse[];
}

const projectileSource = (projectile: Projectile): DamageSource => ({
  entity: Option.some(projectile.source),
  team: Option.fromUndefinedOr(projectile.sourceTeam),
});

const dealtDamage = (outcome: DamageOutcome): boolean =>
  outcome._tag === 'DamageApplied' || outcome._tag === 'EntityDefeated';

interface SweptHit {
  readonly entity: CombatEntityId;
  readonly position: Vec2;
  readonly along: number;
}

const blockedAlong = (world: CombatWorldView, from: Vec2Like, to: Vec2Like): boolean => {
  for (const blocker of world.blockers()) {
    if (blocker.blocksProjectiles && segmentIntersectsAabb(from, to, blocker)) {
      return true;
    }
  }
  return false;
};

/** Nearest entity swept by the segment `from → to` within `radius`, if any. */
const nearestSweptHit = (
  world: CombatWorldView,
  from: Vec2Like,
  to: Vec2Like,
  radius: number,
  travelled: number,
): SweptHit | undefined => {
  let best: SweptHit | undefined;
  // Narrow to entities near the per-tick segment `from → to` (grown by `radius`)
  // via the world's broadphase when present; the box bounds every point the
  // precise `pointToSegmentDistance` test could accept, so the nearest hit is
  // unchanged. Without an index this is the original `entities()` scan.
  const index = world.broadphase?.();
  const candidates =
    index === undefined
      ? world.entities()
      : index.queryAabb(
          Math.min(from.x, to.x) - radius,
          Math.min(from.y, to.y) - radius,
          Math.max(from.x, to.x) + radius,
          Math.max(from.y, to.y) + radius,
        );
  for (const entity of candidates) {
    const position = world.getPosition(entity);
    if (Option.isNone(position)) {
      continue;
    }
    if (pointToSegmentDistance(position.value, from, to) <= radius) {
      const along = travelled + distance(from, position.value);
      if (
        best === undefined ||
        along < best.along ||
        (along === best.along && entity < best.entity)
      ) {
        best = { entity, position: position.value, along };
      }
    }
  }
  return best;
};

/**
 * Advance one {@link Projectile} by a single tick over the world port, the way
 * {@link runCombatTick} drives it once per {@link SimulationClock} tick. Sweeps
 * the per-tick segment against blocking geometry first, then the nearest entity;
 * on impact it applies damage through Slice 1's `applyDamageToEntity` (reusing
 * the {@link HitResolutionPolicy}) and expires. Pure aside from the `setHealth`
 * write the damage core performs; deterministic for a fixed world.
 */
export const advanceProjectile = (
  world: CombatWorldView,
  projectile: Projectile,
  policy: HitResolutionPolicy,
): ProjectileStepResult => {
  const from: Vec2Like = { x: projectile.x, y: projectile.y };
  const to: Vec2Like = { x: projectile.x + projectile.vx, y: projectile.y + projectile.vy };

  if (blockedAlong(world, from, to)) {
    return {
      alive: undefined,
      events: [
        new ProjectileExpired({ projectile: projectile.id, reason: 'blocked', x: to.x, y: to.y }),
      ],
      knockbacks: [],
    };
  }

  const hit = nearestSweptHit(world, from, to, projectile.radius, projectile.travelled);
  if (hit !== undefined) {
    const events: (ProjectileMoved | ProjectileExpired | DamageOutcome)[] = [];
    const knockbacks: KnockbackImpulse[] = [];
    const amount = projectile.damage * evaluateFalloff(projectile.falloff, hit.along);
    const outcome = applyDamageToEntity(
      world,
      hit.entity,
      amount,
      projectileSource(projectile),
      policy,
    );
    events.push(outcome);
    if (projectile.knockback > 0 && dealtDamage(outcome)) {
      const dir = normalizeVec(subVec(hit.position, from));
      knockbacks.push(
        new KnockbackImpulse({
          target: hit.entity,
          x: dir.x * projectile.knockback,
          y: dir.y * projectile.knockback,
        }),
      );
    }
    events.push(
      new ProjectileExpired({
        projectile: projectile.id,
        reason: 'hit',
        x: hit.position.x,
        y: hit.position.y,
      }),
    );
    return { alive: undefined, events, knockbacks };
  }

  const ttlRemaining = projectile.ttlRemaining - 1;
  const travelled = projectile.travelled + vecLength({ x: projectile.vx, y: projectile.vy });
  const moved = new ProjectileMoved({ projectile: projectile.id, x: to.x, y: to.y });

  if (ttlRemaining <= 0) {
    return {
      alive: undefined,
      events: [
        moved,
        new ProjectileExpired({ projectile: projectile.id, reason: 'ttl', x: to.x, y: to.y }),
      ],
      knockbacks: [],
    };
  }

  return {
    alive: new Projectile({
      id: projectile.id,
      source: projectile.source,
      sourceTeam: projectile.sourceTeam,
      x: to.x,
      y: to.y,
      vx: projectile.vx,
      vy: projectile.vy,
      ttlRemaining,
      damage: projectile.damage,
      radius: projectile.radius,
      falloff: projectile.falloff,
      knockback: projectile.knockback,
      travelled,
    }),
    events: [moved],
    knockbacks: [],
  };
};

import { Option } from 'effect';

import {
  createUniformGridBroadphase,
  type BroadphaseEntry,
  type CombatBroadphase,
} from './broadphase.js';
import { DamageIgnored, resolveDamage, type DamageOutcome, type DamageSource } from './damage.js';
import type { CombatBlocker, Vec2 } from './geometry.js';
import type { HealthComponent } from './health.js';
import type { HitResolutionPolicy } from './hit-policy.js';
import { type CombatEntityId, type TeamId } from './ids.js';

/**
 * Minimal neutral world port the combat systems read/write through, mirroring
 * the runtime's `PluginWorld` abstraction. Slice 1 exposed the vitality + team
 * surface for damage resolution; Slice 3 (delivery families) extends it with the
 * spatial reads its resolvers need — entity positions and the blocking geometry
 * for line-of-sight / projectile blocking. Implementors must enumerate entities
 * in a stable order so replays are deterministic.
 */
export interface CombatWorldView {
  /** All combat entities, in a stable iteration order. */
  readonly entities: () => Iterable<CombatEntityId>;
  /** Current vitality of an entity, or `None` if it has no health pool. */
  readonly getHealth: (entity: CombatEntityId) => Option.Option<HealthComponent>;
  /** Replace an entity's vitality pool. */
  readonly setHealth: (entity: CombatEntityId, health: HealthComponent) => void;
  /** Open team identity of an entity, or `None`. */
  readonly getTeam: (entity: CombatEntityId) => Option.Option<TeamId>;
  /** World-space position of an entity, or `None` if it is not placed. */
  readonly getPosition: (entity: CombatEntityId) => Option.Option<Vec2>;
  /**
   * Blocking geometry for line-of-sight and projectile/beam blocking, derived by
   * the runtime/plugin from catalog `CollisionFootprintComponent`s. Stable order.
   */
  readonly blockers: () => Iterable<CombatBlocker>;
  /**
   * Optional deterministic spatial index over positioned entities. When present,
   * delivery resolvers query it to narrow candidates near a point/segment/box
   * before the precise geometry test, instead of scanning every entity. It must
   * return a *superset* of the entities `entities()` would yield for the region,
   * in ascending id order — so results are byte-for-byte identical to the scan.
   * Absent ⇒ resolvers fall back to the brute-force `entities()` scan (the
   * semantic reference); an adapter need not implement it.
   */
  readonly broadphase?: () => CombatBroadphase;
}

/**
 * Resolve damage against an entity held in a {@link CombatWorldView}, writing
 * the new health back through the port. Missing targets yield a
 * {@link DamageIgnored} `no-op`. Pure aside from the single `setHealth` write.
 */
export const applyDamageToEntity = (
  world: CombatWorldView,
  target: CombatEntityId,
  amount: number,
  source: DamageSource,
  policy: HitResolutionPolicy,
): DamageOutcome => {
  const health = world.getHealth(target);
  if (Option.isNone(health)) {
    return new DamageIgnored({ target, reason: 'no-op' });
  }

  const resolution = resolveDamage(
    { entity: target, team: world.getTeam(target), health: health.value },
    amount,
    source,
    policy,
  );

  if (resolution.health !== health.value) {
    world.setHealth(target, resolution.health);
  }
  return resolution.outcome;
};

/** Seed entry for {@link createInMemoryCombatWorld}. */
export interface CombatActorSeed {
  readonly entity: CombatEntityId;
  readonly health: HealthComponent;
  readonly team?: TeamId;
  readonly position?: Vec2;
}

/**
 * In-memory {@link CombatWorldView} backed by `Map`s. A neutral reference
 * adapter for tests and headless simulation; iterates entities in ascending id
 * order for determinism. `blockers` is fixed at construction time (the reference
 * adapter has no dynamic geometry).
 */
export const createInMemoryCombatWorld = (
  seed: readonly CombatActorSeed[] = [],
  blockers: readonly CombatBlocker[] = [],
): CombatWorldView => {
  const healthByEntity = new Map<CombatEntityId, HealthComponent>();
  const teamByEntity = new Map<CombatEntityId, TeamId>();
  const positionByEntity = new Map<CombatEntityId, Vec2>();

  for (const actor of seed) {
    healthByEntity.set(actor.entity, actor.health);
    if (actor.team !== undefined) {
      teamByEntity.set(actor.entity, actor.team);
    }
    if (actor.position !== undefined) {
      positionByEntity.set(actor.entity, actor.position);
    }
  }

  // The index is built lazily and memoized: positions are fixed at construction
  // (this reference adapter never moves an entity), and only the entities that
  // appear in `entities()` *and* carry a position are candidates — matching the
  // brute-force scan, which skipped position-less entities via `getPosition`.
  let index: CombatBroadphase | undefined;
  const broadphase = (): CombatBroadphase => {
    if (index === undefined) {
      const entries: BroadphaseEntry[] = [];
      for (const entity of healthByEntity.keys()) {
        const position = positionByEntity.get(entity);
        if (position !== undefined) {
          entries.push({ entity, position });
        }
      }
      index = createUniformGridBroadphase(entries);
    }
    return index;
  };

  return {
    entities: () => [...healthByEntity.keys()].sort((a, b) => a - b),
    getHealth: (entity) => Option.fromUndefinedOr(healthByEntity.get(entity)),
    setHealth: (entity, health) => {
      healthByEntity.set(entity, health);
    },
    getTeam: (entity) => Option.fromUndefinedOr(teamByEntity.get(entity)),
    getPosition: (entity) => Option.fromUndefinedOr(positionByEntity.get(entity)),
    blockers: () => blockers,
    broadphase,
  };
};

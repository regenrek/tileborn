import { Option } from 'effect';

import { DamageIgnored, resolveDamage, type DamageOutcome, type DamageSource } from './damage.js';
import type { HealthComponent } from './health.js';
import type { HitResolutionPolicy } from './hit-policy.js';
import { type CombatEntityId, type TeamId } from './ids.js';

/**
 * Minimal neutral world port the combat systems read/write through, mirroring
 * the runtime's `PluginWorld` abstraction. Slice 1 exposes only the vitality +
 * team surface needed for damage resolution; later slices (projectile/LOS)
 * extend it with positions and spawn/destroy. Implementors must enumerate
 * entities in a stable order so replays are deterministic.
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
}

/**
 * In-memory {@link CombatWorldView} backed by `Map`s. A neutral reference
 * adapter for tests and headless simulation; iterates entities in ascending id
 * order for determinism.
 */
export const createInMemoryCombatWorld = (
  seed: readonly CombatActorSeed[] = [],
): CombatWorldView => {
  const healthByEntity = new Map<CombatEntityId, HealthComponent>();
  const teamByEntity = new Map<CombatEntityId, TeamId>();

  for (const actor of seed) {
    healthByEntity.set(actor.entity, actor.health);
    if (actor.team !== undefined) {
      teamByEntity.set(actor.entity, actor.team);
    }
  }

  return {
    entities: () => [...healthByEntity.keys()].sort((a, b) => a - b),
    getHealth: (entity) => Option.fromUndefinedOr(healthByEntity.get(entity)),
    setHealth: (entity, health) => {
      healthByEntity.set(entity, health);
    },
    getTeam: (entity) => Option.fromUndefinedOr(teamByEntity.get(entity)),
  };
};

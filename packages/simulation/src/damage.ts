import { Option, Schema } from 'effect';

import { applyDamageToHealth, type HealthComponent } from './health.js';
import type { HitContext, HitResolutionPolicy } from './hit-policy.js';
import { CombatEntityId, type TeamId } from './ids.js';

/** The entity a hit is resolved against, with its current vitality pool. */
export interface DamageTarget {
  readonly entity: CombatEntityId;
  readonly team: Option.Option<TeamId>;
  readonly health: HealthComponent;
}

/**
 * The origin of a hit. `entity` is `None` for environmental/non-entity damage
 * (hazards, world effects); team is open and may be absent.
 */
export interface DamageSource {
  readonly entity: Option.Option<CombatEntityId>;
  readonly team: Option.Option<TeamId>;
}

/** Ergonomic constructor for an entity-originated damage source. */
export const entitySource = (entity: CombatEntityId, team?: TeamId): DamageSource => ({
  entity: Option.some(entity),
  team: Option.fromUndefinedOr(team),
});

/** Ergonomic constructor for environmental (non-entity) damage. */
export const environmentSource = (team?: TeamId): DamageSource => ({
  entity: Option.none(),
  team: Option.fromUndefinedOr(team),
});

/** Why {@link resolveDamage} declined to apply damage. */
export const DamageIgnoredReason = Schema.Literals(['not-hostile', 'already-defeated', 'no-op']);
export type DamageIgnoredReason = typeof DamageIgnoredReason.Type;

/** A hit reduced the target's health but did not defeat it. */
export class DamageApplied extends Schema.TaggedClass<DamageApplied>()('DamageApplied', {
  target: CombatEntityId,
  amount: Schema.Number,
  healthBefore: Schema.Number,
  healthAfter: Schema.Number,
}) {}

/** A hit reduced the target's health to `<= 0` (the neutral defeat result). */
export class EntityDefeated extends Schema.TaggedClass<EntityDefeated>()('EntityDefeated', {
  target: CombatEntityId,
  amount: Schema.Number,
  healthBefore: Schema.Number,
}) {}

/** No damage was applied (policy declined, already defeated, or zero amount). */
export class DamageIgnored extends Schema.TaggedClass<DamageIgnored>()('DamageIgnored', {
  target: CombatEntityId,
  reason: DamageIgnoredReason,
}) {}

/** Neutral combat result variants produced by {@link resolveDamage}. */
export const DamageOutcome = Schema.Union([DamageApplied, EntityDefeated, DamageIgnored]);
export type DamageOutcome = DamageApplied | EntityDefeated | DamageIgnored;

/** The new health pool plus the neutral result value of a damage resolution. */
export interface DamageResolution {
  readonly health: HealthComponent;
  readonly outcome: DamageOutcome;
}

/**
 * Pure, total damage resolution. Determines hostility via the injected
 * {@link HitResolutionPolicy}, then applies + clamps damage and classifies the
 * result. The target's health is never mutated; the new pool is returned.
 *
 * Edge cases: already-defeated targets, non-hostile hits, and zero/negative
 * amounts all yield {@link DamageIgnored} with the original health unchanged.
 */
export const resolveDamage = (
  target: DamageTarget,
  amount: number,
  source: DamageSource,
  policy: HitResolutionPolicy,
): DamageResolution => {
  const ignored = (reason: DamageIgnoredReason): DamageResolution => ({
    health: target.health,
    outcome: new DamageIgnored({ target: target.entity, reason }),
  });

  if (target.health.isDefeated) {
    return ignored('already-defeated');
  }

  const context: HitContext = {
    source: source.entity,
    sourceTeam: source.team,
    target: target.entity,
    targetTeam: target.team,
  };
  if (!policy.isHostile(context)) {
    return ignored('not-hostile');
  }

  const healthAfter = applyDamageToHealth(target.health, amount);
  const applied = target.health.current - healthAfter.current;
  if (applied <= 0) {
    return ignored('no-op');
  }

  const outcome: DamageOutcome = healthAfter.isDefeated
    ? new EntityDefeated({
        target: target.entity,
        amount: applied,
        healthBefore: target.health.current,
      })
    : new DamageApplied({
        target: target.entity,
        amount: applied,
        healthBefore: target.health.current,
        healthAfter: healthAfter.current,
      });

  return { health: healthAfter, outcome };
};

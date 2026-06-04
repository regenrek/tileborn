import { Option, Schema } from 'effect';

import { excludeFromBroadphase } from './broadphase.js';
import { SimulationClock } from './clock.js';
import {
  DamageApplied,
  DamageIgnored,
  EntityDefeated,
  entitySource,
  type DamageOutcome,
} from './damage.js';
import {
  DamageDelivery,
  KnockbackImpulse,
  resolveDelivery,
  type DeliveryContext,
} from './delivery.js';
import { normalizeVec, type Vec2Like } from './geometry.js';
import type { HitResolutionPolicy } from './hit-policy.js';
import { CombatEntityId, makeProjectileId, StatusEffectId, WeaponDefinitionId } from './ids.js';
import {
  advanceProjectile,
  Projectile,
  ProjectileExpired,
  ProjectileMoved,
  ProjectileSpawned,
} from './projectile.js';
import type { SeededRng } from './rng.js';
import { StatusApplied } from './status.js';
import {
  advanceWeaponTick,
  fireWeapon,
  ReloadCompleted,
  WeaponDefinition,
  WeaponFired,
  WeaponOnCooldown,
  WeaponOutOfAmmo,
  WeaponReloading,
  WeaponState,
} from './weapon.js';
import type { CombatWorldView } from './world.js';

// ---------------------------------------------------------------------------
// Equipped weapons + persisted tick state
// ---------------------------------------------------------------------------

/**
 * A weapon equipped on an entity: its firing cadence (Slice 2
 * {@link WeaponDefinition} + live {@link WeaponState}) paired with *how* it
 * reaches targets (Slice 3 {@link DamageDelivery}). The orchestrator advances
 * the firing state across ticks; the plugin supplies both the definition and the
 * delivery as content data (no balance numbers live here).
 */
export interface EquippedWeapon {
  readonly entity: CombatEntityId;
  readonly definition: WeaponDefinition;
  readonly delivery: DamageDelivery;
  readonly state: WeaponState;
}

/**
 * State {@link runCombatTick} carries forward between ticks: the live firing
 * state of every equipped weapon and the set of in-flight projectiles, plus the
 * monotonically increasing counter used to mint deterministic
 * {@link Projectile} ids. The world port owns health/position; this owns the
 * combat-system state that has no place in the world.
 */
export interface CombatTickState {
  readonly weapons: readonly EquippedWeapon[];
  readonly projectiles: readonly Projectile[];
  readonly nextProjectileId: number;
}

/** A fresh {@link CombatTickState} with no projectiles in flight. */
export const initialCombatTickState = (
  weapons: readonly EquippedWeapon[] = [],
): CombatTickState => ({
  weapons,
  projectiles: [],
  nextProjectileId: 1,
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A request to fire a specific equipped weapon this tick. The runtime/plugin
 * builds these from player/AI input; combat treats them as neutral data.
 */
export interface CombatFireIntent {
  /** The firing entity (must have an {@link EquippedWeapon} for `weapon`). */
  readonly entity: CombatEntityId;
  /** Which of the entity's equipped weapons to fire. */
  readonly weapon: WeaponDefinitionId;
  /** Aim direction (need not be normalized). */
  readonly aim: Vec2Like;
  /** Firing origin; defaults to the entity's world position, then `(0, 0)`. */
  readonly origin?: Vec2Like;
  /** Ticks the weapon was held; only consumed by a charge delivery. */
  readonly heldTicks?: number;
  /** Status effects to apply to each struck target (P0 hook, immediate deliveries). */
  readonly appliesStatus?: readonly StatusEffectId[];
}

/** Everything {@link runCombatTick} needs to resolve a single tick. */
export interface CombatTickInput {
  readonly world: CombatWorldView;
  readonly state: CombatTickState;
  readonly clock: SimulationClock;
  /** The sole entropy source (spread sampling); see {@link SeededRng}. */
  readonly rng: SeededRng;
  readonly policy: HitResolutionPolicy;
  /** Fire requests for this tick; resolved in a deterministic order. */
  readonly intents?: readonly CombatFireIntent[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * The neutral combat result-value set (ADR-0018): every observable thing a tick
 * can produce, as a tagged union. The plugin folds these into its existing
 * snapshot/projector path (ADR-0014) — combat adds no rendering channel.
 */
export type CombatResult =
  | WeaponFired
  | WeaponOnCooldown
  | WeaponReloading
  | WeaponOutOfAmmo
  | ReloadCompleted
  | DamageApplied
  | EntityDefeated
  | DamageIgnored
  | ProjectileSpawned
  | ProjectileMoved
  | ProjectileExpired
  | StatusApplied;

/** Schema view of the {@link CombatResult} union, for wire/replay round-trips. */
export const CombatResult = Schema.Union([
  WeaponFired,
  WeaponOnCooldown,
  WeaponReloading,
  WeaponOutOfAmmo,
  ReloadCompleted,
  DamageApplied,
  EntityDefeated,
  DamageIgnored,
  ProjectileSpawned,
  ProjectileMoved,
  ProjectileExpired,
  StatusApplied,
]);

/** New {@link CombatTickState} plus the ordered results + knockbacks of a tick. */
export interface CombatTickResult {
  readonly state: CombatTickState;
  /** Ordered neutral result values: reloads → fires/immediate hits → projectiles. */
  readonly results: readonly CombatResult[];
  /** Impulses the plugin should apply to struck targets this tick. */
  readonly knockbacks: readonly KnockbackImpulse[];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const weaponKey = (entity: CombatEntityId, weapon: WeaponDefinitionId): string =>
  `${entity}:${weapon}`;

const compareWeapons = (a: EquippedWeapon, b: EquippedWeapon): number => {
  if (a.entity !== b.entity) {
    return a.entity - b.entity;
  }
  if (a.definition.id === b.definition.id) {
    return 0;
  }
  return a.definition.id < b.definition.id ? -1 : 1;
};

const compareIntents = (a: CombatFireIntent, b: CombatFireIntent): number => {
  if (a.entity !== b.entity) {
    return a.entity - b.entity;
  }
  if (a.weapon === b.weapon) {
    return 0;
  }
  return a.weapon < b.weapon ? -1 : 1;
};

const damageDealt = (outcome: DamageOutcome): boolean =>
  outcome._tag === 'DamageApplied' || outcome._tag === 'EntityDefeated';

/**
 * A read-through {@link CombatWorldView} that hides one entity from delivery
 * target enumeration, so a weapon never strikes its own wielder (neutralizing
 * BR's owner-exclusion in `findHitPlayer`). Health/position reads + writes still
 * delegate to the underlying world; only `entities()` is filtered.
 */
const viewExcluding = (world: CombatWorldView, excluded: CombatEntityId): CombatWorldView => {
  // Forward the broadphase too (filtering out the wielder), so spatial delivery
  // resolvers keep their fast candidate path while honouring owner-exclusion;
  // the narrowed set stays identical to a brute-force scan of `entities()`.
  const baseBroadphase = world.broadphase;
  return {
    entities: function* () {
      for (const entity of world.entities()) {
        if (entity !== excluded) {
          yield entity;
        }
      }
    },
    getHealth: world.getHealth,
    setHealth: world.setHealth,
    getTeam: world.getTeam,
    getPosition: world.getPosition,
    blockers: world.blockers,
    ...(baseBroadphase === undefined
      ? {}
      : { broadphase: () => excludeFromBroadphase(baseBroadphase(), excluded) }),
  };
};

/**
 * Pure, deterministic single-tick combat orchestrator over a
 * {@link CombatWorldView} (ADR-0018 Slice 4). It wires the slices together with
 * a stable, replay-safe ordering:
 *
 * 1. Advance every equipped weapon's timers (Slice 2), emitting any
 *    {@link ReloadCompleted}.
 * 2. Resolve fire intents (sorted by entity then weapon): {@link fireWeapon}
 *    (Slice 2) gates the shot; a connecting non-projectile delivery is resolved
 *    immediately via {@link resolveDelivery} (Slice 3) feeding Slice 1's damage
 *    core, while a projectile delivery spawns a persisted {@link Projectile}.
 *    Declared status effects are emitted as {@link StatusApplied} for struck
 *    targets (immediate deliveries).
 * 3. Advance in-flight projectiles by one tick (sorted by id), emitting the
 *    {@link ProjectileMoved}/{@link ProjectileExpired} lifecycle + impact damage.
 * 4. Advance the {@link SimulationClock} by one tick.
 *
 * Health/position writes go through the world port (the established
 * `applyDamageToEntity`/`resolveDelivery` precedent); the returned
 * {@link CombatTickState} carries the weapon + projectile state the caller
 * threads into the next tick. The only entropy source is the injected
 * {@link SeededRng}, so a fixed seed + input log replays bit-identically.
 */
export const runCombatTick = (input: CombatTickInput): CombatTickResult => {
  const { world, state, clock, rng, policy } = input;
  const results: CombatResult[] = [];
  const knockbacks: KnockbackImpulse[] = [];

  const weapons = new Map<string, EquippedWeapon>();
  for (const equipped of [...state.weapons].sort(compareWeapons)) {
    weapons.set(weaponKey(equipped.entity, equipped.definition.id), equipped);
  }

  // Phase 1 — advance weapon timers (reload completion / cooldown decay).
  for (const key of [...weapons.keys()]) {
    const equipped = weapons.get(key)!;
    const tick = advanceWeaponTick(equipped.definition, equipped.state, 1);
    if (Option.isSome(tick.outcome)) {
      results.push(tick.outcome.value);
    }
    weapons.set(key, { ...equipped, state: tick.state });
  }

  // Phase 2 — resolve fire intents.
  const spawnedProjectiles: Projectile[] = [];
  let nextProjectileId = state.nextProjectileId;

  for (const intent of [...(input.intents ?? [])].sort(compareIntents)) {
    const key = weaponKey(intent.entity, intent.weapon);
    const equipped = weapons.get(key);
    if (equipped === undefined) {
      continue;
    }

    const fire = fireWeapon(equipped.definition, equipped.state);
    weapons.set(key, { ...equipped, state: fire.state });
    results.push(fire.outcome);
    if (fire.outcome._tag !== 'WeaponFired') {
      continue;
    }

    const origin =
      intent.origin ?? Option.getOrElse(world.getPosition(intent.entity), () => ({ x: 0, y: 0 }));
    const sourceTeam = Option.getOrUndefined(world.getTeam(intent.entity));
    const source = entitySource(intent.entity, sourceTeam);

    if (equipped.delivery._tag === 'ProjectileDelivery') {
      const delivery = equipped.delivery;
      const direction = normalizeVec(intent.aim);
      const id = makeProjectileId(nextProjectileId);
      nextProjectileId += 1;
      const vx = direction.x * delivery.speed;
      const vy = direction.y * delivery.speed;
      spawnedProjectiles.push(
        new Projectile({
          id,
          source: intent.entity,
          sourceTeam,
          x: origin.x,
          y: origin.y,
          vx,
          vy,
          ttlRemaining: delivery.ttlTicks,
          damage: delivery.damage,
          radius: delivery.radius,
          falloff: delivery.falloff,
          knockback: delivery.knockback,
          travelled: 0,
        }),
      );
      results.push(
        new ProjectileSpawned({
          projectile: id,
          source: intent.entity,
          x: origin.x,
          y: origin.y,
          vx,
          vy,
        }),
      );
      continue;
    }

    const ctx: DeliveryContext = {
      world: viewExcluding(world, intent.entity),
      source,
      origin,
      aim: intent.aim,
      policy,
      rng,
      ...(intent.heldTicks === undefined ? {} : { heldTicks: intent.heldTicks }),
    };
    const resolution = resolveDelivery(equipped.delivery, ctx);
    for (const outcome of resolution.outcomes) {
      results.push(outcome);
    }
    for (const impulse of resolution.knockbacks) {
      knockbacks.push(impulse);
    }
    if (intent.appliesStatus !== undefined && intent.appliesStatus.length > 0) {
      for (const outcome of resolution.outcomes) {
        if (!damageDealt(outcome)) {
          continue;
        }
        for (const effect of intent.appliesStatus) {
          results.push(
            new StatusApplied({ target: outcome.target, effect, source: intent.entity }),
          );
        }
      }
    }
  }

  // Phase 3 — advance in-flight projectiles (those that existed before this tick).
  const projectiles: Projectile[] = [];
  for (const projectile of [...state.projectiles].sort((a, b) => a.id - b.id)) {
    const step = advanceProjectile(viewExcluding(world, projectile.source), projectile, policy);
    for (const event of step.events) {
      results.push(event);
    }
    for (const impulse of step.knockbacks) {
      knockbacks.push(impulse);
    }
    if (step.alive !== undefined) {
      projectiles.push(step.alive);
    }
  }
  projectiles.push(...spawnedProjectiles);

  // Phase 4 — advance the clock.
  clock.advance(1);

  return {
    state: {
      weapons: [...weapons.values()].sort(compareWeapons),
      projectiles,
      nextProjectileId,
    },
    results,
    knockbacks,
  };
};

import {
  advanceProjectile,
  advanceWeaponTick,
  applyDamageToEntity,
  createProjectileFromDelivery,
  environmentSource,
  fireWeapon,
  initialWeaponState,
  makeCombatEntityId,
  makeProjectileId,
  makeTeamId,
  WeaponState,
  type CombatEntityId,
  type CombatWorldView,
  type DamageOutcome,
  type EntityDefeated,
  type HitResolutionPolicy,
  type ProjectileDelivery,
  type SeededRng,
  type WeaponDefinition,
} from '@tileborne/simulation';

import type { ExportedArtifact } from '../types/artifact.js';
import type { PluginWorld, RuntimePlayerInput } from '../types/runtime-plugin.js';
import {
  LAST_FACING_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  VELOCITY_COMPONENT,
  type Direction8,
  type LastFacing,
  type Player,
  type Position,
  type Projectile as EcsProjectile,
  type Velocity,
} from './components.js';
import { excludingEntity } from './combat-world-view.js';
import type { DamageSystemState } from './damage-system.js';
import { direction8ToUnitVector } from './movement.js';

/** Axis-aligned bounds a projectile is culled when it fully leaves. */
export interface MapBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const resolveMapBoundsFromArtifact = (artifact: ExportedArtifact): MapBounds => {
  const tileWidth = artifact.collision?.tileWidth ?? 32;
  const tileHeight = artifact.collision?.tileHeight ?? 32;
  const { centerX, centerY, startRadiusTiles } = artifact.shrinkSchedule;
  const radius = startRadiusTiles * Math.max(tileWidth, tileHeight);
  return {
    minX: centerX - radius,
    minY: centerY - radius,
    maxX: centerX + radius,
    maxY: centerY + radius,
  };
};

/**
 * BR-side combat state threaded across ticks: the neutral firing state of each
 * player's weapon, the active weapon slot + per-projectile source metadata the
 * BR snapshot needs, and a flag for one-time component registration. The
 * in-flight projectiles themselves live in the ECS `Projectile` column (the BR
 * snapshot read-model); this carries only the neutral combat-system state with
 * no place in that column.
 */
export interface CombatSystemState {
  readonly weaponStateByPlayerId: Map<string, WeaponState>;
  readonly activeWeaponSlotByPlayerId: Map<string, number>;
  readonly projectileSourceByEntity: Map<number, CombatEntityId>;
  componentsRegistered: boolean;
}

export const createCombatSystemState = (): CombatSystemState => ({
  weaponStateByPlayerId: new Map<string, WeaponState>(),
  activeWeaponSlotByPlayerId: new Map<string, number>(),
  projectileSourceByEntity: new Map<number, CombatEntityId>(),
  componentsRegistered: false,
});

/**
 * Everything the BR combat tick needs to drive the neutral engine. `worldView`
 * is the per-tick {@link CombatWorldView} over the ECS; `weapon`/`delivery` are
 * the resolved BR catalog entry (firing cadence + projectile family); `policy`
 * carries BR's friendly-fire rules; `rng` is the engine's sole entropy source.
 */
export interface CombatSystemContext {
  readonly worldView: CombatWorldView;
  readonly policy: HitResolutionPolicy;
  readonly weapon: WeaponDefinition;
  readonly delivery: ProjectileDelivery;
  readonly rng: SeededRng;
  readonly damageState: DamageSystemState;
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly mapBounds?: MapBounds;
  readonly weaponSlotCount: number;
  /** Projectile own collision radius, used only for the map-bounds cull. */
  readonly projectileBoundsRadius: number;
}

const PROJECTILE_MUZZLE_PADDING = 1;

const registerCombatComponents = (world: PluginWorld): void => {
  world.registerComponent<LastFacing>(LAST_FACING_COMPONENT);
  world.registerComponent<EcsProjectile>(PROJECTILE_COMPONENT);
};

const normalizeVector = (x: number, y: number): { readonly x: number; readonly y: number } => {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 1, y: 0 };
  }
  return { x: x / length, y: y / length };
};

const resolveShootDirection = (
  velocity: Velocity | undefined,
  lastFacing: LastFacing | undefined,
  aimDeg: number | undefined,
): { readonly x: number; readonly y: number } => {
  if (aimDeg !== undefined) {
    const radians = (aimDeg * Math.PI) / 180;
    return normalizeVector(Math.cos(radians), Math.sin(radians));
  }
  if (velocity && (velocity.vx !== 0 || velocity.vy !== 0)) {
    return normalizeVector(velocity.vx, velocity.vy);
  }
  const dir = lastFacing?.dir ?? 0;
  return direction8ToUnitVector(dir);
};

const isValidAimDeg = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= 359;

const isValidDirection8 = (value: number | undefined): value is Direction8 =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= 7;

const isValidWeaponSlot = (slot: number | undefined, slotCount: number): slot is number =>
  slot !== undefined && Number.isInteger(slot) && slot >= 1 && slot <= slotCount;

const isOutsideMapBounds = (
  position: { readonly x: number; readonly y: number },
  bounds: MapBounds | undefined,
  radius: number,
): boolean => {
  if (!bounds) {
    return false;
  }
  return (
    position.x - radius < bounds.minX ||
    position.x + radius > bounds.maxX ||
    position.y - radius < bounds.minY ||
    position.y + radius > bounds.maxY
  );
};

/**
 * Record an entity defeat into the damage-system's pending-kill queue so the
 * existing BR kill/respawn/game-over emission (kept in the plugin) processes it.
 * `killerId` is BR's owner playerId for weapon kills or `"zone"` for the zone.
 */
const recordDefeat = (
  world: PluginWorld,
  state: DamageSystemState,
  victimEntity: number,
  killerId: string,
): void => {
  const player = world.getComponent<Player>(PLAYER_COMPONENT).get(victimEntity);
  if (!player) {
    return;
  }
  state.pendingKills.push({ victimEntity, victimPlayerId: player.playerId, killerId });
};

const isDefeat = (outcome: DamageOutcome): outcome is EntityDefeated =>
  outcome._tag === 'EntityDefeated';

const projectileMuzzleOffset = (delivery: ProjectileDelivery): number =>
  delivery.radius + PROJECTILE_MUZZLE_PADDING;

const projectileOrigin = (
  position: Position,
  direction: { readonly x: number; readonly y: number },
  delivery: ProjectileDelivery,
): Position => {
  const offset = projectileMuzzleOffset(delivery);
  return {
    x: position.x + direction.x * offset,
    y: position.y + direction.y * offset,
  };
};

const ensureWeaponState = (
  ctx: CombatSystemContext,
  state: CombatSystemState,
  playerId: string,
): WeaponState => {
  const existing = state.weaponStateByPlayerId.get(playerId);
  if (existing) {
    return existing;
  }
  const fresh = initialWeaponState(ctx.weapon);
  state.weaponStateByPlayerId.set(playerId, fresh);
  return fresh;
};

/**
 * Advance every tracked weapon's neutral firing timers by one tick and top the
 * magazine back up. BR has no inventory/ammo (ADR-0018 non-goal), so the single
 * round is refilled each tick — cooldown alone gates the firing cadence.
 */
const advanceWeapons = (ctx: CombatSystemContext, state: CombatSystemState): void => {
  for (const [playerId, weaponState] of state.weaponStateByPlayerId) {
    const advanced = advanceWeaponTick(ctx.weapon, weaponState, 1).state;
    const refilled =
      advanced.ammoInMagazine >= ctx.weapon.magazineSize
        ? advanced
        : new WeaponState({
            ammoInMagazine: ctx.weapon.magazineSize,
            cooldownRemaining: advanced.cooldownRemaining,
            reloadRemaining: advanced.reloadRemaining,
            reloadAmount: advanced.reloadAmount,
          });
    state.weaponStateByPlayerId.set(playerId, refilled);
  }
};

const spawnProjectile = (
  world: PluginWorld,
  ctx: CombatSystemContext,
  state: CombatSystemState,
  ownerEntity: number,
  owner: Player,
  position: Position,
  direction: { readonly x: number; readonly y: number },
  weaponSlot: number,
): void => {
  const entity = world.createEntity();
  const origin = projectileOrigin(position, direction, ctx.delivery);
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, origin);
  world.getComponent<EcsProjectile>(PROJECTILE_COMPONENT).set(entity, {
    ownerId: owner.playerId,
    weaponSlot,
    dirX: direction.x,
    dirY: direction.y,
    speed: ctx.delivery.speed,
    damage: ctx.delivery.damage,
    ttlTicks: ctx.delivery.ttlTicks,
  });
  state.projectileSourceByEntity.set(entity, makeCombatEntityId(ownerEntity));
};

const processShootInput = (
  world: PluginWorld,
  ctx: CombatSystemContext,
  state: CombatSystemState,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const velocities = world.getComponent<Velocity>(VELOCITY_COMPONENT);
  const lastFacings = world.getComponent<LastFacing>(LAST_FACING_COMPONENT);

  for (const [entity, player] of players.entries()) {
    if (player.alive !== 1) {
      continue;
    }

    ensureWeaponState(ctx, state, player.playerId);

    const input = ctx.getPlayerInput?.(player.playerId);
    if (!input) {
      continue;
    }

    if (isValidWeaponSlot(input.weaponSlot, ctx.weaponSlotCount)) {
      state.activeWeaponSlotByPlayerId.set(player.playerId, input.weaponSlot);
    }

    if (isValidDirection8(input.dir)) {
      const currentFacing = lastFacings.get(entity);
      if (!currentFacing || currentFacing.dir !== input.dir) {
        lastFacings.set(entity, { dir: input.dir });
      }
    }

    if (!input.shoot) {
      continue;
    }

    const weaponState = state.weaponStateByPlayerId.get(player.playerId)!;
    const fired = fireWeapon(ctx.weapon, weaponState);
    state.weaponStateByPlayerId.set(player.playerId, fired.state);
    if (fired.outcome._tag !== 'WeaponFired') {
      continue;
    }

    const position = positions.get(entity);
    if (!position) {
      continue;
    }

    const direction = resolveShootDirection(
      velocities.get(entity),
      lastFacings.get(entity),
      isValidAimDeg(input.aimDeg) ? input.aimDeg : undefined,
    );
    const weaponSlot = state.activeWeaponSlotByPlayerId.get(player.playerId) ?? 1;
    spawnProjectile(world, ctx, state, entity, player, position, direction, weaponSlot);
  }
};

const advanceProjectiles = (
  world: PluginWorld,
  ctx: CombatSystemContext,
  state: CombatSystemState,
): void => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const projectiles = world.getComponent<EcsProjectile>(PROJECTILE_COMPONENT);
  const entries = [...projectiles.entries()].sort(([left], [right]) => left - right);
  const toDestroy: number[] = [];

  for (const [entity, projectile] of entries) {
    const position = positions.get(entity);
    const source = state.projectileSourceByEntity.get(entity);
    if (!position || source === undefined) {
      toDestroy.push(entity);
      continue;
    }

    const sourcePlayer = world.getComponent<Player>(PLAYER_COMPONENT).get(source);
    const engineProjectile = createProjectileFromDelivery({
      id: makeProjectileId(entity),
      source,
      ...(sourcePlayer === undefined ? {} : { sourceTeam: makeTeamId(sourcePlayer.team) }),
      origin: position,
      direction: { x: projectile.dirX, y: projectile.dirY },
      delivery: ctx.delivery,
      ttlRemaining: projectile.ttlTicks,
    });

    const step = advanceProjectile(
      excludingEntity(ctx.worldView, source),
      engineProjectile,
      ctx.policy,
    );

    for (const event of step.events) {
      if (event._tag === 'EntityDefeated') {
        recordDefeat(world, ctx.damageState, event.target, projectile.ownerId);
      }
    }

    if (step.alive === undefined) {
      toDestroy.push(entity);
      continue;
    }

    if (
      isOutsideMapBounds(
        { x: step.alive.x, y: step.alive.y },
        ctx.mapBounds,
        ctx.projectileBoundsRadius,
      )
    ) {
      toDestroy.push(entity);
      continue;
    }

    positions.set(entity, { x: step.alive.x, y: step.alive.y });
    projectiles.set(entity, { ...projectile, ttlTicks: step.alive.ttlRemaining });
  }

  for (const entity of toDestroy) {
    world.destroyEntity(entity);
    state.projectileSourceByEntity.delete(entity);
  }
};

/**
 * Drive one BR combat tick on the neutral `@tileborne/simulation` engine (ADR-0018
 * Slice 7). Advances weapon firing timers, resolves fire intents into neutral
 * projectile spawns (`fireWeapon`), and steps in-flight projectiles through the
 * neutral lifecycle (`advanceProjectile`) — feeding the engine's `resolveDamage`
 * + injected `HitResolutionPolicy`. Defeats are folded into the existing BR
 * pending-kill queue; surviving projectiles are mirrored back into the ECS
 * snapshot read-model. No combat math lives here anymore.
 */
export const runCombatSystem = (
  world: PluginWorld,
  ctx: CombatSystemContext,
  state: CombatSystemState,
): void => {
  if (!state.componentsRegistered) {
    registerCombatComponents(world);
    state.componentsRegistered = true;
  }

  advanceWeapons(ctx, state);
  processShootInput(world, ctx, state);
  advanceProjectiles(world, ctx, state);
};

/**
 * Apply neutral environmental (non-entity) damage to a target through the engine
 * damage core, recording a defeat into the BR pending-kill queue. The zone uses
 * this to neutralize BR's old `applyDamage(..., "zone", ...)` path.
 */
export const applyEnvironmentDamage = (
  world: PluginWorld,
  worldView: CombatWorldView,
  policy: HitResolutionPolicy,
  damageState: DamageSystemState,
  targetEntity: number,
  amount: number,
): void => {
  const outcome = applyDamageToEntity(
    worldView,
    makeCombatEntityId(targetEntity),
    amount,
    environmentSource(),
    policy,
  );
  if (isDefeat(outcome)) {
    recordDefeat(world, damageState, targetEntity, 'zone');
  }
};

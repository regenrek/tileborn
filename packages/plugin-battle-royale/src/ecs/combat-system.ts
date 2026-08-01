import {
  advanceProjectile,
  advanceWeaponTick,
  applyDamageToEntity,
  beginReload,
  createProjectileFromDelivery,
  environmentSource,
  fireWeapon,
  initialWeaponState,
  type KnockbackImpulse,
  makeCombatEntityId,
  makeProjectileId,
  makeTeamId,
  segmentIntersectsAabb,
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
import { GameplayWeaponFired, makeGameplayEntityId } from '@tileborne/ipc-contracts';

import type { ExportedArtifact } from '../types/artifact.js';
import type { PluginWorld, RuntimePlayerInput } from '../types/runtime-plugin.js';
import {
  AIM_COMPONENT,
  AMMO_RESERVE_COMPONENT,
  BREAKABLE_COMPONENT,
  COLLISION_BODY_COMPONENT,
  DAMAGE_INDICATOR_COMPONENT,
  EQUIPPED_WEAPON_COMPONENT,
  FACING_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  RELOAD_STATE_COMPONENT,
  TEAM_COMPONENT,
  VELOCITY_COMPONENT,
  WEAPON_RUNTIME_STATE_COMPONENT,
  type Aim,
  type AmmoReserve,
  type Breakable,
  type CollisionBody,
  type DamageIndicator,
  type Direction8,
  type EquippedWeapon,
  type Facing,
  type LootSource,
  type Player,
  type Position,
  type Projectile as EcsProjectile,
  type ReloadState,
  type Team,
  type Velocity,
  type WeaponRuntimeState,
} from './components.js';
import { excludingEntity } from './combat-world-view.js';
import { type PluginCollisionEnvironment, resolvePlayerCollision } from './collision.js';
import type { DamageSystemState } from './damage-system.js';
import { direction8ToUnitVector } from './movement.js';
import {
  DEFAULT_PLAYER_PHYSICS,
  physicsForPlayer,
  type PlayerPhysicsProfile,
} from './player-physics.js';
import { isBlockedByStun } from './ability-status-system.js';

/** Axis-aligned bounds a projectile is culled when it fully leaves. */
export interface MapBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const resolveMapBoundsFromArtifact = (artifact: ExportedArtifact): MapBounds => {
  if (artifact.mapBounds !== undefined) {
    return artifact.mapBounds;
  }
  const { centerX, centerY, startRadiusTiles } = artifact.shrinkSchedule;
  return {
    minX: centerX - startRadiusTiles,
    minY: centerY - startRadiusTiles,
    maxX: centerX + startRadiusTiles,
    maxY: centerY + startRadiusTiles,
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
  readonly initialAmmoReserve?: number;
  /** Projectile own collision radius, used only for the map-bounds cull. */
  readonly projectileBoundsRadius: number;
  readonly bodyByModelId?: ReadonlyMap<string, PlayerPhysicsProfile>;
  readonly defaultPlayerPhysics?: PlayerPhysicsProfile;
  readonly collisionEnvironment?: PluginCollisionEnvironment;
  readonly tick?: number;
  readonly onWeaponSlotApplied?: (event: {
    readonly playerId: string;
    readonly slot: number;
    readonly tick?: number;
  }) => void;
  readonly onWeaponFired?: (event: GameplayWeaponFired) => void;
}

const PROJECTILE_MUZZLE_PADDING = 1;
const DEFAULT_FACING_DIRECTION: Direction8 = 0;

const registerCombatComponents = (world: PluginWorld): void => {
  world.registerComponent<Facing>(FACING_COMPONENT);
  world.registerComponent<Aim>(AIM_COMPONENT);
  world.registerComponent<EquippedWeapon>(EQUIPPED_WEAPON_COMPONENT);
  world.registerComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  world.registerComponent<ReloadState>(RELOAD_STATE_COMPONENT);
  world.registerComponent<WeaponRuntimeState>(WEAPON_RUNTIME_STATE_COMPONENT);
  world.registerComponent<DamageIndicator>(DAMAGE_INDICATOR_COMPONENT);
  world.registerComponent<EcsProjectile>(PROJECTILE_COMPONENT);
  world.registerComponent<Team>(TEAM_COMPONENT);
  world.registerComponent<Breakable>(BREAKABLE_COMPONENT);
  world.registerComponent<LootSource>(LOOT_SOURCE_COMPONENT);
  world.registerComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
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
  facing: Facing | undefined,
  aimDeg: number | undefined,
): { readonly x: number; readonly y: number } => {
  if (aimDeg !== undefined) {
    const radians = (aimDeg * Math.PI) / 180;
    return normalizeVector(Math.cos(radians), Math.sin(radians));
  }
  if (velocity && (velocity.vx !== 0 || velocity.vy !== 0)) {
    return normalizeVector(velocity.vx, velocity.vy);
  }
  return direction8ToUnitVector(facing === undefined ? DEFAULT_FACING_DIRECTION : facing.dir);
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

const isDamageEvent = (event: {
  readonly _tag: string;
}): event is Extract<DamageOutcome, { readonly _tag: 'DamageApplied' | 'EntityDefeated' }> =>
  event._tag === 'DamageApplied' || event._tag === 'EntityDefeated';

const normalizeDegrees = (degrees: number): number => {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const damageAngleDeg = (
  target: Position | undefined,
  source: { readonly x: number; readonly y: number } | undefined,
): number => {
  if (target === undefined || source === undefined) {
    return 0;
  }
  return normalizeDegrees((Math.atan2(source.y - target.y, source.x - target.x) * 180) / Math.PI);
};

const recordDamageIndicator = (
  world: PluginWorld,
  targetEntity: number,
  sourceId: string,
  amount: number,
  tick: number,
  sourcePosition?: { readonly x: number; readonly y: number },
): void => {
  const position = world.getComponent<Position>(POSITION_COMPONENT).get(targetEntity);
  world.getComponent<DamageIndicator>(DAMAGE_INDICATOR_COMPONENT).set(targetEntity, {
    sourceId,
    angleDeg: damageAngleDeg(position, sourcePosition),
    amount,
    tick,
  });
};

const projectileMuzzleOffset = (delivery: ProjectileDelivery): number =>
  delivery.radius + PROJECTILE_MUZZLE_PADDING;

const projectileOrigin = (
  position: Position,
  direction: { readonly x: number; readonly y: number },
  delivery: ProjectileDelivery,
  body: PlayerPhysicsProfile,
): Position => {
  const offset = projectileMuzzleOffset(delivery);
  return {
    x: position.x + body.offsetX + direction.x * offset,
    y: position.y + body.offsetY + direction.y * offset,
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

const advanceWeapons = (ctx: CombatSystemContext, state: CombatSystemState): void => {
  for (const [playerId, weaponState] of state.weaponStateByPlayerId) {
    state.weaponStateByPlayerId.set(playerId, advanceWeaponTick(ctx.weapon, weaponState, 1).state);
  }
};

const ammoKind = (ctx: CombatSystemContext): string => String(ctx.weapon.id);

const reserveAmount = (reserve: AmmoReserve | undefined, kind: string): number =>
  reserve?.stacks.find((stack) => stack.ammoKind === kind)?.amount ?? 0;

const setReserveAmount = (
  world: PluginWorld,
  entity: number,
  kind: string,
  amount: number,
): void => {
  const reserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  const current = reserves.get(entity)?.stacks ?? [];
  const nextAmount = Math.max(0, Math.floor(amount));
  const nextStacks = current.some((stack) => stack.ammoKind === kind)
    ? current.map((stack) => (stack.ammoKind === kind ? { ...stack, amount: nextAmount } : stack))
    : [...current, { ammoKind: kind, amount: nextAmount }];
  reserves.set(entity, { stacks: nextStacks });
};

const ensureWeaponRuntimeComponents = (
  world: PluginWorld,
  ctx: CombatSystemContext,
  state: CombatSystemState,
  entity: number,
  player: Player,
): WeaponState => {
  const weaponState = ensureWeaponState(ctx, state, player.playerId);
  const kind = ammoKind(ctx);
  const reserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  if (!reserves.has(entity)) {
    setReserveAmount(world, entity, kind, ctx.initialAmmoReserve ?? 0);
  }
  const equippedWeapons = world.getComponent<EquippedWeapon>(EQUIPPED_WEAPON_COMPONENT);
  if (!equippedWeapons.has(entity)) {
    equippedWeapons.set(entity, {
      weaponId: kind,
      slot: state.activeWeaponSlotByPlayerId.get(player.playerId) ?? 1,
    });
  }
  const reloadStates = world.getComponent<ReloadState>(RELOAD_STATE_COMPONENT);
  if (!reloadStates.has(entity)) {
    reloadStates.set(entity, { active: false, weaponId: kind, remainingTicks: 0 });
  }
  return weaponState;
};

const syncWeaponRuntimeComponents = (
  world: PluginWorld,
  ctx: CombatSystemContext,
  state: CombatSystemState,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const equippedWeapons = world.getComponent<EquippedWeapon>(EQUIPPED_WEAPON_COMPONENT);
  const ammoReserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  const reloadStates = world.getComponent<ReloadState>(RELOAD_STATE_COMPONENT);
  const weaponRuntimeStates = world.getComponent<WeaponRuntimeState>(
    WEAPON_RUNTIME_STATE_COMPONENT,
  );
  const kind = ammoKind(ctx);
  for (const [entity, player] of players.entries()) {
    const weaponState = state.weaponStateByPlayerId.get(player.playerId);
    const slot = state.activeWeaponSlotByPlayerId.get(player.playerId) ?? 1;
    equippedWeapons.set(entity, { weaponId: kind, slot });
    if (!weaponState) {
      if (!ammoReserves.has(entity)) {
        ammoReserves.set(entity, {
          stacks: [{ ammoKind: kind, amount: ctx.initialAmmoReserve ?? 0 }],
        });
      }
      reloadStates.set(entity, { active: false, weaponId: kind, remainingTicks: 0 });
      weaponRuntimeStates.set(entity, {
        weaponId: kind,
        slot,
        ammoInMagazine: ctx.weapon.magazineSize,
        magazineSize: ctx.weapon.magazineSize,
        cooldownRemainingTicks: 0,
        reloadRemainingTicks: 0,
        reloadTotalTicks: ctx.weapon.reloadTicks,
      });
      continue;
    }
    if (!ammoReserves.has(entity)) {
      ammoReserves.set(entity, {
        stacks: [{ ammoKind: kind, amount: ctx.initialAmmoReserve ?? 0 }],
      });
    }
    reloadStates.set(entity, {
      active: weaponState.reloadRemaining > 0,
      weaponId: kind,
      remainingTicks: weaponState.reloadRemaining,
    });
    weaponRuntimeStates.set(entity, {
      weaponId: kind,
      slot,
      ammoInMagazine: weaponState.ammoInMagazine,
      magazineSize: ctx.weapon.magazineSize,
      cooldownRemainingTicks: weaponState.cooldownRemaining,
      reloadRemainingTicks: weaponState.reloadRemaining,
      reloadTotalTicks: ctx.weapon.reloadTicks,
    });
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
  body: PlayerPhysicsProfile,
): void => {
  const entity = world.createEntity();
  const origin = projectileOrigin(position, direction, ctx.delivery, body);
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, origin);
  world.getComponent<EcsProjectile>(PROJECTILE_COMPONENT).set(entity, {
    ownerId: owner.playerId,
    weaponSlot,
    dirX: direction.x,
    dirY: direction.y,
    speed: ctx.delivery.speed,
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
  const facings = world.getComponent<Facing>(FACING_COMPONENT);
  const aims = world.getComponent<Aim>(AIM_COMPONENT);
  const equippedWeapons = world.getComponent<EquippedWeapon>(EQUIPPED_WEAPON_COMPONENT);
  const reserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  const kind = ammoKind(ctx);

  for (const [entity, player] of players.entries()) {
    if (player.alive !== 1 || isBlockedByStun(world, entity)) {
      continue;
    }

    let weaponState = ensureWeaponRuntimeComponents(world, ctx, state, entity, player);

    const input = ctx.getPlayerInput?.(player.playerId);
    if (!input) {
      continue;
    }

    if (isValidWeaponSlot(input.swapSlot, ctx.weaponSlotCount)) {
      state.activeWeaponSlotByPlayerId.set(player.playerId, input.swapSlot);
      equippedWeapons.set(entity, { weaponId: String(ctx.weapon.id), slot: input.swapSlot });
      ctx.onWeaponSlotApplied?.({
        playerId: player.playerId,
        slot: input.swapSlot,
        ...(ctx.tick === undefined ? {} : { tick: ctx.tick }),
      });
    }

    if (isValidDirection8(input.dir)) {
      const currentFacing = facings.get(entity);
      if (!currentFacing || currentFacing.dir !== input.dir) {
        facings.set(entity, { dir: input.dir });
      }
    }
    if (isValidAimDeg(input.aimDeg)) {
      aims.set(entity, { deg: input.aimDeg });
    }

    if (input.reload) {
      const reserveBefore = reserveAmount(reserves.get(entity), kind);
      const reload = beginReload(ctx.weapon, weaponState, reserveBefore);
      if (reload.ammoLoaded > 0) {
        setReserveAmount(world, entity, kind, reserveBefore - reload.ammoLoaded);
      }
      state.weaponStateByPlayerId.set(player.playerId, reload.state);
      weaponState = reload.state;
    }

    if (!input.shoot) {
      continue;
    }

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
      facings.get(entity),
      isValidAimDeg(input.aimDeg) ? input.aimDeg : undefined,
    );
    const weaponSlot = state.activeWeaponSlotByPlayerId.get(player.playerId) ?? 1;
    const body = physicsForPlayer(
      player,
      ctx.bodyByModelId,
      ctx.defaultPlayerPhysics ?? DEFAULT_PLAYER_PHYSICS,
    );
    const origin = projectileOrigin(position, direction, ctx.delivery, body);
    spawnProjectile(world, ctx, state, entity, player, position, direction, weaponSlot, body);
    ctx.onWeaponFired?.(
      new GameplayWeaponFired({
        tick: ctx.tick ?? input.tick,
        sourceId: makeGameplayEntityId(player.playerId),
        weaponId: ctx.weapon.id,
        origin,
        direction,
        damage: ctx.weapon.damage,
        ammoRemaining: fired.state.ammoInMagazine,
      }),
    );
  }
};

const applyKnockbacks = (
  world: PluginWorld,
  ctx: CombatSystemContext,
  knockbacks: readonly KnockbackImpulse[],
): void => {
  if (knockbacks.length === 0) {
    return;
  }
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const sorted = [...knockbacks].sort((left, right) => left.target - right.target);

  for (const impulse of sorted) {
    const player = players.get(impulse.target);
    const position = positions.get(impulse.target);
    if (!player || !position) {
      continue;
    }
    const body = physicsForPlayer(
      player,
      ctx.bodyByModelId,
      ctx.defaultPlayerPhysics ?? DEFAULT_PLAYER_PHYSICS,
    );
    const nextPosition = {
      x: position.x + impulse.x,
      y: position.y + impulse.y,
    };
    if (ctx.collisionEnvironment !== undefined) {
      resolvePlayerCollision(nextPosition, ctx.collisionEnvironment, body.radius, {
        x: body.offsetX,
        y: body.offsetY,
      });
    }
    positions.set(impulse.target, nextPosition);
  }
};

interface BreakableProjectileHit {
  readonly entity: number;
  readonly bodyEntity: number;
  readonly distanceFromProjectile: number;
}

const findBreakableProjectileHit = (
  world: PluginWorld,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  radius: number,
): BreakableProjectileHit | undefined => {
  const breakables = world.getComponent<Breakable>(BREAKABLE_COMPONENT);
  const lootSources = world.getComponent<LootSource>(LOOT_SOURCE_COMPONENT);
  const collisionBodies = world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
  let nearest: BreakableProjectileHit | undefined;

  for (const [entity, breakable] of breakables.entries()) {
    if (breakable.destroyed || breakable.health <= 0) {
      continue;
    }
    const source = lootSources.get(entity);
    if (source === undefined || source.collected) {
      continue;
    }
    for (const [bodyEntity, body] of collisionBodies.entries()) {
      if (body.objectId !== source.tableId || !body.blocksProjectiles) {
        continue;
      }
      const intersects = segmentIntersectsAabb(
        from,
        to,
        {
          minX: body.x,
          minY: body.y,
          maxX: body.x + body.width,
          maxY: body.y + body.height,
          blocksProjectiles: body.blocksProjectiles,
          blocksVision: body.blocksVision,
        },
        radius,
      );
      if (!intersects) {
        continue;
      }
      const center = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
      const distanceFromProjectile = Math.hypot(center.x - from.x, center.y - from.y);
      if (
        nearest === undefined ||
        distanceFromProjectile < nearest.distanceFromProjectile ||
        (distanceFromProjectile === nearest.distanceFromProjectile && entity < nearest.entity) ||
        (distanceFromProjectile === nearest.distanceFromProjectile &&
          entity === nearest.entity &&
          bodyEntity < nearest.bodyEntity)
      ) {
        nearest = { entity, bodyEntity, distanceFromProjectile };
      }
    }
  }

  return nearest;
};

const applyBreakableProjectileDamage = (
  world: PluginWorld,
  entity: number,
  amount: number,
): void => {
  const breakables = world.getComponent<Breakable>(BREAKABLE_COMPONENT);
  const breakable = breakables.get(entity);
  if (breakable === undefined || breakable.destroyed) {
    return;
  }
  const health = Math.max(0, breakable.health - amount);
  breakables.set(entity, {
    ...breakable,
    health,
    destroyed: false,
  });
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

    const sourceTeam = world.getComponent<Team>(TEAM_COMPONENT).get(source);
    const from = { x: position.x, y: position.y };
    const to = {
      x: position.x + projectile.dirX * projectile.speed,
      y: position.y + projectile.dirY * projectile.speed,
    };
    const breakableHit = findBreakableProjectileHit(world, from, to, ctx.delivery.radius);
    if (breakableHit !== undefined) {
      applyBreakableProjectileDamage(world, breakableHit.entity, ctx.delivery.damage);
      toDestroy.push(entity);
      continue;
    }

    const engineProjectile = createProjectileFromDelivery({
      id: makeProjectileId(entity),
      source,
      ...(sourceTeam === undefined ? {} : { sourceTeam: makeTeamId(sourceTeam.team) }),
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
      if (isDamageEvent(event)) {
        recordDamageIndicator(
          world,
          event.target,
          projectile.ownerId,
          event.amount,
          ctx.tick ?? 0,
          from,
        );
      }
      if (event._tag === 'EntityDefeated') {
        recordDefeat(world, ctx.damageState, event.target, projectile.ownerId);
      }
    }
    applyKnockbacks(world, ctx, step.knockbacks);

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
  syncWeaponRuntimeComponents(world, ctx, state);
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
  tick = 0,
): void => {
  const outcome = applyDamageToEntity(
    worldView,
    makeCombatEntityId(targetEntity),
    amount,
    environmentSource(),
    policy,
  );
  if (isDamageEvent(outcome)) {
    recordDamageIndicator(world, targetEntity, 'zone', outcome.amount, tick);
  }
  if (isDefeat(outcome)) {
    recordDefeat(world, damageState, targetEntity, 'zone');
  }
};

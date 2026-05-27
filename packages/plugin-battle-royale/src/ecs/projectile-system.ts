import { MOVEMENT, PROJECTILE } from "../constants.js";
import type { ExportedArtifact } from "../types/artifact.js";
import type { PluginWorld, RuntimePlayerInput } from "../types/runtime-plugin.js";
import { circleOverlapsRect } from "./circle-rect.js";
import type { PluginCollisionEnvironment } from "./collision.js";
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
  type Projectile,
  type Velocity,
} from "./components.js";
import { applyDamage, type DamageSystemState } from "./damage-system.js";
import { direction8ToUnitVector } from "./movement.js";

export interface ProjectileSystemConfig {
  readonly speed: number;
  readonly damage: number;
  readonly ttlTicks: number;
  readonly shootCooldownTicks: number;
  readonly projectileRadius: number;
  readonly playerRadius: number;
  readonly playerOffsetY: number;
  readonly weaponSlotCount: number;
}

export const DEFAULT_PROJECTILE_SYSTEM_CONFIG: ProjectileSystemConfig = {
  speed: PROJECTILE.speed,
  damage: PROJECTILE.damage,
  ttlTicks: PROJECTILE.ttlTicks,
  shootCooldownTicks: PROJECTILE.shootCooldownTicks,
  projectileRadius: PROJECTILE.radius,
  playerRadius: MOVEMENT.radius,
  playerOffsetY: MOVEMENT.footprintOffsetY,
  weaponSlotCount: PROJECTILE.weaponSlotCount,
};

export interface ProjectileSystemContext {
  readonly config?: Partial<ProjectileSystemConfig>;
  readonly collisionEnvironment?: PluginCollisionEnvironment;
  readonly mapBounds?: MapBounds;
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly damageState: DamageSystemState;
}

export interface MapBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ProjectileSystemState {
  readonly lastShootTickByPlayerId: Map<string, number>;
  readonly activeWeaponSlotByPlayerId: Map<string, number>;
  componentsRegistered: boolean;
}

export const createProjectileSystemState = (): ProjectileSystemState => ({
  lastShootTickByPlayerId: new Map<string, number>(),
  activeWeaponSlotByPlayerId: new Map<string, number>(),
  componentsRegistered: false,
});

export const resolveProjectileSystemConfig = (
  partial: Partial<ProjectileSystemConfig> = {},
): ProjectileSystemConfig => ({
  ...DEFAULT_PROJECTILE_SYSTEM_CONFIG,
  ...partial,
});

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

const registerProjectileComponents = (world: PluginWorld): void => {
  world.registerComponent<LastFacing>(LAST_FACING_COMPONENT);
  world.registerComponent<Projectile>(PROJECTILE_COMPONENT);
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

const isValidWeaponSlot = (slot: number | undefined, slotCount: number): slot is number =>
  slot !== undefined && Number.isInteger(slot) && slot >= 1 && slot <= slotCount;

const isOutsideMapBounds = (position: Position, bounds: MapBounds | undefined, radius: number): boolean => {
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

const hitsBlockingGeometry = (
  position: Position,
  environment: PluginCollisionEnvironment | undefined,
  radius: number,
): boolean => {
  if (!environment) {
    return false;
  }
  for (const rect of environment.blockingRects) {
    if (circleOverlapsRect(position.x, position.y, radius, rect)) {
      return true;
    }
  }
  return false;
};

const circleDistance = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => Math.hypot(ax - bx, ay - by);

const findHitPlayer = (
  world: PluginWorld,
  projectile: Projectile,
  position: Position,
  config: ProjectileSystemConfig,
): number | undefined => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);

  for (const [entity, player] of players.entries()) {
    if (player.alive !== 1 || player.playerId === projectile.ownerId) {
      continue;
    }

    const playerPosition = positions.get(entity);
    if (!playerPosition) {
      continue;
    }

    const playerCenterY = playerPosition.y + config.playerOffsetY;
    const hitRadius = config.playerRadius + config.projectileRadius;
    if (
      circleDistance(position.x, position.y, playerPosition.x, playerCenterY) <= hitRadius
    ) {
      return entity;
    }
  }

  return undefined;
};

const applyProjectileDamage = (
  world: PluginWorld,
  victimEntity: number,
  projectile: Projectile,
  damageState: DamageSystemState,
): void => {
  applyDamage(world, victimEntity, projectile.damage, projectile.ownerId, damageState);
};

const spawnProjectile = (
  world: PluginWorld,
  owner: Player,
  position: Position,
  direction: { readonly x: number; readonly y: number },
  weaponSlot: number,
  config: ProjectileSystemConfig,
): void => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, { x: position.x, y: position.y });
  world.getComponent<Projectile>(PROJECTILE_COMPONENT).set(entity, {
    ownerId: owner.playerId,
    weaponSlot,
    dirX: direction.x,
    dirY: direction.y,
    speed: config.speed,
    damage: config.damage,
    ttlTicks: config.ttlTicks,
  });
};

const processShootInput = (
  world: PluginWorld,
  tick: number,
  ctx: ProjectileSystemContext,
  config: ProjectileSystemConfig,
  state: ProjectileSystemState,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const velocities = world.getComponent<Velocity>(VELOCITY_COMPONENT);
  const lastFacings = world.getComponent<LastFacing>(LAST_FACING_COMPONENT);

  for (const [entity, player] of players.entries()) {
    if (player.alive !== 1) {
      continue;
    }

    const input = ctx.getPlayerInput?.(player.playerId);
    if (!input) {
      continue;
    }

    if (isValidWeaponSlot(input.weaponSlot, config.weaponSlotCount)) {
      state.activeWeaponSlotByPlayerId.set(player.playerId, input.weaponSlot);
    }

    const currentFacing = lastFacings.get(entity);
    if (!currentFacing || currentFacing.dir !== input.dir) {
      lastFacings.set(entity, { dir: input.dir as Direction8 });
    }

    if (!input.shoot) {
      continue;
    }

    const lastShootTick = state.lastShootTickByPlayerId.get(player.playerId);
    if (lastShootTick !== undefined && tick - lastShootTick < config.shootCooldownTicks) {
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
    spawnProjectile(world, player, position, direction, weaponSlot, config);
    state.lastShootTickByPlayerId.set(player.playerId, tick);
  }
};

const advanceProjectiles = (
  world: PluginWorld,
  dt: number,
  tick: number,
  ctx: ProjectileSystemContext,
  config: ProjectileSystemConfig,
): void => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const projectiles = world.getComponent<Projectile>(PROJECTILE_COMPONENT);
  const toDestroy: number[] = [];

  for (const [entity, projectile] of projectiles.entries()) {
    const position = positions.get(entity);
    if (!position) {
      toDestroy.push(entity);
      continue;
    }

    const nextPosition = {
      x: position.x + projectile.dirX * projectile.speed * dt,
      y: position.y + projectile.dirY * projectile.speed * dt,
    };
    positions.set(entity, nextPosition);

    const nextTtl = projectile.ttlTicks - 1;
    projectiles.set(entity, {
      ...projectile,
      ttlTicks: nextTtl,
    });

    if (
      nextTtl <= 0 ||
      isOutsideMapBounds(nextPosition, ctx.mapBounds, config.projectileRadius) ||
      hitsBlockingGeometry(nextPosition, ctx.collisionEnvironment, config.projectileRadius)
    ) {
      toDestroy.push(entity);
      continue;
    }

    const hitPlayerEntity = findHitPlayer(world, projectile, nextPosition, config);
    if (hitPlayerEntity !== undefined) {
      applyProjectileDamage(world, hitPlayerEntity, projectile, ctx.damageState);
      toDestroy.push(entity);
    }
  }

  for (const entity of toDestroy) {
    world.destroyEntity(entity);
  }
};

export const runProjectileSystem = (
  world: PluginWorld,
  dt: number,
  tick: number,
  ctx: ProjectileSystemContext,
  state: ProjectileSystemState,
): void => {
  if (!state.componentsRegistered) {
    registerProjectileComponents(world);
    state.componentsRegistered = true;
  }

  const config = resolveProjectileSystemConfig(ctx.config);
  processShootInput(world, tick, ctx, config, state);
  advanceProjectiles(world, dt, tick, ctx, config);
};

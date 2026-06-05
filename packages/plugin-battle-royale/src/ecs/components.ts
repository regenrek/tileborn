import { Schema } from "effect";

/** World-space tile position for a spawned entity. */
export class PositionComponent extends Schema.Class<PositionComponent>("PositionComponent")({
  x: Schema.Number,
  y: Schema.Number,
}) {}

/** Per-tick velocity in tile units per second. */
export class VelocityComponent extends Schema.Class<VelocityComponent>("VelocityComponent")({
  vx: Schema.Number,
  vy: Schema.Number,
}) {}

/** Battle royale player state tracked by the playtest runtime metrics bridge. */
export class PlayerComponent extends Schema.Class<PlayerComponent>("PlayerComponent")({
  playerId: Schema.String,
  health: Schema.Number,
  alive: Schema.Union([Schema.Literal(0), Schema.Literal(1)]),
  team: Schema.String,
  /** Selected player-model id (from the persisted lobby pick); optional. */
  modelId: Schema.optional(Schema.String),
}) {}

/** Per-player kill/death counters consumed by the HUD overlay. */
export class PlayerStatsComponent extends Schema.Class<PlayerStatsComponent>("PlayerStatsComponent")({
  kills: Schema.Int,
  deaths: Schema.Int,
}) {}

/** Last eight-way facing direction used when shooting without movement velocity. */
export class LastFacingComponent extends Schema.Class<LastFacingComponent>("LastFacingComponent")({
  dir: Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const),
}) {}

/** Projectile motion and combat payload owned by the projectile system. */
export class ProjectileComponent extends Schema.Class<ProjectileComponent>("ProjectileComponent")({
  ownerId: Schema.String,
  weaponSlot: Schema.Int,
  dirX: Schema.Number,
  dirY: Schema.Number,
  /**
   * Snapshot read-model speed in world units per simulation tick. Combat
   * reconstruction uses the resolved `ProjectileDelivery` as the combat SSOT;
   * snapshots multiply this by direction to emit renderer velocity.
   */
  speed: Schema.Number,
  ttlTicks: Schema.Int,
}) {}

export const POSITION_COMPONENT = "Position";
export const VELOCITY_COMPONENT = "Velocity";
export const PLAYER_COMPONENT = "Player";
export const PLAYER_STATS_COMPONENT = "PlayerStats";
export const LAST_FACING_COMPONENT = "LastFacing";
export const PROJECTILE_COMPONENT = "Projectile";

export type Position = typeof PositionComponent.Type;
export type Velocity = typeof VelocityComponent.Type;
export type Player = typeof PlayerComponent.Type;
export type PlayerStats = typeof PlayerStatsComponent.Type;
export type LastFacing = typeof LastFacingComponent.Type;
export type Projectile = typeof ProjectileComponent.Type;
export type Direction8 = LastFacing["dir"];

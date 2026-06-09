import { REQUIRED_PLAYER_MODEL_CLIP_KEYS } from "@tileborne/core";
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

/** Battle royale player identity/vitality tracked by the playtest runtime metrics bridge. */
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

/** Runtime-owned team membership used by combat policy and match rules. */
export class TeamComponent extends Schema.Class<TeamComponent>("TeamComponent")({
  team: Schema.String,
}) {}

/** Last eight-way facing direction used when shooting without movement velocity. */
export class FacingComponent extends Schema.Class<FacingComponent>("FacingComponent")({
  dir: Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const),
}) {}

/** Current aim direction in degrees, normalized to [0, 359]. */
export class AimComponent extends Schema.Class<AimComponent>("AimComponent")({
  deg: Schema.Number,
}) {}

/** Runtime-computed muzzle origin in world coordinates. */
export class MuzzleComponent extends Schema.Class<MuzzleComponent>("MuzzleComponent")({
  x: Schema.Number,
  y: Schema.Number,
}) {}

export const PlayerAnimationClipKey = Schema.Literals(REQUIRED_PLAYER_MODEL_CLIP_KEYS);
export type PlayerAnimationClipKey = typeof PlayerAnimationClipKey.Type;

/** Runtime-owned animation state emitted in BR snapshots and consumed by the projector. */
export class AnimationStateComponent extends Schema.Class<AnimationStateComponent>("AnimationStateComponent")({
  modelId: Schema.String,
  clipKey: PlayerAnimationClipKey,
  facingDeg: Schema.Number,
  moving: Schema.Boolean,
  aimDeg: Schema.optional(Schema.Number),
}) {}

/** Runtime inventory slots. S6 owns pickup semantics; S5 owns the authoritative column. */
export class InventoryComponent extends Schema.Class<InventoryComponent>("InventoryComponent")({
  itemIds: Schema.Array(Schema.String),
  capacity: Schema.Int,
}) {}

/** Equipped weapon slot resolved from runtime input and weapon catalog data. */
export class EquippedWeaponComponent extends Schema.Class<EquippedWeaponComponent>("EquippedWeaponComponent")({
  weaponId: Schema.String,
  slot: Schema.Int,
}) {}

const AmmoStackSchema = Schema.Struct({
  ammoKind: Schema.String,
  amount: Schema.Int,
});

export class AmmoReserveComponent extends Schema.Class<AmmoReserveComponent>("AmmoReserveComponent")({
  stacks: Schema.Array(AmmoStackSchema),
}) {}

export class ReloadStateComponent extends Schema.Class<ReloadStateComponent>("ReloadStateComponent")({
  active: Schema.Boolean,
  weaponId: Schema.optional(Schema.String),
  remainingTicks: Schema.Int,
}) {}

export class WeaponRuntimeStateComponent extends Schema.Class<WeaponRuntimeStateComponent>("WeaponRuntimeStateComponent")({
  weaponId: Schema.String,
  slot: Schema.Int,
  ammoInMagazine: Schema.Int,
  magazineSize: Schema.Int,
  cooldownRemainingTicks: Schema.Int,
  reloadRemainingTicks: Schema.Int,
  reloadTotalTicks: Schema.Int,
}) {}

export class DamageIndicatorComponent extends Schema.Class<DamageIndicatorComponent>("DamageIndicatorComponent")({
  sourceId: Schema.String,
  angleDeg: Schema.Number,
  amount: Schema.Number,
  tick: Schema.Int,
}) {}

export class PickupToastComponent extends Schema.Class<PickupToastComponent>("PickupToastComponent")({
  itemKind: Schema.String,
  tier: Schema.String,
  quantity: Schema.Int,
  tick: Schema.Int,
}) {}

export class PickupComponent extends Schema.Class<PickupComponent>("PickupComponent")({
  itemKind: Schema.String,
  tier: Schema.String,
  quantity: Schema.Int,
  available: Schema.Boolean,
}) {}

export class PickupPromptComponent extends Schema.Class<PickupPromptComponent>("PickupPromptComponent")({
  targetEntity: Schema.optional(Schema.Int),
  itemKind: Schema.optional(Schema.String),
  tier: Schema.optional(Schema.String),
  distance: Schema.optional(Schema.Number),
  action: Schema.Literals(["pickup-loot"] as const),
  available: Schema.Boolean,
}) {}

export class LootSourceComponent extends Schema.Class<LootSourceComponent>("LootSourceComponent")({
  tableId: Schema.String,
  tier: Schema.String,
  weight: Schema.Number,
  collected: Schema.Boolean,
}) {}

export class InteractableComponent extends Schema.Class<InteractableComponent>("InteractableComponent")({
  action: Schema.String,
  radius: Schema.Number,
  enabled: Schema.Boolean,
}) {}

export class BreakableComponent extends Schema.Class<BreakableComponent>("BreakableComponent")({
  health: Schema.Number,
  maxHealth: Schema.Number,
  destroyed: Schema.Boolean,
}) {}

export class HazardComponent extends Schema.Class<HazardComponent>("HazardComponent")({
  damagePerSecond: Schema.Number,
  enabled: Schema.Boolean,
}) {}

export class DeployableComponent extends Schema.Class<DeployableComponent>("DeployableComponent")({
  kind: Schema.Literals(["trap", "decoy", "scan-pulse"] as const),
  ownerId: Schema.String,
  radius: Schema.Number,
  remainingTicks: Schema.Int,
  armedTicks: Schema.Int,
  triggered: Schema.Boolean,
}) {}

export class AbilityStateComponent extends Schema.Class<AbilityStateComponent>("AbilityStateComponent")({
  activeAbilityId: Schema.optional(Schema.String),
  charges: Schema.Int,
  cooldownTicks: Schema.Int,
  cooldowns: Schema.Array(
    Schema.Struct({
      abilityId: Schema.String,
      remainingTicks: Schema.Int,
    }),
  ),
}) {}

const StatusEffectEntrySchema = Schema.Struct({
  effectId: Schema.String,
  remainingTicks: Schema.Int,
  stacks: Schema.Int,
  sourcePlayerId: Schema.optional(Schema.String),
});

export class StatusEffectsComponent extends Schema.Class<StatusEffectsComponent>("StatusEffectsComponent")({
  effects: Schema.Array(StatusEffectEntrySchema),
}) {}

export class ShieldComponent extends Schema.Class<ShieldComponent>("ShieldComponent")({
  current: Schema.Number,
  max: Schema.Number,
}) {}

export class ArmorComponent extends Schema.Class<ArmorComponent>("ArmorComponent")({
  mitigation: Schema.Number,
  durability: Schema.Number,
}) {}

export class HitboxComponent extends Schema.Class<HitboxComponent>("HitboxComponent")({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
}) {}

export class CollisionBodyComponent extends Schema.Class<CollisionBodyComponent>("CollisionBodyComponent")({
  objectId: Schema.optional(Schema.String),
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  blocksMovement: Schema.Boolean,
  blocksProjectiles: Schema.Boolean,
  blocksVision: Schema.Boolean,
}) {}

export class VisionBlockerComponent extends Schema.Class<VisionBlockerComponent>("VisionBlockerComponent")({
  objectId: Schema.optional(Schema.String),
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
}) {}

export class MatchPhaseComponent extends Schema.Class<MatchPhaseComponent>("MatchPhaseComponent")({
  phase: Schema.Literals(["active", "game-over"] as const),
  tick: Schema.Int,
  winnerPlayerId: Schema.optional(Schema.String),
}) {}

export class RespawnStateComponent extends Schema.Class<RespawnStateComponent>("RespawnStateComponent")({
  state: Schema.Literals(["alive", "dead", "scheduled"] as const),
  respawnTick: Schema.optional(Schema.Int),
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
export const TEAM_COMPONENT = "Team";
export const FACING_COMPONENT = "Facing";
export const AIM_COMPONENT = "Aim";
export const MUZZLE_COMPONENT = "Muzzle";
export const ANIMATION_STATE_COMPONENT = "AnimationState";
export const INVENTORY_COMPONENT = "Inventory";
export const EQUIPPED_WEAPON_COMPONENT = "EquippedWeapon";
export const AMMO_RESERVE_COMPONENT = "AmmoReserve";
export const RELOAD_STATE_COMPONENT = "ReloadState";
export const WEAPON_RUNTIME_STATE_COMPONENT = "WeaponRuntimeState";
export const DAMAGE_INDICATOR_COMPONENT = "DamageIndicator";
export const PICKUP_TOAST_COMPONENT = "PickupToast";
export const PICKUP_COMPONENT = "Pickup";
export const PICKUP_PROMPT_COMPONENT = "PickupPrompt";
export const LOOT_SOURCE_COMPONENT = "LootSource";
export const INTERACTABLE_COMPONENT = "Interactable";
export const BREAKABLE_COMPONENT = "Breakable";
export const HAZARD_COMPONENT = "Hazard";
export const DEPLOYABLE_COMPONENT = "Deployable";
export const ABILITY_STATE_COMPONENT = "AbilityState";
export const STATUS_EFFECTS_COMPONENT = "StatusEffects";
export const SHIELD_COMPONENT = "Shield";
export const ARMOR_COMPONENT = "Armor";
export const HITBOX_COMPONENT = "Hitbox";
export const COLLISION_BODY_COMPONENT = "CollisionBody";
export const VISION_BLOCKER_COMPONENT = "VisionBlocker";
export const MATCH_PHASE_COMPONENT = "MatchPhase";
export const RESPAWN_STATE_COMPONENT = "RespawnState";
export const PROJECTILE_COMPONENT = "Projectile";

export type Position = typeof PositionComponent.Type;
export type Velocity = typeof VelocityComponent.Type;
export type Player = typeof PlayerComponent.Type;
export type PlayerStats = typeof PlayerStatsComponent.Type;
export type Team = typeof TeamComponent.Type;
export type Facing = typeof FacingComponent.Type;
export type Aim = typeof AimComponent.Type;
export type Muzzle = typeof MuzzleComponent.Type;
export type AnimationState = typeof AnimationStateComponent.Type;
export type Inventory = typeof InventoryComponent.Type;
export type EquippedWeapon = typeof EquippedWeaponComponent.Type;
export type AmmoReserve = typeof AmmoReserveComponent.Type;
export type ReloadState = typeof ReloadStateComponent.Type;
export type WeaponRuntimeState = typeof WeaponRuntimeStateComponent.Type;
export type DamageIndicator = typeof DamageIndicatorComponent.Type;
export type PickupToast = typeof PickupToastComponent.Type;
export type Pickup = typeof PickupComponent.Type;
export type PickupPrompt = typeof PickupPromptComponent.Type;
export type LootSource = typeof LootSourceComponent.Type;
export type Interactable = typeof InteractableComponent.Type;
export type Breakable = typeof BreakableComponent.Type;
export type Hazard = typeof HazardComponent.Type;
export type Deployable = typeof DeployableComponent.Type;
export type AbilityState = typeof AbilityStateComponent.Type;
export type StatusEffects = typeof StatusEffectsComponent.Type;
export type Shield = typeof ShieldComponent.Type;
export type Armor = typeof ArmorComponent.Type;
export type Hitbox = typeof HitboxComponent.Type;
export type CollisionBody = typeof CollisionBodyComponent.Type;
export type VisionBlocker = typeof VisionBlockerComponent.Type;
export type MatchPhase = typeof MatchPhaseComponent.Type;
export type RespawnState = typeof RespawnStateComponent.Type;
export type Projectile = typeof ProjectileComponent.Type;
export type Direction8 = Facing["dir"];

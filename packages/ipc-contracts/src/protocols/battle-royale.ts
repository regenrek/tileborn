import { Schema } from "effect";
import { pack, unpack } from "msgpackr";
import { REQUIRED_PLAYER_MODEL_CLIP_KEYS } from "@tileborne/core";

// ADR-0014 Phase 1: snapshot frames carry required monotonic server timestamps
// so renderers can interpolate in server time while sampling with client clocks.
export const PlayerId = Schema.String.pipe(Schema.brand("PlayerId"));
export type PlayerId = typeof PlayerId.Type;

export const makePlayerId = (id: string): PlayerId => Schema.decodeUnknownSync(PlayerId)(id);

export const ProjectileId = Schema.String.pipe(Schema.brand("ProjectileId"));
export type ProjectileId = typeof ProjectileId.Type;

export const makeProjectileId = (id: string): ProjectileId => Schema.decodeUnknownSync(ProjectileId)(id);

export const DeployableId = Schema.String.pipe(Schema.brand("DeployableId"));
export type DeployableId = typeof DeployableId.Type;

export const makeDeployableId = (id: string): DeployableId => Schema.decodeUnknownSync(DeployableId)(id);

export const DeployableOwnerId = Schema.String.pipe(Schema.brand("DeployableOwnerId"));
export type DeployableOwnerId = typeof DeployableOwnerId.Type;

export const makeDeployableOwnerId = (id: string): DeployableOwnerId =>
  Schema.decodeUnknownSync(DeployableOwnerId)(id);

export const ObjectId = Schema.String.pipe(Schema.brand("ObjectId"));
export type ObjectId = typeof ObjectId.Type;

export const makeObjectId = (id: string): ObjectId => Schema.decodeUnknownSync(ObjectId)(id);

/** Eight-way movement input: 0 = east, increasing clockwise. */
export const Direction8 = Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const);
export type Direction8 = typeof Direction8.Type;

export const BattleRoyaleAbility = {
  dash: "dash",
  shieldBurst: "shield-burst",
  scanPulse: "scan-pulse",
  trap: "trap",
  decoy: "decoy",
} as const;

export const BATTLE_ROYALE_ABILITY_IDS = [
  BattleRoyaleAbility.dash,
  BattleRoyaleAbility.shieldBurst,
  BattleRoyaleAbility.scanPulse,
  BattleRoyaleAbility.trap,
  BattleRoyaleAbility.decoy,
] as const;

export const BattleRoyaleAbilityId = Schema.Literals(BATTLE_ROYALE_ABILITY_IDS);
export type BattleRoyaleAbilityId = typeof BattleRoyaleAbilityId.Type;

export const ZoneState = Schema.Struct({
  cx: Schema.Number,
  cy: Schema.Number,
  radius: Schema.Number,
});
export type ZoneState = typeof ZoneState.Type;

export const PlayerAnimationClipKey = Schema.Literals(REQUIRED_PLAYER_MODEL_CLIP_KEYS);
export type PlayerAnimationClipKey = typeof PlayerAnimationClipKey.Type;

export const PlayerAnimationState = Schema.Struct({
  modelId: Schema.String,
  clipKey: PlayerAnimationClipKey,
  facingDeg: Schema.Number,
  moving: Schema.Boolean,
  aimDeg: Schema.optional(Schema.Number),
});
export type PlayerAnimationState = typeof PlayerAnimationState.Type;

export const PlayerStatusSnapshot = Schema.Struct({
  effectId: Schema.String,
  remainingTicks: Schema.Int,
  stacks: Schema.Int,
});
export type PlayerStatusSnapshot = typeof PlayerStatusSnapshot.Type;

export const PlayerAbilityCooldownSnapshot = Schema.Struct({
  abilityId: Schema.String,
  remainingTicks: Schema.Int,
});
export type PlayerAbilityCooldownSnapshot = typeof PlayerAbilityCooldownSnapshot.Type;

export const PlayerArmorSnapshot = Schema.Struct({
  mitigation: Schema.Number,
  durability: Schema.Number,
});
export type PlayerArmorSnapshot = typeof PlayerArmorSnapshot.Type;

export const PlayerWeaponSnapshot = Schema.Struct({
  weaponId: Schema.String,
  slot: Schema.Int,
  ammoInMagazine: Schema.optional(Schema.Int),
  magazineSize: Schema.optional(Schema.Int),
  reserveAmmo: Schema.optional(Schema.Int),
  cooldownRemainingTicks: Schema.optional(Schema.Int),
  reloadRemainingTicks: Schema.optional(Schema.Int),
  reloadTotalTicks: Schema.optional(Schema.Int),
});
export type PlayerWeaponSnapshot = typeof PlayerWeaponSnapshot.Type;

export const PlayerInventorySnapshot = Schema.Struct({
  itemIds: Schema.Array(Schema.String),
  capacity: Schema.Int,
});
export type PlayerInventorySnapshot = typeof PlayerInventorySnapshot.Type;

export const PlayerPickupPromptSnapshot = Schema.Struct({
  itemKind: Schema.optional(Schema.String),
  tier: Schema.optional(Schema.String),
  distance: Schema.optional(Schema.Number),
  action: Schema.Literal("pickup-loot"),
  available: Schema.Boolean,
});
export type PlayerPickupPromptSnapshot = typeof PlayerPickupPromptSnapshot.Type;

export const PlayerPickupToastSnapshot = Schema.Struct({
  itemKind: Schema.String,
  tier: Schema.String,
  quantity: Schema.Int,
  tick: Schema.Int,
});
export type PlayerPickupToastSnapshot = typeof PlayerPickupToastSnapshot.Type;

export const PlayerDamageIndicatorSnapshot = Schema.Struct({
  sourceId: Schema.String,
  angleDeg: Schema.Number,
  amount: Schema.Number,
  tick: Schema.Int,
});
export type PlayerDamageIndicatorSnapshot = typeof PlayerDamageIndicatorSnapshot.Type;

export const PlayerStatsSnapshot = Schema.Struct({
  kills: Schema.Int,
  deaths: Schema.Int,
});
export type PlayerStatsSnapshot = typeof PlayerStatsSnapshot.Type;

export const PlayerSnapshot = Schema.Struct({
  id: PlayerId,
  team: Schema.optional(Schema.String),
  x: Schema.Number,
  y: Schema.Number,
  health: Schema.Number,
  shield: Schema.optional(Schema.Number),
  armor: Schema.optional(PlayerArmorSnapshot),
  weapon: Schema.optional(PlayerWeaponSnapshot),
  inventory: Schema.optional(PlayerInventorySnapshot),
  pickupPrompt: Schema.optional(PlayerPickupPromptSnapshot),
  pickupToast: Schema.optional(PlayerPickupToastSnapshot),
  damageIndicator: Schema.optional(PlayerDamageIndicatorSnapshot),
  stats: Schema.optional(PlayerStatsSnapshot),
  statusEffects: Schema.optional(Schema.Array(PlayerStatusSnapshot)),
  abilityCooldowns: Schema.optional(Schema.Array(PlayerAbilityCooldownSnapshot)),
  /** Per-player selected player-model id from runtime artifact assignment. */
  modelId: Schema.optional(Schema.String),
  /** Runtime-owned animation state; the renderer only resolves assets and draws. */
  animation: Schema.optional(PlayerAnimationState),
});
export type PlayerSnapshot = typeof PlayerSnapshot.Type;

export const PlayerUpdate = Schema.Struct({
  id: PlayerId,
  team: Schema.OptionFromOptional(Schema.String),
  x: Schema.OptionFromOptional(Schema.Number),
  y: Schema.OptionFromOptional(Schema.Number),
  health: Schema.OptionFromOptional(Schema.Number),
  shield: Schema.OptionFromOptional(Schema.Number),
  armor: Schema.OptionFromOptional(PlayerArmorSnapshot),
  weapon: Schema.OptionFromOptional(PlayerWeaponSnapshot),
  inventory: Schema.OptionFromOptional(PlayerInventorySnapshot),
  pickupPrompt: Schema.OptionFromOptional(PlayerPickupPromptSnapshot),
  pickupToast: Schema.OptionFromOptional(PlayerPickupToastSnapshot),
  damageIndicator: Schema.OptionFromOptional(PlayerDamageIndicatorSnapshot),
  stats: Schema.OptionFromOptional(PlayerStatsSnapshot),
  statusEffects: Schema.OptionFromOptional(Schema.Array(PlayerStatusSnapshot)),
  abilityCooldowns: Schema.OptionFromOptional(Schema.Array(PlayerAbilityCooldownSnapshot)),
  animation: Schema.OptionFromOptional(PlayerAnimationState),
});
export type PlayerUpdate = typeof PlayerUpdate.Type;

export class ProjectileSnapshot extends Schema.Class<ProjectileSnapshot>("ProjectileSnapshot")({
  id: ProjectileId,
  ownerPlayerId: PlayerId,
  weaponSlot: Schema.Int,
  x: Schema.Number,
  y: Schema.Number,
  vx: Schema.Number,
  vy: Schema.Number,
  rotation: Schema.Number,
  ttlMs: Schema.Int,
}) {}

export class ProjectileUpdate extends Schema.Class<ProjectileUpdate>("ProjectileUpdate")({
  id: ProjectileId,
  ownerPlayerId: Schema.OptionFromOptional(PlayerId),
  weaponSlot: Schema.OptionFromOptional(Schema.Int),
  x: Schema.OptionFromOptional(Schema.Number),
  y: Schema.OptionFromOptional(Schema.Number),
  vx: Schema.OptionFromOptional(Schema.Number),
  vy: Schema.OptionFromOptional(Schema.Number),
  rotation: Schema.OptionFromOptional(Schema.Number),
  ttlMs: Schema.OptionFromOptional(Schema.Int),
}) {}

export const DeployableKind = Schema.Literals(["trap", "decoy", "scan-pulse"] as const);
export type DeployableKind = typeof DeployableKind.Type;

export class DeployableSnapshot extends Schema.Class<DeployableSnapshot>("DeployableSnapshot")({
  id: DeployableId,
  kind: DeployableKind,
  ownerId: DeployableOwnerId,
  x: Schema.Number,
  y: Schema.Number,
  radius: Schema.Number,
  remainingTicks: Schema.Int,
  armedTicks: Schema.Int,
  triggered: Schema.Boolean,
}) {}

export class DeployableUpdate extends Schema.Class<DeployableUpdate>("DeployableUpdate")({
  id: DeployableId,
  kind: Schema.OptionFromOptional(DeployableKind),
  ownerId: Schema.OptionFromOptional(DeployableOwnerId),
  x: Schema.OptionFromOptional(Schema.Number),
  y: Schema.OptionFromOptional(Schema.Number),
  radius: Schema.OptionFromOptional(Schema.Number),
  remainingTicks: Schema.OptionFromOptional(Schema.Int),
  armedTicks: Schema.OptionFromOptional(Schema.Int),
  triggered: Schema.OptionFromOptional(Schema.Boolean),
}) {}

export const ObjectPickupSnapshot = Schema.Struct({
  itemKind: Schema.String,
  tier: Schema.String,
  quantity: Schema.Int,
  available: Schema.Boolean,
});
export type ObjectPickupSnapshot = typeof ObjectPickupSnapshot.Type;

export const ObjectLootSourceSnapshot = Schema.Struct({
  tableId: Schema.String,
  tier: Schema.String,
  weight: Schema.Number,
  collected: Schema.Boolean,
});
export type ObjectLootSourceSnapshot = typeof ObjectLootSourceSnapshot.Type;

export const ObjectInteractableSnapshot = Schema.Struct({
  action: Schema.String,
  radius: Schema.Number,
  enabled: Schema.Boolean,
});
export type ObjectInteractableSnapshot = typeof ObjectInteractableSnapshot.Type;

export const ObjectBreakableSnapshot = Schema.Struct({
  health: Schema.Number,
  maxHealth: Schema.Number,
  destroyed: Schema.Boolean,
});
export type ObjectBreakableSnapshot = typeof ObjectBreakableSnapshot.Type;

export const ObjectHazardSnapshot = Schema.Struct({
  damagePerSecond: Schema.Number,
  enabled: Schema.Boolean,
});
export type ObjectHazardSnapshot = typeof ObjectHazardSnapshot.Type;

export class ObjectSnapshot extends Schema.Class<ObjectSnapshot>("ObjectSnapshot")({
  id: ObjectId,
  x: Schema.Number,
  y: Schema.Number,
  pickup: Schema.optional(ObjectPickupSnapshot),
  lootSource: Schema.optional(ObjectLootSourceSnapshot),
  interactable: Schema.optional(ObjectInteractableSnapshot),
  breakable: Schema.optional(ObjectBreakableSnapshot),
  hazard: Schema.optional(ObjectHazardSnapshot),
}) {}

export class PlayerInput extends Schema.TaggedClass<PlayerInput>()("PlayerInput", {
  tick: Schema.Int,
  seq: Schema.Int,
  dir: Schema.OptionFromOptional(Direction8),
  shoot: Schema.Boolean,
  reload: Schema.Boolean,
  interact: Schema.Boolean,
  drop: Schema.Boolean,
  abilities: Schema.Array(BattleRoyaleAbilityId),
  aimDeg: Schema.OptionFromOptional(Schema.Int),
  swapSlot: Schema.OptionFromOptional(Schema.Int),
}) {}

export class Heartbeat extends Schema.TaggedClass<Heartbeat>()("Heartbeat", {
  tick: Schema.Int,
}) {}

export class SnapshotAck extends Schema.TaggedClass<SnapshotAck>()("SnapshotAck", {
  tick: Schema.Int,
  receivedAtMs: Schema.Number,
}) {}

export class WelcomeSnapshot extends Schema.TaggedClass<WelcomeSnapshot>()("WelcomeSnapshot", {
  tick: Schema.Int,
  serverTimestampMs: Schema.Number,
  seed: Schema.Union([Schema.String, Schema.Number]),
  players: Schema.Array(PlayerSnapshot),
  projectiles: Schema.Array(ProjectileSnapshot),
  deployables: Schema.optional(Schema.Array(DeployableSnapshot)),
  objects: Schema.optional(Schema.Array(ObjectSnapshot)),
  zone: ZoneState,
}) {}

export class DeltaSnapshot extends Schema.TaggedClass<DeltaSnapshot>()("DeltaSnapshot", {
  tick: Schema.Int,
  serverTimestampMs: Schema.Number,
  removed: Schema.Array(PlayerId),
  updated: Schema.Array(PlayerUpdate),
  projectilesUpdated: Schema.Array(ProjectileUpdate),
  projectilesRemoved: Schema.Array(ProjectileId),
  deployablesUpdated: Schema.optional(Schema.Array(DeployableUpdate)),
  deployablesRemoved: Schema.optional(Schema.Array(DeployableId)),
  objectsUpdated: Schema.optional(Schema.Array(ObjectSnapshot)),
  objectsRemoved: Schema.optional(Schema.Array(ObjectId)),
  zone: Schema.OptionFromOptional(ZoneState),
}) {}

export class PlayerJoined extends Schema.TaggedClass<PlayerJoined>()("PlayerJoined", {
  id: PlayerId,
}) {}

export class PlayerLeft extends Schema.TaggedClass<PlayerLeft>()("PlayerLeft", {
  id: PlayerId,
}) {}

export class PlayerKilled extends Schema.TaggedClass<PlayerKilled>()("PlayerKilled", {
  killer: PlayerId,
  victim: PlayerId,
  tick: Schema.Int,
}) {}

export class GameOver extends Schema.TaggedClass<GameOver>()("GameOver", {
  winner: PlayerId,
}) {}

export class WireError extends Schema.TaggedClass<WireError>()("Error", {
  code: Schema.String,
  message: Schema.String,
}) {}

export const ClientToServerMessage = Schema.Union([PlayerInput, Heartbeat, SnapshotAck]);
export type ClientToServerMessage = Schema.Schema.Type<typeof ClientToServerMessage>;

export const ServerToClientMessage = Schema.Union([
  WelcomeSnapshot,
  DeltaSnapshot,
  PlayerJoined,
  PlayerLeft,
  PlayerKilled,
  GameOver,
  WireError,
]);
export type ServerToClientMessage = Schema.Schema.Type<typeof ServerToClientMessage>;

export const BattleRoyaleMessage = Schema.Union([
  PlayerInput,
  Heartbeat,
  SnapshotAck,
  WelcomeSnapshot,
  DeltaSnapshot,
  PlayerJoined,
  PlayerLeft,
  PlayerKilled,
  GameOver,
  WireError,
]);
export type BattleRoyaleMessage = Schema.Schema.Type<typeof BattleRoyaleMessage>;

export class ProtocolError extends Schema.TaggedErrorClass<ProtocolError>()("ProtocolError", {
  message: Schema.String,
  cause: Schema.OptionFromOptional(Schema.Unknown),
}) {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const withLegacyServerTimestampDefault = (value: unknown): unknown => {
  if (
    isRecord(value) &&
    (value._tag === "WelcomeSnapshot" || value._tag === "DeltaSnapshot") &&
    typeof value.serverTimestampMs !== "number"
  ) {
    return {
      ...value,
      // Legacy local frames only carried tick; use it as a deterministic fallback
      // before schema validation while new frames keep serverTimestampMs required.
      serverTimestampMs: typeof value.tick === "number" ? value.tick : 0,
    };
  }
  return value;
};

export const encodeMessage = (message: BattleRoyaleMessage): Uint8Array => {
  const encoded = Schema.encodeUnknownSync(BattleRoyaleMessage)(message);
  return pack(encoded);
};

export const decodeMessage = (frame: Uint8Array): BattleRoyaleMessage => {
  const decoded = unpack(frame);
  return Schema.decodeUnknownSync(BattleRoyaleMessage)(withLegacyServerTimestampDefault(decoded));
};

export const encodeClientMessage = (message: ClientToServerMessage): Uint8Array =>
  encodeMessage(message);

export const decodeClientMessage = (frame: Uint8Array): ClientToServerMessage =>
  decodeMessage(frame) as ClientToServerMessage;

export const encodeServerMessage = (message: ServerToClientMessage): Uint8Array =>
  encodeMessage(message);

export const decodeServerMessage = (frame: Uint8Array): ServerToClientMessage =>
  decodeMessage(frame) as ServerToClientMessage;

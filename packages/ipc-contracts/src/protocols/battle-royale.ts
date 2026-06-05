import { Schema } from "effect";
import { pack, unpack } from "msgpackr";

// ADR-0014 Phase 1: snapshot frames carry required monotonic server timestamps
// so renderers can interpolate in server time while sampling with client clocks.
export const PlayerId = Schema.String.pipe(Schema.brand("PlayerId"));
export type PlayerId = typeof PlayerId.Type;

export const makePlayerId = (id: string): PlayerId => Schema.decodeUnknownSync(PlayerId)(id);

export const ProjectileId = Schema.String.pipe(Schema.brand("ProjectileId"));
export type ProjectileId = typeof ProjectileId.Type;

export const makeProjectileId = (id: string): ProjectileId => Schema.decodeUnknownSync(ProjectileId)(id);

/** Eight-way movement input: 0 = east, increasing clockwise. */
export const Direction8 = Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const);
export type Direction8 = typeof Direction8.Type;

export const ZoneState = Schema.Struct({
  cx: Schema.Number,
  cy: Schema.Number,
  radius: Schema.Number,
});
export type ZoneState = typeof ZoneState.Type;

export const PlayerSnapshot = Schema.Struct({
  id: PlayerId,
  x: Schema.Number,
  y: Schema.Number,
  health: Schema.Number,
  /**
   * Per-player selected player-model id (from the persisted lobby pick). Optional
   * for back-compat; the client projector resolves it to a renderable model, and
   * falls back to the BR default model when absent/unknown.
   */
  modelId: Schema.optional(Schema.String),
});
export type PlayerSnapshot = typeof PlayerSnapshot.Type;

export const PlayerUpdate = Schema.Struct({
  id: PlayerId,
  x: Schema.OptionFromOptional(Schema.Number),
  y: Schema.OptionFromOptional(Schema.Number),
  health: Schema.OptionFromOptional(Schema.Number),
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

export class PlayerInput extends Schema.TaggedClass<PlayerInput>()("PlayerInput", {
  tick: Schema.Int,
  seq: Schema.Int,
  dir: Schema.OptionFromOptional(Direction8),
  shoot: Schema.Boolean,
  aimDeg: Schema.OptionFromOptional(Schema.Int),
  weaponSlot: Schema.OptionFromOptional(Schema.Int),
}) {}

export class Heartbeat extends Schema.TaggedClass<Heartbeat>()("Heartbeat", {
  tick: Schema.Int,
}) {}

export class WelcomeSnapshot extends Schema.TaggedClass<WelcomeSnapshot>()("WelcomeSnapshot", {
  tick: Schema.Int,
  serverTimestampMs: Schema.Number,
  seed: Schema.Union([Schema.String, Schema.Number]),
  players: Schema.Array(PlayerSnapshot),
  projectiles: Schema.Array(ProjectileSnapshot),
  zone: ZoneState,
}) {}

export class DeltaSnapshot extends Schema.TaggedClass<DeltaSnapshot>()("DeltaSnapshot", {
  tick: Schema.Int,
  serverTimestampMs: Schema.Number,
  removed: Schema.Array(PlayerId),
  updated: Schema.Array(PlayerUpdate),
  projectilesUpdated: Schema.Array(ProjectileUpdate),
  projectilesRemoved: Schema.Array(ProjectileId),
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

export const ClientToServerMessage = Schema.Union([PlayerInput, Heartbeat]);
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

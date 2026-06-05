import { Schema } from "effect";
import { pack, unpack } from "msgpackr";

export const ArenaDirection8 = Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const);
export type ArenaDirection8 = typeof ArenaDirection8.Type;

export const ArenaEntityKind = Schema.Literals(["player", "dummy"] as const);
export type ArenaEntityKind = typeof ArenaEntityKind.Type;

export class ArenaEntitySnapshot extends Schema.Class<ArenaEntitySnapshot>("ArenaEntitySnapshot")({
  id: Schema.String,
  kind: ArenaEntityKind,
  x: Schema.Number,
  y: Schema.Number,
  health: Schema.Number,
  maxHealth: Schema.Number,
  headingDeg: Schema.Number,
}) {}

export class ArenaPlayerInput extends Schema.TaggedClass<ArenaPlayerInput>()("ArenaPlayerInput", {
  tick: Schema.Int,
  seq: Schema.Int,
  dir: Schema.OptionFromOptional(ArenaDirection8),
  shoot: Schema.Boolean,
  aimDeg: Schema.OptionFromOptional(Schema.Int),
}) {}

export class ArenaHeartbeat extends Schema.TaggedClass<ArenaHeartbeat>()("ArenaHeartbeat", {
  tick: Schema.Int,
}) {}

export class ArenaSnapshot extends Schema.TaggedClass<ArenaSnapshot>()("ArenaSnapshot", {
  tick: Schema.Int,
  serverTimestampMs: Schema.Number,
  entities: Schema.Array(ArenaEntitySnapshot),
}) {}

export class ArenaWireError extends Schema.TaggedClass<ArenaWireError>()("Error", {
  code: Schema.String,
  message: Schema.String,
}) {}

export const ArenaClientToServerMessage = Schema.Union([ArenaPlayerInput, ArenaHeartbeat]);
export type ArenaClientToServerMessage =
  typeof ArenaClientToServerMessage.Type;

export const ArenaServerToClientMessage = Schema.Union([ArenaSnapshot, ArenaWireError]);
export type ArenaServerToClientMessage =
  typeof ArenaServerToClientMessage.Type;

export const ArenaMessage = Schema.Union([
  ArenaPlayerInput,
  ArenaHeartbeat,
  ArenaSnapshot,
  ArenaWireError,
]);
export type ArenaMessage = typeof ArenaMessage.Type;

export const encodeArenaMessage = (message: ArenaMessage): Uint8Array => {
  const encoded = Schema.encodeUnknownSync(ArenaMessage)(message);
  return pack(encoded);
};

export const decodeArenaMessage = (frame: Uint8Array): ArenaMessage => {
  const decoded = unpack(frame);
  return Schema.decodeUnknownSync(ArenaMessage)(decoded);
};

export const encodeArenaClientMessage = (message: ArenaClientToServerMessage): Uint8Array =>
  encodeArenaMessage(message);

export const decodeArenaClientMessage = (frame: Uint8Array): ArenaClientToServerMessage =>
  decodeArenaMessage(frame) as ArenaClientToServerMessage;

export const encodeArenaServerMessage = (message: ArenaServerToClientMessage): Uint8Array =>
  encodeArenaMessage(message);

export const decodeArenaServerMessage = (frame: Uint8Array): ArenaServerToClientMessage =>
  decodeArenaMessage(frame) as ArenaServerToClientMessage;

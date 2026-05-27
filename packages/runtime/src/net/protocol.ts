/**
 * @deprecated for multiplayer hot path; only used by legacy RuntimeMessage clients,
 * game-host custom-plugin tests/smoke helpers, and non-Battle-Royale runtime callers.
 */
import { Schema } from "effect";
import { pack, unpack } from "msgpackr";

import { InputCommand } from "../input/input.js";

export const PROTOCOL_VERSION = 1;

const JsonValue = Schema.Json;
const OptionalJson = Schema.OptionFromOptional(JsonValue);
const OptionalJsonArray = Schema.OptionFromOptional(Schema.Array(JsonValue));
const OptionalString = Schema.OptionFromOptional(Schema.String);

export class Welcome extends Schema.TaggedClass<Welcome>()("Welcome", {
  entityId: Schema.String,
  slot: Schema.Int,
  mapWidth: Schema.Int,
  mapHeight: Schema.Int,
  snapshotHz: Schema.Int,
  seed: Schema.Union([Schema.String, Schema.Number]),
}) {}

export class ClientReady extends Schema.TaggedClass<ClientReady>()("ClientReady", {}) {}

export class InputBatch extends Schema.TaggedClass<InputBatch>()("InputBatch", {
  commands: Schema.Array(InputCommand),
}) {}

export class SnapshotFull extends Schema.TaggedClass<SnapshotFull>()("SnapshotFull", {
  players: OptionalJsonArray,
  pickups: OptionalJsonArray,
  decoys: OptionalJsonArray,
  safeZone: OptionalJson,
}) {}

export class SnapshotDelta extends Schema.TaggedClass<SnapshotDelta>()("SnapshotDelta", {
  tick: Schema.Int,
  baseTick: Schema.Int,
  diff: OptionalJsonArray,
}) {}

export class PlayerJoined extends Schema.TaggedClass<PlayerJoined>()("PlayerJoined", {
  playerId: Schema.String,
  displayName: OptionalString,
}) {}

export class PlayerLeft extends Schema.TaggedClass<PlayerLeft>()("PlayerLeft", {
  playerId: Schema.String,
  reason: Schema.String,
}) {}

export class WireInputCommand extends Schema.TaggedClass<WireInputCommand>()("InputCommand", {
  playerId: Schema.String,
  frame: Schema.Int,
  command: JsonValue,
}) {}

export class Heartbeat extends Schema.TaggedClass<Heartbeat>()("Heartbeat", {}) {}

export class WireError extends Schema.TaggedClass<WireError>()("Error", {
  code: Schema.Int,
  message: Schema.String,
}) {}

export class Events extends Schema.TaggedClass<Events>()("Events", {
  events: OptionalJsonArray,
}) {}

export class Ping extends Schema.TaggedClass<Ping>()("Ping", {
  sentAtMs: Schema.OptionFromOptional(Schema.Number),
}) {}

export class Pong extends Schema.TaggedClass<Pong>()("Pong", {
  sentAtMs: Schema.OptionFromOptional(Schema.Number),
}) {}

export class Chat extends Schema.TaggedClass<Chat>()("Chat", {
  text: Schema.String,
  playerId: OptionalString,
}) {}

export class MatchEnd extends Schema.TaggedClass<MatchEnd>()("MatchEnd", {
  winner: OptionalString,
  results: OptionalJsonArray,
}) {}

export class ServerNotice extends Schema.TaggedClass<ServerNotice>()("ServerNotice", {
  message: Schema.String,
}) {}

export class PlayerLoadouts extends Schema.TaggedClass<PlayerLoadouts>()("PlayerLoadouts", {
  skinIds: Schema.Array(Schema.String),
}) {}

export const RuntimeMessage = Schema.Union([
  Welcome,
  ClientReady,
  InputBatch,
  SnapshotFull,
  SnapshotDelta,
  Events,
  Ping,
  Pong,
  Chat,
  MatchEnd,
  ServerNotice,
  PlayerLoadouts,
  PlayerJoined,
  PlayerLeft,
  WireInputCommand,
  Heartbeat,
  WireError,
]);

export type RuntimeMessage = Schema.Schema.Type<typeof RuntimeMessage>;

export class ProtocolError extends Schema.TaggedErrorClass<ProtocolError>()("ProtocolError", {
  message: Schema.String,
  cause: Schema.OptionFromOptional(Schema.Unknown),
}) {}

export class TransportError extends Schema.TaggedErrorClass<TransportError>()("TransportError", {
  message: Schema.String,
  code: Schema.OptionFromOptional(Schema.Number),
  cause: Schema.OptionFromOptional(Schema.Unknown),
}) {}

export const encodeMessage = (message: RuntimeMessage): Uint8Array => {
  const encoded = Schema.encodeUnknownSync(RuntimeMessage)(message);
  return pack(encoded);
};

export const decodeMessage = (frame: Uint8Array): RuntimeMessage => {
  const decoded = unpack(frame);
  return Schema.decodeUnknownSync(RuntimeMessage)(decoded);
};

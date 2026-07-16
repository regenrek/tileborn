import { Schema } from 'effect';
import { pack, unpack } from 'msgpackr';

const JsonValue = Schema.Json;

export class RuntimeWireHeartbeat extends Schema.TaggedClass<RuntimeWireHeartbeat>()(
  'Heartbeat',
  {},
) {}

export class RuntimeWireInputCommand extends Schema.TaggedClass<RuntimeWireInputCommand>()(
  'InputCommand',
  {
    playerId: Schema.String,
    frame: Schema.Int,
    command: JsonValue,
  },
) {}

export class RuntimeWirePlayerJoined extends Schema.TaggedClass<RuntimeWirePlayerJoined>()(
  'PlayerJoined',
  {
    playerId: Schema.String,
  },
) {}

export class RuntimeWirePlayerLeft extends Schema.TaggedClass<RuntimeWirePlayerLeft>()(
  'PlayerLeft',
  {
    playerId: Schema.String,
    reason: Schema.String,
  },
) {}

export class RuntimeWireSnapshotDelta extends Schema.TaggedClass<RuntimeWireSnapshotDelta>()(
  'SnapshotDelta',
  {
    tick: Schema.Int,
    baseTick: Schema.Int,
    diff: Schema.optional(Schema.Array(JsonValue)),
  },
) {}

export class RuntimeWireSnapshotFull extends Schema.TaggedClass<RuntimeWireSnapshotFull>()(
  'SnapshotFull',
  {
    players: Schema.optional(Schema.Array(JsonValue)),
    pickups: Schema.optional(Schema.Array(JsonValue)),
    decoys: Schema.optional(Schema.Array(JsonValue)),
    safeZone: Schema.optional(JsonValue),
  },
) {}

const RuntimeWireMessage = Schema.Union([
  RuntimeWireHeartbeat,
  RuntimeWireInputCommand,
  RuntimeWirePlayerJoined,
  RuntimeWirePlayerLeft,
  RuntimeWireSnapshotDelta,
  RuntimeWireSnapshotFull,
]);

export type RuntimeWireMessage = Schema.Schema.Type<typeof RuntimeWireMessage>;

export const encodeRuntimeWireMessage = (message: RuntimeWireMessage): Uint8Array => {
  const encoded = Schema.encodeUnknownSync(RuntimeWireMessage)(message);
  return pack(encoded);
};

export const decodeRuntimeWireMessage = (frame: Uint8Array): RuntimeWireMessage => {
  const decoded = unpack(frame);
  return Schema.decodeUnknownSync(RuntimeWireMessage)(decoded);
};

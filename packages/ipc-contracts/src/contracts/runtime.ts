import { Schema } from "effect";

import { JsonObject, MapId, ProjectId } from "@tileborne/core";
import { Uint8ArraySchema } from "../bytes.js";
import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { BattleRoyaleAbilityId, Direction8 } from "../protocols/battle-royale-input.js";
import { PlaytestSessionId } from "./playtest.js";
import { EmptyRequest, EmptyResponse, IpcContractErrors } from "./common.js";

export const RuntimeStartLocalHostRequest = Schema.Struct({
  port: Schema.optional(Schema.Number),
});

export const RuntimeStartLocalHostResponse = Schema.Struct({
  baseUrl: Schema.String,
  signingKey: Schema.String,
});

export const RuntimeStopLocalHostRequest = EmptyRequest;
export const RuntimeStopLocalHostResponse = EmptyResponse;

export const RuntimePrepareLocalRoomArtifactRequest = Schema.Struct({
  projectId: ProjectId,
  mapId: MapId,
  selectedPlayerModelId: Schema.optional(Schema.String),
});

export const RuntimePlayerModelSelection = Schema.Struct({
  playerId: Schema.String,
  modelId: Schema.String,
});

export const RuntimePrepareLocalRoomArtifactResponse = Schema.Struct({
  mapId: MapId,
  /** Encoded `RuntimeMapPackage` wire JSON the room boots from (ADR-0030). */
  mapPackage: JsonObject,
  /** Per-session player→model selections; the package carries none. */
  playerModelSelections: Schema.Array(RuntimePlayerModelSelection),
});

export const RuntimeStartLocalHostContract = defineContract({
  channel: "tileborne:runtime:startLocalHost",
  request: RuntimeStartLocalHostRequest,
  response: RuntimeStartLocalHostResponse,
  errors: IpcContractErrors,
});

export const RuntimeStopLocalHostContract = defineContract({
  channel: "tileborne:runtime:stopLocalHost",
  request: RuntimeStopLocalHostRequest,
  response: RuntimeStopLocalHostResponse,
  errors: IpcContractErrors,
});

export const RuntimePrepareLocalRoomArtifactContract = defineContract({
  channel: "tileborne:runtime:prepareLocalRoomArtifact",
  request: RuntimePrepareLocalRoomArtifactRequest,
  response: RuntimePrepareLocalRoomArtifactResponse,
  errors: IpcContractErrors,
});

export const RuntimePlaytestInputRequest = Schema.Struct({
  sessionId: PlaytestSessionId,
  playerId: Schema.optional(Schema.String),
  tick: Schema.Int,
  seq: Schema.Int,
  dir: Schema.optional(Direction8),
  shoot: Schema.Boolean,
  reload: Schema.Boolean,
  interact: Schema.Boolean,
  drop: Schema.Boolean,
  abilities: Schema.Array(BattleRoyaleAbilityId),
  aimDeg: Schema.optional(Schema.Int),
  swapSlot: Schema.optional(Schema.Int),
  active: Schema.optional(Schema.Boolean),
});

export const RuntimePlaytestInputResponse = EmptyResponse;

export const RuntimePlaytestSnapshotRequest = Schema.Struct({
  sessionId: PlaytestSessionId,
});

export const RuntimePlaytestSnapshotPlayer = Schema.Struct({
  playerId: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
});

export const RuntimePlaytestSnapshotResponse = Schema.Struct({
  players: Schema.Array(RuntimePlaytestSnapshotPlayer),
  frame: Schema.optional(Uint8ArraySchema),
});

export const RuntimePlaytestInputContract = defineContract({
  channel: "tileborne:runtime:playtestInput",
  request: RuntimePlaytestInputRequest,
  response: RuntimePlaytestInputResponse,
  errors: IpcContractErrors,
});

export const RuntimePlaytestSnapshotContract = defineContract({
  channel: "tileborne:runtime:playtestSnapshot",
  request: RuntimePlaytestSnapshotRequest,
  response: RuntimePlaytestSnapshotResponse,
  errors: IpcContractErrors,
});

export const RuntimeContracts = [
  RuntimeStartLocalHostContract,
  RuntimeStopLocalHostContract,
  RuntimePrepareLocalRoomArtifactContract,
  RuntimePlaytestInputContract,
  RuntimePlaytestSnapshotContract,
] as const;

export const RuntimeIpcRegistry = createRegistry(RuntimeContracts);

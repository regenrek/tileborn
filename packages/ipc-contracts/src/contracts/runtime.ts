import { Schema } from "effect";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { Direction8 } from "../protocols/battle-royale.js";
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

export const RuntimePlaytestInputRequest = Schema.Struct({
  sessionId: PlaytestSessionId,
  playerId: Schema.optional(Schema.String),
  tick: Schema.Int,
  seq: Schema.Int,
  dir: Direction8,
  shoot: Schema.Boolean,
  aimDeg: Schema.optional(Schema.Int),
  weaponSlot: Schema.optional(Schema.Int),
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
  RuntimePlaytestInputContract,
  RuntimePlaytestSnapshotContract,
] as const;

export const RuntimeIpcRegistry = createRegistry(RuntimeContracts);

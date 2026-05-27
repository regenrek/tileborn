import { Schema } from "effect";

import { MapId, ProjectId } from "@tileborne/core";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { IpcContractErrors } from "./common.js";

export const PlaytestSessionId = Schema.String.check(
  Schema.isPattern(/^playtest:[0-9a-f-]{36}$/),
).pipe(Schema.brand("PlaytestSessionId"));

export const PlaytestSessionStatus = Schema.Union([
  Schema.Literal("Starting"),
  Schema.Literal("Running"),
  Schema.Literal("Stopped"),
]);

export const PlaytestRuntimeZonePhase = Schema.Literals([
  "stable",
  "countdown",
  "shrinking",
] as const);

export const PlaytestRuntimeZoneStatus = Schema.Struct({
  phase: PlaytestRuntimeZonePhase,
  secondsRemaining: Schema.optional(Schema.Number),
});

export const PlaytestRuntimeLocalPlayer = Schema.Struct({
  playerId: Schema.String,
  displayName: Schema.String,
  health: Schema.Number,
  maxHealth: Schema.Number,
});

export const PlaytestRuntimeHudEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("PlayerKilled"),
    victimId: Schema.String,
    victimDisplayName: Schema.String,
    killerId: Schema.String,
    tick: Schema.Int,
    emittedAtMs: Schema.Number,
  }),
  Schema.Struct({
    _tag: Schema.Literal("GameOver"),
    winnerId: Schema.String,
    winnerDisplayName: Schema.String,
    alivePlayers: Schema.Int,
    totalPlayers: Schema.Int,
    tickCount: Schema.Int,
    emittedAtMs: Schema.Number,
  }),
]);

export const PlaytestRuntimeGameOver = Schema.Struct({
  winnerId: Schema.String,
  winnerDisplayName: Schema.String,
  alivePlayers: Schema.Int,
  totalPlayers: Schema.Int,
  tickCount: Schema.Int,
});

export const PlaytestRuntimeHud = Schema.Struct({
  totalPlayers: Schema.Number,
  localPlayer: Schema.optional(PlaytestRuntimeLocalPlayer),
  zoneStatus: Schema.optional(PlaytestRuntimeZoneStatus),
  recentEvents: Schema.Array(PlaytestRuntimeHudEvent),
  gameOver: Schema.optional(PlaytestRuntimeGameOver),
});

export const PlaytestRuntimeMetrics = Schema.Struct({
  tickCount: Schema.Number,
  playerCount: Schema.Number,
  lastPluginEvent: Schema.String,
  lastTickAtMs: Schema.Number,
  hud: Schema.optional(PlaytestRuntimeHud),
});

export const PlaytestSessionView = Schema.Struct({
  id: PlaytestSessionId,
  projectId: ProjectId,
  mapId: MapId,
  status: PlaytestSessionStatus,
  artifactDirectory: Schema.optional(Schema.String),
  activePlugins: Schema.optional(Schema.Array(Schema.String)),
  runtimeMetrics: Schema.optional(PlaytestRuntimeMetrics),
});

export const PlaytestStartRequest = Schema.Struct({
  projectId: ProjectId,
  mapId: MapId,
});
export const PlaytestStartResponse = Schema.Struct({
  session: PlaytestSessionView,
});

export const PlaytestStopRequest = Schema.Struct({
  sessionId: PlaytestSessionId,
});
export const PlaytestStopResponse = Schema.Struct({
  session: PlaytestSessionView,
});

export const PlaytestListRequest = Schema.Struct({});
export const PlaytestListResponse = Schema.Struct({
  sessions: Schema.Array(PlaytestSessionView),
});

export const PlaytestStartContract = defineContract({
  channel: "tileborne:playtest:start",
  request: PlaytestStartRequest,
  response: PlaytestStartResponse,
  errors: IpcContractErrors,
});

export const PlaytestStopContract = defineContract({
  channel: "tileborne:playtest:stop",
  request: PlaytestStopRequest,
  response: PlaytestStopResponse,
  errors: IpcContractErrors,
});

export const PlaytestListContract = defineContract({
  channel: "tileborne:playtest:list",
  request: PlaytestListRequest,
  response: PlaytestListResponse,
  errors: IpcContractErrors,
});

export const PlaytestContracts = [
  PlaytestStartContract,
  PlaytestStopContract,
  PlaytestListContract,
] as const;

export const PlaytestIpcRegistry = createRegistry(PlaytestContracts);

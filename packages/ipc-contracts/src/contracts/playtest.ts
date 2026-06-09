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

export const PlaytestRuntimeStatusEffect = Schema.Struct({
  effectId: Schema.String,
  remainingTicks: Schema.Int,
  stacks: Schema.Int,
});

export const PlaytestRuntimeAbilityCooldown = Schema.Struct({
  abilityId: Schema.String,
  remainingTicks: Schema.Int,
});

export const PlaytestRuntimeArmor = Schema.Struct({
  mitigation: Schema.Number,
  durability: Schema.Number,
});

export const PlaytestRuntimeWeapon = Schema.Struct({
  weaponId: Schema.String,
  slot: Schema.Int,
  ammoInMagazine: Schema.optional(Schema.Int),
  magazineSize: Schema.optional(Schema.Int),
  reserveAmmo: Schema.optional(Schema.Int),
  cooldownRemainingTicks: Schema.optional(Schema.Int),
  reloadRemainingTicks: Schema.optional(Schema.Int),
  reloadTotalTicks: Schema.optional(Schema.Int),
});

export const PlaytestRuntimeInventory = Schema.Struct({
  itemIds: Schema.Array(Schema.String),
  capacity: Schema.Int,
});

export const PlaytestRuntimePickupPrompt = Schema.Struct({
  itemKind: Schema.optional(Schema.String),
  tier: Schema.optional(Schema.String),
  distance: Schema.optional(Schema.Number),
  action: Schema.Literal("pickup-loot"),
  available: Schema.Boolean,
});

export const PlaytestRuntimePickupToast = Schema.Struct({
  itemKind: Schema.String,
  tier: Schema.String,
  quantity: Schema.Int,
  tick: Schema.Int,
});

export const PlaytestRuntimeDamageIndicator = Schema.Struct({
  sourceId: Schema.String,
  angleDeg: Schema.Number,
  amount: Schema.Number,
  tick: Schema.Int,
});

export const PlaytestRuntimePlayerStats = Schema.Struct({
  kills: Schema.Int,
  deaths: Schema.Int,
});

export const PlaytestRuntimeLocalPlayer = Schema.Struct({
  playerId: Schema.String,
  displayName: Schema.String,
  team: Schema.optional(Schema.String),
  health: Schema.Number,
  maxHealth: Schema.Number,
  position: Schema.optional(Schema.Struct({ x: Schema.Number, y: Schema.Number })),
  shield: Schema.optional(Schema.Number),
  armor: Schema.optional(PlaytestRuntimeArmor),
  weapon: Schema.optional(PlaytestRuntimeWeapon),
  inventory: Schema.optional(PlaytestRuntimeInventory),
  pickupPrompt: Schema.optional(PlaytestRuntimePickupPrompt),
  pickupToast: Schema.optional(PlaytestRuntimePickupToast),
  damageIndicator: Schema.optional(PlaytestRuntimeDamageIndicator),
  stats: Schema.optional(PlaytestRuntimePlayerStats),
  statusEffects: Schema.optional(Schema.Array(PlaytestRuntimeStatusEffect)),
  abilityCooldowns: Schema.optional(Schema.Array(PlaytestRuntimeAbilityCooldown)),
});

export const PlaytestRuntimeScoreboardEntry = Schema.Struct({
  playerId: Schema.String,
  displayName: Schema.String,
  team: Schema.optional(Schema.String),
  health: Schema.Number,
  alive: Schema.Boolean,
  kills: Schema.Int,
  deaths: Schema.Int,
});

export const PlaytestRuntimeMinimap = Schema.Struct({
  zone: Schema.optional(Schema.Struct({ cx: Schema.Number, cy: Schema.Number, radius: Schema.Number })),
  players: Schema.Array(
    Schema.Struct({
      playerId: Schema.String,
      x: Schema.Number,
      y: Schema.Number,
      local: Schema.Boolean,
      alive: Schema.Boolean,
      health: Schema.Number,
    }),
  ),
  objects: Schema.Array(
    Schema.Struct({
      objectId: Schema.String,
      x: Schema.Number,
      y: Schema.Number,
      kind: Schema.Literals(["pickup", "loot", "hazard", "objective"] as const),
      tier: Schema.optional(Schema.String),
      available: Schema.optional(Schema.Boolean),
    }),
  ),
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
    _tag: Schema.Literal("PickupCollected"),
    playerId: Schema.String,
    playerDisplayName: Schema.String,
    itemKind: Schema.String,
    tier: Schema.String,
    quantity: Schema.Int,
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
  scoreboard: Schema.optional(Schema.Array(PlaytestRuntimeScoreboardEntry)),
  minimap: Schema.optional(PlaytestRuntimeMinimap),
  recentEvents: Schema.Array(PlaytestRuntimeHudEvent),
  gameOver: Schema.optional(PlaytestRuntimeGameOver),
});

export const PlaytestRuntimeTelemetryDiagnostics = Schema.Struct({
  tickRate: Schema.Number,
  tickBudgetMs: Schema.Number,
  lastTickDurationMs: Schema.Number,
  averageTickDurationMs: Schema.Number,
  maxTickDurationMs: Schema.Number,
  overBudgetTickCount: Schema.Int,
  uptimeMs: Schema.Number,
  inputLatencyTicks: Schema.Number,
  maxInputLatencyTicks: Schema.Number,
  backpressureFrameCount: Schema.Int,
  errorCount: Schema.Int,
  lastError: Schema.optional(Schema.String),
});

export const PlaytestRuntimeBandwidthDiagnostics = Schema.Struct({
  snapshotFrames: Schema.Int,
  eventFrames: Schema.Int,
  unknownFrames: Schema.Int,
  totalFrameBytes: Schema.Int,
  lastFrameBytes: Schema.Int,
  maxFrameBytes: Schema.Int,
  averageFrameBytes: Schema.Number,
  inputEvents: Schema.Int,
  inputBytes: Schema.Int,
  lastInputBytes: Schema.Int,
  pendingSnapshotFrames: Schema.Int,
});

export const PlaytestRuntimeReplayDiagnostics = Schema.Struct({
  inputFrames: Schema.Int,
  snapshotFrames: Schema.Int,
  eventFrames: Schema.Int,
  byteSize: Schema.Int,
  rollingHash: Schema.String,
  recorderStatus: Schema.Literal("recording"),
  deterministicVerifier: Schema.Literal("battle-royale-replay-harness"),
});

export const PlaytestRuntimeEntityDiagnostics = Schema.Struct({
  aliveEntities: Schema.Int,
  players: Schema.Int,
  alivePlayers: Schema.Int,
  projectiles: Schema.Int,
  pickups: Schema.Int,
  lootSources: Schema.Int,
  collisionBodies: Schema.Int,
  visionBlockers: Schema.Int,
  hitboxes: Schema.Int,
  deployables: Schema.Int,
  hazards: Schema.Int,
  zones: Schema.Int,
});

export const PlaytestRuntimeDebugOverlayDiagnostics = Schema.Struct({
  collision: Schema.Int,
  lineOfSight: Schema.Int,
  hitboxes: Schema.Int,
  projectiles: Schema.Int,
  spawnSlots: Schema.Int,
  lootRolls: Schema.Int,
  zone: Schema.Int,
});

export const PlaytestRuntimeBudgetDiagnostics = Schema.Struct({
  tickOverBudget: Schema.Boolean,
  snapshotOverBudget: Schema.Boolean,
  backpressureOverBudget: Schema.Boolean,
  snapshotFrameBudgetBytes: Schema.Int,
  inputBacklogBudgetFrames: Schema.Int,
});

export const PlaytestRuntimeDiagnostics = Schema.Struct({
  telemetry: PlaytestRuntimeTelemetryDiagnostics,
  bandwidth: PlaytestRuntimeBandwidthDiagnostics,
  replay: PlaytestRuntimeReplayDiagnostics,
  entities: PlaytestRuntimeEntityDiagnostics,
  debugOverlay: PlaytestRuntimeDebugOverlayDiagnostics,
  budgets: PlaytestRuntimeBudgetDiagnostics,
});

export const PlaytestRuntimeMetrics = Schema.Struct({
  tickCount: Schema.Number,
  playerCount: Schema.Number,
  lastPluginEvent: Schema.String,
  lastTickAtMs: Schema.Number,
  hud: Schema.optional(PlaytestRuntimeHud),
  diagnostics: Schema.optional(PlaytestRuntimeDiagnostics),
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
  selectedPlayerModelId: Schema.optional(Schema.String),
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

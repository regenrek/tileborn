import { gameObjectTypeIdForKey } from '@tileborne/core';
import { decodeServerMessage } from '@tileborne/ipc-contracts/protocols/battle-royale';

import type { PlaytestPluginWorld } from './playtest-plugin-world.js';

export interface PlaytestRuntimeInputTelemetry {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: number;
  readonly shoot: boolean;
  readonly reload: boolean;
  readonly interact: boolean;
  readonly drop: boolean;
  readonly abilities: readonly string[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}

export interface PlaytestRuntimeTelemetryDiagnostics {
  readonly tickRate: number;
  readonly tickBudgetMs: number;
  readonly lastTickDurationMs: number;
  readonly averageTickDurationMs: number;
  readonly maxTickDurationMs: number;
  readonly overBudgetTickCount: number;
  readonly uptimeMs: number;
  readonly inputLatencyTicks: number;
  readonly maxInputLatencyTicks: number;
  readonly backpressureFrameCount: number;
  readonly errorCount: number;
  readonly lastError?: string;
}

export interface PlaytestRuntimeBandwidthDiagnostics {
  readonly snapshotFrames: number;
  readonly eventFrames: number;
  readonly unknownFrames: number;
  readonly totalFrameBytes: number;
  readonly lastFrameBytes: number;
  readonly maxFrameBytes: number;
  readonly averageFrameBytes: number;
  readonly inputEvents: number;
  readonly inputBytes: number;
  readonly lastInputBytes: number;
  readonly pendingSnapshotFrames: number;
}

export interface PlaytestRuntimeReplayDiagnostics {
  readonly inputFrames: number;
  readonly snapshotFrames: number;
  readonly eventFrames: number;
  readonly byteSize: number;
  readonly rollingHash: string;
  readonly recorderStatus: 'recording';
  readonly deterministicVerifier: 'battle-royale-replay-harness';
}

export interface PlaytestRuntimeEntityDiagnostics {
  readonly aliveEntities: number;
  readonly players: number;
  readonly alivePlayers: number;
  readonly projectiles: number;
  readonly pickups: number;
  readonly lootSources: number;
  readonly collisionBodies: number;
  readonly visionBlockers: number;
  readonly hitboxes: number;
  readonly deployables: number;
  readonly hazards: number;
  readonly zones: number;
}

export interface PlaytestRuntimeDebugOverlayDiagnostics {
  readonly collision: number;
  readonly lineOfSight: number;
  readonly hitboxes: number;
  readonly projectiles: number;
  readonly spawnSlots: number;
  readonly lootRolls: number;
  readonly zone: number;
}

export interface PlaytestRuntimeBudgetDiagnostics {
  readonly tickOverBudget: boolean;
  readonly snapshotOverBudget: boolean;
  readonly backpressureOverBudget: boolean;
  readonly snapshotFrameBudgetBytes: number;
  readonly inputBacklogBudgetFrames: number;
}

export interface PlaytestRuntimeDiagnostics {
  readonly telemetry: PlaytestRuntimeTelemetryDiagnostics;
  readonly bandwidth: PlaytestRuntimeBandwidthDiagnostics;
  readonly replay: PlaytestRuntimeReplayDiagnostics;
  readonly entities: PlaytestRuntimeEntityDiagnostics;
  readonly debugOverlay: PlaytestRuntimeDebugOverlayDiagnostics;
  readonly budgets: PlaytestRuntimeBudgetDiagnostics;
}

export interface PlaytestRuntimeDiagnosticsRecorder {
  /** Record the encoded `RuntimeMapPackage` the session's plugin booted from. */
  readonly recordMapPackage: (mapPackage: unknown) => void;
  readonly recordInput: (
    playerId: string,
    input: PlaytestRuntimeInputTelemetry,
    currentTick: number,
  ) => void;
  readonly recordPluginFrame: (frame: Uint8Array) => void;
  readonly recordTick: (durationMs: number) => void;
  readonly recordError: (message: string) => void;
  readonly snapshot: (options: {
    readonly world: PlaytestPluginWorld;
    readonly pendingSnapshotFrames: number;
  }) => PlaytestRuntimeDiagnostics;
}

const SNAPSHOT_FRAME_BUDGET_BYTES = 8_192;
const INPUT_BACKLOG_BUDGET_FRAMES = 8;
const HASH_OFFSET = 0x811c9dc5;
const HASH_PRIME = 0x01000193;

const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const updateHash = (hash: number, bytes: Uint8Array): number => {
  let next = hash;
  for (const byte of bytes) {
    next = Math.imul(next ^ byte, HASH_PRIME) >>> 0;
  }
  return next;
};

const encodeStable = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));

const countComponent = (world: PlaytestPluginWorld, componentName: string): number => {
  try {
    return Array.from(world.getComponent(componentName).entries()).length;
  } catch {
    return 0;
  }
};

const countAlivePlayers = (world: PlaytestPluginWorld): number => {
  try {
    let count = 0;
    for (const [, player] of world.getComponent<{ alive: number }>('Player').entries()) {
      if (player.alive === 1) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
};

const summarizeEntities = (world: PlaytestPluginWorld): PlaytestRuntimeEntityDiagnostics => ({
  aliveEntities: world.aliveEntities().length,
  players: countComponent(world, 'Player'),
  alivePlayers: countAlivePlayers(world),
  projectiles: countComponent(world, 'Projectile'),
  pickups: countComponent(world, 'Pickup'),
  lootSources: countComponent(world, 'LootSource'),
  collisionBodies: countComponent(world, 'CollisionBody'),
  visionBlockers: countComponent(world, 'VisionBlocker'),
  hitboxes: countComponent(world, 'Hitbox'),
  deployables: countComponent(world, 'Deployable'),
  hazards: countComponent(world, 'Hazard'),
  zones: countComponent(world, 'Zone'),
});

const classifyFrame = (frame: Uint8Array): 'snapshot' | 'event' | 'unknown' => {
  try {
    const message = decodeServerMessage(frame);
    if (message._tag === 'WelcomeSnapshot' || message._tag === 'DeltaSnapshot') {
      return 'snapshot';
    }
    if (
      message._tag === 'PlayerJoined' ||
      message._tag === 'PlayerLeft' ||
      message._tag === 'PlayerKilled' ||
      message._tag === 'GameOver' ||
      message._tag === 'Error'
    ) {
      return 'event';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * Summarize the encoded package's authored content: spawn/zone/loot counts
 * come from the NEUTRAL sections only — placements matched against the
 * catalog's `spawn-point` / `loot-source` components and well-known type ids.
 * `modeData` is engine-opaque and never read here (M2 review, N3).
 */
const summarizeMapPackage = (mapPackage: unknown) => {
  if (!isRecord(mapPackage)) {
    return { spawnSlots: 0, lootRolls: 0, zoneAnchors: 0 };
  }
  const catalog = Array.isArray(mapPackage.catalog) ? mapPackage.catalog.filter(isRecord) : [];
  const typeIdsWithComponent = (tag: string): ReadonlySet<string> =>
    new Set(
      catalog
        .filter((entry) => {
          const objectType = entry.objectType;
          return (
            isRecord(objectType) &&
            Array.isArray(objectType.components) &&
            objectType.components.some((component) => isRecord(component) && component._tag === tag)
          );
        })
        .map((entry) => String(isRecord(entry.objectType) ? entry.objectType.id : '')),
    );
  const spawnTypeIds = typeIdsWithComponent('spawn-point');
  const lootTypeIds = typeIdsWithComponent('loot-source');
  const placements = Array.isArray(mapPackage.placements)
    ? mapPackage.placements.filter(isRecord)
    : [];
  const placementsOf = (typeIds: ReadonlySet<string>): number =>
    placements.filter((placement) => typeIds.has(String(placement.typeId))).length;
  const zoneAnchors = placements.filter(
    (placement) => String(placement.typeId) === gameObjectTypeIdForKey('shrink-zone-anchor'),
  ).length;

  return {
    spawnSlots: placementsOf(spawnTypeIds),
    lootRolls: placementsOf(lootTypeIds),
    zoneAnchors,
  };
};

export const createPlaytestRuntimeDiagnosticsRecorder = (options: {
  readonly tickRate: number;
  readonly tickBudgetMs: number;
}): PlaytestRuntimeDiagnosticsRecorder => {
  const startedAtMs = Date.now();
  let packageCounts = {
    spawnSlots: 0,
    lootRolls: 0,
    zoneAnchors: 0,
  };
  let lastTickDurationMs = 0;
  let totalTickDurationMs = 0;
  let tickSamples = 0;
  let maxTickDurationMs = 0;
  let overBudgetTickCount = 0;
  let snapshotFrames = 0;
  let eventFrames = 0;
  let unknownFrames = 0;
  let totalFrameBytes = 0;
  let lastFrameBytes = 0;
  let maxFrameBytes = 0;
  let inputEvents = 0;
  let inputBytes = 0;
  let lastInputBytes = 0;
  let totalInputLatencyTicks = 0;
  let maxInputLatencyTicks = 0;
  let errorCount = 0;
  let lastError: string | undefined;
  let rollingHash = HASH_OFFSET;

  const recordBytes = (kind: string, bytes: Uint8Array): void => {
    rollingHash = updateHash(rollingHash, encoder.encode(kind));
    rollingHash = updateHash(rollingHash, bytes);
  };

  return {
    recordMapPackage: (mapPackage): void => {
      packageCounts = summarizeMapPackage(mapPackage);
      recordBytes('map-package', encodeStable(packageCounts));
    },
    recordInput: (playerId, input, currentTick): void => {
      const latencyTicks = Math.max(0, currentTick - input.tick);
      const bytes = encodeStable({
        abilities: [...input.abilities],
        aimDeg: input.aimDeg,
        dir: input.dir,
        drop: input.drop,
        interact: input.interact,
        playerId,
        reload: input.reload,
        seq: input.seq,
        shoot: input.shoot,
        swapSlot: input.swapSlot,
        tick: input.tick,
      });
      inputEvents += 1;
      lastInputBytes = bytes.byteLength;
      inputBytes += bytes.byteLength;
      totalInputLatencyTicks += latencyTicks;
      maxInputLatencyTicks = Math.max(maxInputLatencyTicks, latencyTicks);
      recordBytes('input', bytes);
    },
    recordPluginFrame: (frame): void => {
      const classification = classifyFrame(frame);
      if (classification === 'snapshot') {
        snapshotFrames += 1;
      } else if (classification === 'event') {
        eventFrames += 1;
      } else {
        unknownFrames += 1;
      }
      lastFrameBytes = frame.byteLength;
      totalFrameBytes += frame.byteLength;
      maxFrameBytes = Math.max(maxFrameBytes, frame.byteLength);
      recordBytes(classification, frame);
    },
    recordTick: (durationMs): void => {
      lastTickDurationMs = durationMs;
      totalTickDurationMs += durationMs;
      tickSamples += 1;
      maxTickDurationMs = Math.max(maxTickDurationMs, durationMs);
      if (durationMs > options.tickBudgetMs) {
        overBudgetTickCount += 1;
      }
    },
    recordError: (message): void => {
      errorCount += 1;
      lastError = message;
      recordBytes('error', encoder.encode(message));
    },
    snapshot: ({ world, pendingSnapshotFrames }): PlaytestRuntimeDiagnostics => {
      const entities = summarizeEntities(world);
      const averageTickDurationMs = tickSamples === 0 ? 0 : totalTickDurationMs / tickSamples;
      const averageFrameBytes =
        snapshotFrames + eventFrames + unknownFrames === 0
          ? 0
          : totalFrameBytes / (snapshotFrames + eventFrames + unknownFrames);
      const inputLatencyTicks = inputEvents === 0 ? 0 : totalInputLatencyTicks / inputEvents;
      const backpressureFrameCount = pendingSnapshotFrames;

      return {
        telemetry: {
          tickRate: options.tickRate,
          tickBudgetMs: options.tickBudgetMs,
          lastTickDurationMs,
          averageTickDurationMs,
          maxTickDurationMs,
          overBudgetTickCount,
          uptimeMs: Date.now() - startedAtMs,
          inputLatencyTicks,
          maxInputLatencyTicks,
          backpressureFrameCount,
          errorCount,
          ...(lastError === undefined ? {} : { lastError }),
        },
        bandwidth: {
          snapshotFrames,
          eventFrames,
          unknownFrames,
          totalFrameBytes,
          lastFrameBytes,
          maxFrameBytes,
          averageFrameBytes,
          inputEvents,
          inputBytes,
          lastInputBytes,
          pendingSnapshotFrames,
        },
        replay: {
          inputFrames: inputEvents,
          snapshotFrames,
          eventFrames,
          byteSize: inputBytes + totalFrameBytes,
          rollingHash: `fnv1a:${rollingHash.toString(16).padStart(8, '0')}`,
          recorderStatus: 'recording',
          deterministicVerifier: 'battle-royale-replay-harness',
        },
        entities,
        debugOverlay: {
          collision: entities.collisionBodies,
          lineOfSight: entities.visionBlockers,
          hitboxes: entities.hitboxes,
          projectiles: entities.projectiles,
          spawnSlots: Math.max(packageCounts.spawnSlots, entities.players),
          lootRolls: Math.max(packageCounts.lootRolls, entities.lootSources),
          zone: Math.max(packageCounts.zoneAnchors, entities.zones),
        },
        budgets: {
          tickOverBudget: lastTickDurationMs > options.tickBudgetMs,
          snapshotOverBudget: maxFrameBytes > SNAPSHOT_FRAME_BUDGET_BYTES,
          backpressureOverBudget: backpressureFrameCount > INPUT_BACKLOG_BUDGET_FRAMES,
          snapshotFrameBudgetBytes: SNAPSHOT_FRAME_BUDGET_BYTES,
          inputBacklogBudgetFrames: INPUT_BACKLOG_BUDGET_FRAMES,
        },
      };
    },
  };
};

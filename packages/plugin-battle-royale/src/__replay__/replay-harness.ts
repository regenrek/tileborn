import { MapObject, gameObjectTypeIdForKey, makeTileborneMap } from "@tileborne/core";
import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
import { createHash } from "node:crypto";
import { Option } from "effect";

import { SPAWN_POINT_KIND } from "../constants.js";
import { DEFAULT_BATTLE_ROYALE_CONFIG } from "../battle-royale-config.js";
import {
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  type Player,
  type PlayerStats,
  type Position,
} from "../ecs/components.js";
import { getZone, resetZoneSingleton } from "../ecs/zone.js";
import { exportArtifact } from "../export-artifact.js";
import type { ExportedArtifact } from "../types/artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "../id-utils.js";
import { TEST_PLAYER_MODELS } from "../test-player-model.js";
import { createRuntimeAdapter } from "../runtime-adapter.js";
import type { RuntimePlayerInput } from "../types/runtime-plugin.js";
import { createTestPluginWorld } from "../test-plugin-world.js";

export type Direction8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface InputLogEntry {
  readonly tick: number;
  readonly playerId: string;
  readonly dir: Direction8;
  readonly shoot: boolean;
}

export interface ReplayPlayerSnapshot {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly alive: 0 | 1;
  readonly kills: number;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly zoneRadius: number;
  readonly players: readonly ReplayPlayerSnapshot[];
}

export interface ReplayRunResult {
  readonly snapshots: readonly WorldSnapshot[];
  readonly finalSnapshot: WorldSnapshot;
  readonly snapshotBytes: Uint8Array;
  readonly finalSnapshotBytes: Uint8Array;
  readonly snapshotHashes: readonly string[];
  readonly finalSnapshotHash: string;
  readonly wireSnapshotFrames: readonly Uint8Array[];
  readonly wireSnapshotBytes: Uint8Array;
  readonly wireSnapshotFrameSizes: readonly number[];
}

const TILE_SIZE = 32;
const REPLAY_MAP_SIZE = 32;
const REPLAY_MAX_PLAYERS = 3;

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kind),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties: {},
  });

export const makeReplayFixtureMap = () =>
  makeTileborneMap({
    id: TEST_MAP_ID,
    width: REPLAY_MAP_SIZE,
    height: REPLAY_MAP_SIZE,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    objects: [
      makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 4, 1),
      makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 2, 3),
      makeTestObject(TEST_OBJECT_IDS[2], SPAWN_POINT_KIND, 6, 2),
      makeTestObject(TEST_OBJECT_IDS[3], "shrink-zone-anchor", 16, 16),
    ],
    properties: { maxPlayers: REPLAY_MAX_PLAYERS },
  });

export const exportReplayArtifact = (): ExportedArtifact =>
  exportArtifact(makeReplayFixtureMap(), { playerModels: TEST_PLAYER_MODELS });

const buildInputLookup = (
  inputLog: readonly InputLogEntry[],
): ReadonlyMap<number, ReadonlyMap<string, RuntimePlayerInput>> => {
  const byTick = new Map<number, Map<string, RuntimePlayerInput>>();
  for (const entry of inputLog) {
    const tickInputs = byTick.get(entry.tick) ?? new Map<string, RuntimePlayerInput>();
    tickInputs.set(entry.playerId, {
      tick: entry.tick,
      seq: 0,
      dir: entry.dir,
      shoot: entry.shoot,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
    byTick.set(entry.tick, tickInputs);
  }
  return byTick;
};

const captureWorldSnapshot = (world: ReturnType<typeof createTestPluginWorld>, tick: number): WorldSnapshot => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
  const zone = getZone(world);

  const playerSnapshots: ReplayPlayerSnapshot[] = [];
  for (const [entity, player] of players.entries()) {
    const position = positions.get(entity);
    const playerStats = stats.get(entity);
    playerSnapshots.push({
      playerId: player.playerId,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      health: player.health,
      alive: player.alive,
      kills: playerStats?.kills ?? 0,
    });
  }

  playerSnapshots.sort((left, right) => left.playerId.localeCompare(right.playerId));

  return {
    tick,
    zoneRadius: zone?.currentRadius ?? 0,
    players: playerSnapshots,
  };
};

const encodeSnapshot = (snapshot: WorldSnapshot): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(snapshot));

const encodeFrameSequence = (frames: readonly Uint8Array[]): Uint8Array => {
  const byteLength = frames.reduce((sum, frame) => sum + 4 + frame.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const frame of frames) {
    view.setUint32(offset, frame.byteLength);
    offset += 4;
    bytes.set(frame, offset);
    offset += frame.byteLength;
  }
  return bytes;
};

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface RunReplayOptions {
  readonly seed: number;
  readonly inputLog: readonly InputLogEntry[];
  readonly tickCount?: number;
  readonly snapshotInterval?: number;
  readonly artifact?: ExportedArtifact;
}

export const runReplayScenario = ({
  seed,
  inputLog,
  tickCount = 300,
  snapshotInterval = 30,
  artifact = exportReplayArtifact(),
}: RunReplayOptions): ReplayRunResult => {
  resetZoneSingleton();

  const world = createTestPluginWorld();
  const inputByTick = buildInputLookup(inputLog);
  const dt = 1 / DEFAULT_BATTLE_ROYALE_CONFIG.tickRate;
  const emittedFrames: Uint8Array[] = [];
  let currentTick = 0;

  const plugin = createRuntimeAdapter({
    getArtifact: () => artifact,
    seed,
    config: {
      tickRate: DEFAULT_BATTLE_ROYALE_CONFIG.tickRate,
      zone: {
        damagePerSecOutside: 25,
        schedule: {
          waitSec: 0,
          shrinkSec: 5,
          holdSec: 5,
          shrinkPhases: 2,
          radiusFactor: 0.65,
        },
      },
    },
    getPlayerInput: (playerId) => inputByTick.get(currentTick)?.get(playerId),
    msgOut: {
      push: (frame) => {
        const copy = new Uint8Array(frame.byteLength);
        copy.set(frame);
        emittedFrames.push(copy);
      },
    },
  });

  plugin.onInit?.({ pluginId: plugin.id }, world);

  const snapshots: WorldSnapshot[] = [];

  for (let tick = 1; tick <= tickCount; tick += 1) {
    currentTick = tick;
    plugin.onTick?.(world, dt, tick);

    if (tick % snapshotInterval === 0) {
      snapshots.push(captureWorldSnapshot(world, tick));
    }
  }

  const finalSnapshot = captureWorldSnapshot(world, tickCount);
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshots));
  const finalSnapshotBytes = encodeSnapshot(finalSnapshot);
  const wireSnapshotFrames = emittedFrames.filter((frame) => {
    const message = BattleRoyaleProtocol.decodeServerMessage(frame);
    return message._tag === "WelcomeSnapshot" || message._tag === "DeltaSnapshot";
  });
  const wireSnapshotBytes = encodeFrameSequence(wireSnapshotFrames);

  resetZoneSingleton();

  return {
    snapshots,
    finalSnapshot,
    snapshotBytes,
    finalSnapshotBytes,
    snapshotHashes: snapshots.map((snapshot) => hashBytes(encodeSnapshot(snapshot))),
    finalSnapshotHash: hashBytes(finalSnapshotBytes),
    wireSnapshotFrames,
    wireSnapshotBytes,
    wireSnapshotFrameSizes: wireSnapshotFrames.map((frame) => frame.byteLength),
  };
};

export const buildScriptedInputLog = (tickCount = 300): InputLogEntry[] => {
  const log: InputLogEntry[] = [];
  const phaseDirs: readonly Direction8[] = [0, 2, 4, 6];

  for (let tick = 1; tick <= tickCount; tick += 1) {
    const dir = phaseDirs[Math.floor((tick - 1) / 75) % phaseDirs.length]!;
    log.push({
      tick,
      playerId: "player-1",
      dir,
      shoot: tick % 8 === 0,
    });

    if (tick % 12 === 0) {
      log.push({
        tick,
        playerId: "player-2",
        dir: 4,
        shoot: true,
      });
    }

    if (tick % 15 === 0) {
      log.push({
        tick,
        playerId: "player-3",
        dir: 0,
        shoot: true,
      });
    }
  }

  return log;
};

export const REPLAY_SEED = 42;

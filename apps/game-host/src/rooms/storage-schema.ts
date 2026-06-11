import { ROOM_SCHEMA_VERSION } from "./room-config.js";
import type { JsonObject } from "@tileborne/core";

export const ROOM_LIFECYCLE_PHASES = ["lobby", "countdown", "active", "finished", "archived"] as const;

export type RoomLifecyclePhase = (typeof ROOM_LIFECYCLE_PHASES)[number];

export interface RoomLifecycleState {
  readonly phase: RoomLifecyclePhase;
  readonly enteredAt: string;
  readonly countdownEndsAt?: string;
  readonly activeStartedAt?: string;
  readonly finishedAt?: string;
  readonly archivedAt?: string;
  readonly reason?: string;
}

export interface RoomPlayerRecord {
  readonly id: string;
  readonly joinedAt: string;
  readonly lastHeartbeatAt: string;
  readonly displayName?: string;
}

/** Per-session player→model selection carried by the room, never the package. */
export interface RoomPlayerModelSelection {
  readonly playerId: string;
  readonly modelId: string;
}

interface RoomStorageLegacyV1 {
  readonly schemaVersion: 1;
  readonly mapId: string;
  readonly seed: string | number;
  readonly createdAt: string;
  readonly status: "lobby" | "running" | "finished" | "archived";
  readonly options: Record<string, string | number | boolean | null>;
  readonly players: Record<string, RoomPlayerRecord>;
  readonly tick: number;
  readonly baseTick: number;
  readonly lastPersistedTick: number;
  readonly lastTickAt: string | null;
  readonly idempotencyKey?: string;
  readonly emptySince: string | null;
  readonly simState: Record<string, string | number | boolean | null>;
}

export interface RoomStorageV2 {
  readonly schemaVersion: typeof ROOM_SCHEMA_VERSION;
  readonly mapId: string;
  readonly seed: string | number;
  readonly createdAt: string;
  /** Encoded `RuntimeMapPackage` wire JSON the room runtime boots from (ADR-0030). */
  readonly mapPackage?: JsonObject;
  readonly playerModelSelections?: readonly RoomPlayerModelSelection[];
  readonly lifecycle: RoomLifecycleState;
  readonly options: Record<string, string | number | boolean | null>;
  readonly players: Record<string, RoomPlayerRecord>;
  readonly tick: number;
  readonly baseTick: number;
  readonly lastPersistedTick: number;
  readonly lastTickAt: string | null;
  readonly idempotencyKey?: string;
  readonly emptySince: string | null;
  readonly simState: Record<string, string | number | boolean | null>;
}

export type PersistedRoomStorage = RoomStorageLegacyV1 | RoomStorageV2;
export type RoomStorage = RoomStorageV2;

export const STORAGE_KEY = "state";

export const emptyRoomStorage = (
  mapId: string,
  seed: string | number,
  options: Record<string, string | number | boolean | null> = {},
  idempotencyKey?: string,
  createdAt = new Date().toISOString(),
  mapPackage?: JsonObject,
  playerModelSelections?: readonly RoomPlayerModelSelection[],
): RoomStorageV2 => ({
  schemaVersion: ROOM_SCHEMA_VERSION,
  mapId,
  seed,
  createdAt,
  ...(mapPackage === undefined ? {} : { mapPackage }),
  ...(playerModelSelections === undefined || playerModelSelections.length === 0
    ? {}
    : { playerModelSelections }),
  lifecycle: {
    phase: "lobby",
    enteredAt: createdAt,
  },
  options,
  players: {},
  tick: 0,
  baseTick: 0,
  lastPersistedTick: 0,
  lastTickAt: null,
  ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  emptySince: null,
  simState: {},
});

const legacyLifecycle = (value: RoomStorageLegacyV1): RoomLifecycleState => {
  const enteredAt = value.lastTickAt ?? value.emptySince ?? value.createdAt;
  if (value.status === "running") {
    return {
      phase: "active",
      enteredAt,
      activeStartedAt: enteredAt,
    };
  }
  if (value.status === "finished") {
    return {
      phase: "finished",
      enteredAt,
      finishedAt: enteredAt,
      reason: "legacy-finished",
    };
  }
  if (value.status === "archived") {
    return {
      phase: "archived",
      enteredAt,
      archivedAt: enteredAt,
      reason: "legacy-archived",
    };
  }
  return {
    phase: "lobby",
    enteredAt: value.createdAt,
  };
};

const migrateLegacyV1 = (value: RoomStorageLegacyV1): RoomStorageV2 => ({
  schemaVersion: ROOM_SCHEMA_VERSION,
  mapId: value.mapId,
  seed: value.seed,
  createdAt: value.createdAt,
  lifecycle: legacyLifecycle(value),
  options: value.options,
  players: value.players,
  tick: value.tick,
  baseTick: value.baseTick,
  lastPersistedTick: value.lastPersistedTick,
  lastTickAt: value.lastTickAt,
  ...(value.idempotencyKey === undefined ? {} : { idempotencyKey: value.idempotencyKey }),
  emptySince: value.emptySince,
  simState: value.simState,
});

export const migrateRoomStorage = (value: PersistedRoomStorage): RoomStorage => {
  if (value.schemaVersion === 1) {
    return migrateLegacyV1(value);
  }
  const schemaVersion: number = value.schemaVersion;
  if (schemaVersion !== ROOM_SCHEMA_VERSION) {
    throw new Error(`unsupported room storage schema version ${String(schemaVersion)}`);
  }
  return value;
};

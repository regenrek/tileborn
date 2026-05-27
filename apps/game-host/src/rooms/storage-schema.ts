import type { RoomLifecycleStatus } from "../types.js";
import { ROOM_SCHEMA_VERSION } from "./room-config.js";

export interface RoomPlayerRecord {
  readonly id: string;
  readonly joinedAt: string;
  readonly lastHeartbeatAt: string;
  readonly displayName?: string;
}

export interface RoomStorageV1 {
  readonly schemaVersion: typeof ROOM_SCHEMA_VERSION;
  readonly mapId: string;
  readonly seed: string | number;
  readonly createdAt: string;
  readonly status: RoomLifecycleStatus;
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

export type RoomStorage = RoomStorageV1;

export const STORAGE_KEY = "state";

export const emptyRoomStorage = (
  mapId: string,
  seed: string | number,
  options: Record<string, string | number | boolean | null> = {},
  idempotencyKey?: string,
): RoomStorageV1 => ({
  schemaVersion: ROOM_SCHEMA_VERSION,
  mapId,
  seed,
  createdAt: new Date().toISOString(),
  status: "lobby",
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

export interface RoomStorageMigrator {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (value: RoomStorage) => RoomStorage;
}

export const roomStorageMigrators: readonly RoomStorageMigrator[] = [];

export const migrateRoomStorage = (value: RoomStorage): RoomStorage => {
  let current = value;
  for (const migrator of roomStorageMigrators) {
    if (current.schemaVersion === migrator.fromVersion) {
      current = migrator.migrate(current) as RoomStorage;
    }
  }
  if (current.schemaVersion !== ROOM_SCHEMA_VERSION) {
    throw new Error(`unsupported room storage schema version ${String(current.schemaVersion)}`);
  }
  return current;
};

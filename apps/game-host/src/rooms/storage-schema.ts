import { ROOM_SCHEMA_VERSION } from './room-config.js';
import type { JsonObject } from '@tileborne/core';
import type { RuntimeGameShellProjection } from '@tileborne/runtime';

export const ROOM_LIFECYCLE_PHASES = [
  'lobby',
  'countdown',
  'active',
  'finished',
  'archived',
] as const;

export type RoomLifecyclePhase = (typeof ROOM_LIFECYCLE_PHASES)[number];
export type RoomJoinCode = string;
export type RoomLobbyVisibility = 'private' | 'public';
export type RoomPlayerRole = 'owner' | 'participant';
export type RoomPlayerPresenceStatus = 'connected' | 'disconnected';
export type RoomResultOutcome = 'completed' | 'abandoned' | 'cancelled';

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

export interface RoomLobbyState {
  readonly visibility: RoomLobbyVisibility;
  readonly joinCode?: RoomJoinCode;
  readonly title?: string;
  readonly createdByPlayerId?: string;
}

export interface RoomPlayerReadyRecord {
  readonly playerId: string;
  readonly isReady: boolean;
  readonly updatedAt: string;
}

export interface RoomReadyState {
  readonly players: Record<string, RoomPlayerReadyRecord>;
}

export interface RoomPlayerPresenceRecord {
  readonly playerId: string;
  readonly status: RoomPlayerPresenceStatus;
  readonly lastSeenAt: string;
  readonly connectedAt?: string;
  readonly disconnectedAt?: string;
}

export interface RoomPresenceState {
  readonly players: Record<string, RoomPlayerPresenceRecord>;
}

export interface RoomReconnectSeatRecord {
  readonly playerId: string;
  readonly issuedAt: string;
  readonly expiresAt?: string;
}

export interface RoomReconnectState {
  readonly seats: Record<string, RoomReconnectSeatRecord>;
}

export interface RoomPlayerResultSummary {
  readonly playerId: string;
  readonly outcome?: RoomResultOutcome;
  readonly placement?: number;
  readonly score?: number;
}

export interface RoomResultsSummary {
  readonly completedAt: string;
  readonly reason?: string;
  readonly players: readonly RoomPlayerResultSummary[];
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
  readonly status: 'lobby' | 'running' | 'finished' | 'archived';
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
  readonly schemaVersion: 2;
  readonly mapId: string;
  readonly seed: string | number;
  readonly createdAt: string;
  /** Encoded `RuntimeMapPackage` wire JSON the room runtime boots from (ADR-0030). */
  readonly mapPackage?: JsonObject;
  readonly shellProjection?: RuntimeGameShellProjection;
  readonly shellNavigationEpoch?: string;
  readonly nextShellNavigationSequence?: number;
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

export interface RoomStorageV3 extends Omit<RoomStorageV2, 'schemaVersion'> {
  readonly schemaVersion: typeof ROOM_SCHEMA_VERSION;
  readonly lobby: RoomLobbyState;
  readonly ready: RoomReadyState;
  readonly presence: RoomPresenceState;
  readonly reconnect: RoomReconnectState;
  readonly results: RoomResultsSummary | null;
}

export type PersistedRoomStorage = RoomStorageLegacyV1 | RoomStorageV2 | RoomStorageV3;
export type RoomStorage = RoomStorageV3;

export const STORAGE_KEY = 'state';

export const emptyRoomLobbyState = (): RoomLobbyState => ({
  visibility: 'private',
});

export const emptyRoomReadyState = (): RoomReadyState => ({
  players: {},
});

export const emptyRoomPresenceState = (): RoomPresenceState => ({
  players: {},
});

export const emptyRoomReconnectState = (): RoomReconnectState => ({
  seats: {},
});

export const emptyRoomStorage = (
  mapId: string,
  seed: string | number,
  options: Record<string, string | number | boolean | null> = {},
  idempotencyKey?: string,
  createdAt = new Date().toISOString(),
  mapPackage?: JsonObject,
  playerModelSelections?: readonly RoomPlayerModelSelection[],
  shellProjection?: RuntimeGameShellProjection,
  shellNavigationEpoch = crypto.randomUUID(),
): RoomStorageV3 => ({
  schemaVersion: ROOM_SCHEMA_VERSION,
  mapId,
  seed,
  createdAt,
  ...(mapPackage === undefined ? {} : { mapPackage }),
  ...(shellProjection === undefined ? {} : { shellProjection }),
  shellNavigationEpoch,
  nextShellNavigationSequence: 0,
  ...(playerModelSelections === undefined || playerModelSelections.length === 0
    ? {}
    : { playerModelSelections }),
  lifecycle: {
    phase: 'lobby',
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
  lobby: emptyRoomLobbyState(),
  ready: emptyRoomReadyState(),
  presence: emptyRoomPresenceState(),
  reconnect: emptyRoomReconnectState(),
  results: null,
});

const legacyLifecycle = (value: RoomStorageLegacyV1): RoomLifecycleState => {
  const enteredAt = value.lastTickAt ?? value.emptySince ?? value.createdAt;
  if (value.status === 'running') {
    return {
      phase: 'active',
      enteredAt,
      activeStartedAt: enteredAt,
    };
  }
  if (value.status === 'finished') {
    return {
      phase: 'finished',
      enteredAt,
      finishedAt: enteredAt,
      reason: 'legacy-finished',
    };
  }
  if (value.status === 'archived') {
    return {
      phase: 'archived',
      enteredAt,
      archivedAt: enteredAt,
      reason: 'legacy-archived',
    };
  }
  return {
    phase: 'lobby',
    enteredAt: value.createdAt,
  };
};

const migrateLegacyV1 = (value: RoomStorageLegacyV1): RoomStorageV2 => ({
  schemaVersion: 2,
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

const addM4RoomStateDefaults = (value: RoomStorageV2): RoomStorageV3 => ({
  ...value,
  schemaVersion: ROOM_SCHEMA_VERSION,
  shellNavigationEpoch: value.shellNavigationEpoch ?? value.createdAt,
  nextShellNavigationSequence: value.nextShellNavigationSequence ?? 0,
  lobby: emptyRoomLobbyState(),
  ready: emptyRoomReadyState(),
  presence: emptyRoomPresenceState(),
  reconnect: emptyRoomReconnectState(),
  results: null,
});

export const migrateRoomStorage = (value: PersistedRoomStorage): RoomStorage => {
  if (value.schemaVersion === 1) {
    return addM4RoomStateDefaults(migrateLegacyV1(value));
  }
  if (value.schemaVersion === 2) {
    return addM4RoomStateDefaults(value);
  }
  const schemaVersion: number = value.schemaVersion;
  if (schemaVersion !== ROOM_SCHEMA_VERSION) {
    throw new Error(`unsupported room storage schema version ${String(schemaVersion)}`);
  }
  return {
    ...value,
    shellNavigationEpoch: value.shellNavigationEpoch ?? value.createdAt,
    nextShellNavigationSequence: value.nextShellNavigationSequence ?? 0,
  };
};

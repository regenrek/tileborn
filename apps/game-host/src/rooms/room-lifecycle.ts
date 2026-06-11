import {
  DEFAULT_ROOM_COUNTDOWN_SECONDS,
  DEFAULT_ROOM_MAX_PLAYERS,
  ROOM_CLOSED_CLOSE_CODE,
  ROOM_FULL_CLOSE_CODE,
} from './room-config.js';
import type { RoomLifecycleState, RoomPlayerRecord, RoomStorage } from './storage-schema.js';

export interface RoomAdmissionState {
  readonly phase: RoomLifecycleState['phase'];
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly acceptsPlayers: boolean;
  readonly reason?: string;
  readonly closeCode?: number;
}

export class RoomAdmissionRejectedError extends Error {
  readonly closeCode: number;
  readonly httpStatus: number;

  constructor(message: string, closeCode: number, httpStatus = 409) {
    super(message);
    this.name = 'RoomAdmissionRejectedError';
    this.closeCode = closeCode;
    this.httpStatus = httpStatus;
  }
}

export interface RoomPlayerReservation {
  readonly playerId: string;
  readonly storage: RoomStorage;
}

const optionNumber = (
  options: Record<string, string | number | boolean | null>,
  key: string,
): number | undefined => {
  const value = options[key];
  return typeof value === 'number' ? value : undefined;
};

export const resolveRoomMaxPlayers = (
  options: Record<string, string | number | boolean | null>,
): number => {
  const value = optionNumber(options, 'maxPlayers');
  if (value === undefined) {
    return DEFAULT_ROOM_MAX_PLAYERS;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('maxPlayers must be a positive integer');
  }
  return value;
};

export const resolveRoomCountdownMs = (
  options: Record<string, string | number | boolean | null>,
): number => {
  const value = optionNumber(options, 'countdownSeconds');
  if (value === undefined) {
    return DEFAULT_ROOM_COUNTDOWN_SECONDS * 1000;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('countdownSeconds must be a non-negative number');
  }
  return Math.round(value * 1000);
};

export const validateRoomOptions = (
  options: Record<string, string | number | boolean | null>,
): void => {
  resolveRoomMaxPlayers(options);
  resolveRoomCountdownMs(options);
};

const playerCount = (players: Record<string, RoomPlayerRecord>): number =>
  Object.keys(players).length;

const generatedPlayerIdPattern = /^player-([1-9]\d*)$/;

const generatedPlayerSlot = (playerId: string): number | undefined => {
  const match = generatedPlayerIdPattern.exec(playerId);
  if (!match) {
    return undefined;
  }
  const slot = Number(match[1]);
  return Number.isSafeInteger(slot) ? slot : undefined;
};

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Player capacity authored in the package: read ONLY from the manifest's
 * neutral `playerCapacity` field (M2 review, F2). `modeData` is engine-opaque
 * — the room never reads into it (boundary-tested).
 */
const runtimePlayerSlotCapacity = (storage: RoomStorage): number | undefined => {
  const mapPackage = storage.mapPackage;
  if (mapPackage === undefined || !isRecord(mapPackage.manifest)) {
    return undefined;
  }
  return positiveInteger(mapPackage.manifest.playerCapacity);
};

const usesGeneratedRuntimePlayerSlots = (storage: RoomStorage): boolean =>
  runtimePlayerSlotCapacity(storage) !== undefined;

export const resolveRoomPlayerCapacity = (storage: RoomStorage): number => {
  const configuredMaxPlayers = resolveRoomMaxPlayers(storage.options);
  const runtimeCapacity = runtimePlayerSlotCapacity(storage);
  return runtimeCapacity === undefined
    ? configuredMaxPlayers
    : Math.min(configuredMaxPlayers, runtimeCapacity);
};

const assertRuntimePlayerSlot = (
  storage: RoomStorage,
  playerId: string,
  maxPlayers: number,
): void => {
  if (!usesGeneratedRuntimePlayerSlots(storage)) {
    return;
  }
  const slot = generatedPlayerSlot(playerId);
  if (slot === undefined || slot > maxPlayers) {
    throw new RoomAdmissionRejectedError(
      'player id is outside runtime player slots',
      ROOM_FULL_CLOSE_CODE,
      400,
    );
  }
};

export const resolveRoomAdmission = (
  storage: RoomStorage,
  playerId: string,
): RoomAdmissionState => {
  const count = playerCount(storage.players);
  const maxPlayers = resolveRoomPlayerCapacity(storage);
  if (storage.lifecycle.phase === 'finished' || storage.lifecycle.phase === 'archived') {
    return {
      phase: storage.lifecycle.phase,
      playerCount: count,
      maxPlayers,
      acceptsPlayers: false,
      reason: 'room admission closed',
      closeCode: ROOM_CLOSED_CLOSE_CODE,
    };
  }
  if (storage.players[playerId] === undefined && count >= maxPlayers) {
    return {
      phase: storage.lifecycle.phase,
      playerCount: count,
      maxPlayers,
      acceptsPlayers: false,
      reason: 'room capacity reached',
      closeCode: ROOM_FULL_CLOSE_CODE,
    };
  }
  try {
    assertRuntimePlayerSlot(storage, playerId, maxPlayers);
  } catch (error) {
    if (error instanceof RoomAdmissionRejectedError) {
      return {
        phase: storage.lifecycle.phase,
        playerCount: count,
        maxPlayers,
        acceptsPlayers: false,
        reason: error.message,
        closeCode: error.closeCode,
      };
    }
    throw error;
  }
  return {
    phase: storage.lifecycle.phase,
    playerCount: count,
    maxPlayers,
    acceptsPlayers: true,
  };
};

export const assertRoomAdmission = (storage: RoomStorage, playerId: string): void => {
  const admission = resolveRoomAdmission(storage, playerId);
  if (!admission.acceptsPlayers) {
    throw new RoomAdmissionRejectedError(
      admission.reason ?? 'room admission rejected',
      admission.closeCode ?? ROOM_CLOSED_CLOSE_CODE,
    );
  }
};

const startCountdown = (
  lifecycle: RoomLifecycleState,
  now: string,
  countdownMs: number,
): RoomLifecycleState => {
  const countdownEndsAt = new Date(Date.parse(now) + countdownMs).toISOString();
  return {
    phase: 'countdown',
    enteredAt: now,
    countdownEndsAt,
    ...(lifecycle.reason === undefined ? {} : { reason: lifecycle.reason }),
  };
};

export const admitPlayerToRoom = (
  storage: RoomStorage,
  playerId: string,
  now: string,
): RoomStorage => {
  assertRoomAdmission(storage, playerId);
  const existing = storage.players[playerId];
  const players = {
    ...storage.players,
    [playerId]: {
      id: playerId,
      joinedAt: existing?.joinedAt ?? now,
      lastHeartbeatAt: now,
      ...(existing?.displayName === undefined ? {} : { displayName: existing.displayName }),
    },
  };
  const shouldStartCountdown = storage.lifecycle.phase === 'lobby' && playerCount(players) > 0;
  return {
    ...storage,
    players,
    emptySince: null,
    lifecycle: shouldStartCountdown
      ? startCountdown(storage.lifecycle, now, resolveRoomCountdownMs(storage.options))
      : storage.lifecycle,
  };
};

export const reserveRoomPlayer = (
  storage: RoomStorage,
  requestedPlayerId: string | undefined,
  now: string,
): RoomPlayerReservation => {
  const maxPlayers = resolveRoomPlayerCapacity(storage);
  if (requestedPlayerId !== undefined) {
    if (requestedPlayerId.length === 0) {
      throw new RoomAdmissionRejectedError(
        'playerId must be a non-empty string',
        ROOM_FULL_CLOSE_CODE,
        400,
      );
    }
    assertRuntimePlayerSlot(storage, requestedPlayerId, maxPlayers);
    return {
      playerId: requestedPlayerId,
      storage: admitPlayerToRoom(storage, requestedPlayerId, now),
    };
  }

  for (let slot = 1; slot <= maxPlayers; slot += 1) {
    const playerId = `player-${slot}`;
    if (storage.players[playerId] === undefined) {
      return {
        playerId,
        storage: admitPlayerToRoom(storage, playerId, now),
      };
    }
  }

  throw new RoomAdmissionRejectedError('room capacity reached', ROOM_FULL_CLOSE_CODE);
};

export const finishRoomIfEmpty = (
  storage: RoomStorage,
  now: string,
  reason: string,
): RoomStorage => {
  if (playerCount(storage.players) > 0 || storage.lifecycle.phase === 'archived') {
    return storage;
  }
  return {
    ...storage,
    emptySince: now,
    lifecycle: {
      phase: 'finished',
      enteredAt: now,
      finishedAt: now,
      reason,
    },
  };
};

export const archiveRoom = (storage: RoomStorage, now: string, reason: string): RoomStorage => ({
  ...storage,
  emptySince: now,
  lifecycle: {
    phase: 'archived',
    enteredAt: now,
    archivedAt: now,
    reason,
  },
});

export const advanceLifecycleForAlarm = (
  storage: RoomStorage,
  nowMs: number,
  now: string,
): {
  readonly storage: RoomStorage;
  readonly changed: boolean;
  readonly runSimulation: boolean;
  readonly rescheduleAtMs?: number;
} => {
  if (storage.lifecycle.phase !== 'countdown') {
    return { storage, changed: false, runSimulation: storage.lifecycle.phase === 'active' };
  }
  const countdownEndsAt = Date.parse(
    storage.lifecycle.countdownEndsAt ?? storage.lifecycle.enteredAt,
  );
  if (nowMs < countdownEndsAt) {
    return { storage, changed: false, runSimulation: false, rescheduleAtMs: countdownEndsAt };
  }
  return {
    storage: {
      ...storage,
      lifecycle: {
        phase: 'active',
        enteredAt: now,
        activeStartedAt: now,
      },
    },
    changed: true,
    runSimulation: true,
  };
};

export const shouldHydrateRuntime = (storage: RoomStorage): boolean =>
  storage.lifecycle.phase === 'lobby' ||
  storage.lifecycle.phase === 'countdown' ||
  storage.lifecycle.phase === 'active';

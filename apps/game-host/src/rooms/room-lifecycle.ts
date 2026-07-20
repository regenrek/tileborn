import {
  DEFAULT_ROOM_COUNTDOWN_SECONDS,
  DEFAULT_ROOM_MAX_PLAYERS,
  DEFAULT_ROOM_MIN_READY_PLAYERS,
  ROOM_CLOSED_CLOSE_CODE,
  ROOM_FULL_CLOSE_CODE,
} from './room-config.js';
import type {
  RoomJoinCode,
  RoomLifecyclePhase,
  RoomLifecycleState,
  RoomPlayerRole,
  RoomPlayerPresenceStatus,
  RoomPlayerRecord,
  RoomResultsSummary,
  RoomStorage,
} from './storage-schema.js';

export const ROOM_JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export interface RoomReadyGateState {
  readonly phase: RoomLifecyclePhase;
  readonly canStart: boolean;
  readonly playerCount: number;
  readonly readyPlayerCount: number;
  readonly requiredPlayerCount: number;
  readonly minPlayers: number;
  readonly missingReadyPlayerIds: readonly string[];
  readonly reason?: string;
}

export interface RoomReadyGateOptions {
  readonly minPlayers?: number;
  readonly requiredPlayerIds?: readonly string[];
}

export interface RoomReconnectEligibility {
  readonly playerId: string;
  readonly phase: RoomLifecyclePhase;
  readonly eligible: boolean;
  readonly expiresAt?: string;
  readonly reason?: string;
}

export interface RoomPresenceProjection {
  readonly playerId: string;
  readonly role: RoomPlayerRole;
  readonly status: RoomPlayerPresenceStatus;
  readonly ready: boolean;
  readonly reconnectEligible: boolean;
  readonly lastSeenAt: string | null;
  readonly displayName?: string;
  readonly connectedAt?: string;
  readonly disconnectedAt?: string;
}

export interface RoomPresenceProjectionOptions {
  readonly connectedPlayerIds?: readonly string[];
  readonly now?: string;
}

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

export class RoomLifecycleRejectedError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 409) {
    super(message);
    this.name = 'RoomLifecycleRejectedError';
    this.httpStatus = httpStatus;
  }
}

export interface RoomPlayerReservation {
  readonly playerId: string;
  readonly storage: RoomStorage;
}

export interface RoomPlayerAdmissionOptions {
  readonly displayName?: string;
}

export interface RoomReadyUpdateResult {
  readonly storage: RoomStorage;
  readonly readyGate: RoomReadyGateState;
}

export interface RoomOwnerActionResult {
  readonly storage: RoomStorage;
  readonly readyGate: RoomReadyGateState;
}

const optionNumber = (
  options: Record<string, string | number | boolean | null>,
  key: string,
): number | undefined => {
  const value = options[key];
  return typeof value === 'number' ? value : undefined;
};

export const normalizeRoomJoinCode = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');

export const isRoomJoinCode = (value: string): value is RoomJoinCode =>
  ROOM_JOIN_CODE_PATTERN.test(normalizeRoomJoinCode(value));

export const createRoomJoinCode = (value: string): RoomJoinCode => {
  const normalized = normalizeRoomJoinCode(value);
  if (!ROOM_JOIN_CODE_PATTERN.test(normalized)) {
    throw new Error('join code must be 6 characters using A-Z and 2-9, excluding I, O, 0, and 1');
  }
  return normalized;
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
  resolveRoomMinReadyPlayers(options);
};

export const resolveRoomMinReadyPlayers = (
  options: Record<string, string | number | boolean | null>,
  override?: number,
): number => {
  const value =
    override ?? optionNumber(options, 'minReadyPlayers') ?? DEFAULT_ROOM_MIN_READY_PLAYERS;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('minReadyPlayers must be a positive integer');
  }
  return value;
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

export const allowsRoomAdmissionPhase = (phase: RoomLifecyclePhase): boolean =>
  phase === 'lobby' || phase === 'countdown' || phase === 'active';

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
  if (!allowsRoomAdmissionPhase(storage.lifecycle.phase)) {
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

const sortedPlayerIds = (players: Record<string, unknown>): readonly string[] =>
  Object.keys(players).sort((left, right) => left.localeCompare(right));

export const resolveRoomPlayerRole = (storage: RoomStorage, playerId: string): RoomPlayerRole =>
  storage.lobby.createdByPlayerId === playerId ? 'owner' : 'participant';

export const assertRoomOwner = (storage: RoomStorage, playerId: string): void => {
  if (resolveRoomPlayerRole(storage, playerId) !== 'owner') {
    throw new RoomLifecycleRejectedError('only the room owner can perform this action', 403);
  }
};

export const resolveRoomReadyGate = (
  storage: RoomStorage,
  options: RoomReadyGateOptions = {},
): RoomReadyGateState => {
  const minPlayers = resolveRoomMinReadyPlayers(storage.options, options.minPlayers);
  const rosterPlayerIds = sortedPlayerIds(storage.players);
  const requiredPlayerIds = [...(options.requiredPlayerIds ?? rosterPlayerIds)].sort(
    (left, right) => left.localeCompare(right),
  );
  const missingReadyPlayerIds = requiredPlayerIds.filter(
    (playerId) => storage.ready.players[playerId]?.isReady !== true,
  );
  const readyPlayerCount = requiredPlayerIds.length - missingReadyPlayerIds.length;
  const count = rosterPlayerIds.length;
  if (storage.lifecycle.phase !== 'lobby' && storage.lifecycle.phase !== 'countdown') {
    return {
      phase: storage.lifecycle.phase,
      canStart: false,
      playerCount: count,
      readyPlayerCount,
      requiredPlayerCount: requiredPlayerIds.length,
      minPlayers,
      missingReadyPlayerIds,
      reason: 'room is not waiting for match start',
    };
  }
  if (count < minPlayers) {
    return {
      phase: storage.lifecycle.phase,
      canStart: false,
      playerCount: count,
      readyPlayerCount,
      requiredPlayerCount: requiredPlayerIds.length,
      minPlayers,
      missingReadyPlayerIds,
      reason: 'not enough players ready to start',
    };
  }
  if (missingReadyPlayerIds.length > 0) {
    return {
      phase: storage.lifecycle.phase,
      canStart: false,
      playerCount: count,
      readyPlayerCount,
      requiredPlayerCount: requiredPlayerIds.length,
      minPlayers,
      missingReadyPlayerIds,
      reason: 'waiting for required players to ready up',
    };
  }
  return {
    phase: storage.lifecycle.phase,
    canStart: true,
    playerCount: count,
    readyPlayerCount,
    requiredPlayerCount: requiredPlayerIds.length,
    minPlayers,
    missingReadyPlayerIds,
  };
};

export const resolveRoomReconnectEligibility = (
  storage: RoomStorage,
  playerId: string,
  now: string,
): RoomReconnectEligibility => {
  const seat = storage.reconnect.seats[playerId];
  const player = storage.players[playerId];
  if (!allowsRoomAdmissionPhase(storage.lifecycle.phase)) {
    return {
      playerId,
      phase: storage.lifecycle.phase,
      eligible: false,
      ...(seat?.expiresAt === undefined ? {} : { expiresAt: seat.expiresAt }),
      reason: 'room is closed',
    };
  }
  if (player === undefined && seat === undefined) {
    return {
      playerId,
      phase: storage.lifecycle.phase,
      eligible: false,
      reason: 'player seat is not reserved',
    };
  }
  if (seat?.expiresAt !== undefined && Date.parse(now) >= Date.parse(seat.expiresAt)) {
    return {
      playerId,
      phase: storage.lifecycle.phase,
      eligible: false,
      expiresAt: seat.expiresAt,
      reason: 'reconnect seat expired',
    };
  }
  return {
    playerId,
    phase: storage.lifecycle.phase,
    eligible: true,
    ...(seat?.expiresAt === undefined ? {} : { expiresAt: seat.expiresAt }),
  };
};

export const projectRoomPresence = (
  storage: RoomStorage,
  options: RoomPresenceProjectionOptions = {},
): readonly RoomPresenceProjection[] => {
  const connectedPlayerIds = new Set(options.connectedPlayerIds ?? []);
  const playerIds = new Set<string>([
    ...Object.keys(storage.players),
    ...Object.keys(storage.presence.players),
    ...Object.keys(storage.reconnect.seats),
  ]);
  return [...playerIds]
    .sort((left, right) => left.localeCompare(right))
    .map((playerId) => {
      const player = storage.players[playerId];
      const presence = storage.presence.players[playerId];
      const status: RoomPlayerPresenceStatus = connectedPlayerIds.has(playerId)
        ? 'connected'
        : (presence?.status ?? 'disconnected');
      const reconnectEligibility = resolveRoomReconnectEligibility(
        storage,
        playerId,
        options.now ?? new Date(0).toISOString(),
      );
      return {
        playerId,
        role: resolveRoomPlayerRole(storage, playerId),
        status,
        ready: storage.ready.players[playerId]?.isReady === true,
        reconnectEligible: reconnectEligibility.eligible,
        lastSeenAt: presence?.lastSeenAt ?? player?.lastHeartbeatAt ?? player?.joinedAt ?? null,
        ...(player?.displayName === undefined ? {} : { displayName: player.displayName }),
        ...(presence?.connectedAt === undefined ? {} : { connectedAt: presence.connectedAt }),
        ...(presence?.disconnectedAt === undefined
          ? {}
          : { disconnectedAt: presence.disconnectedAt }),
      };
    });
};

export const startRoomFromOwner = (
  storage: RoomStorage,
  playerId: string,
  now: string,
): RoomOwnerActionResult => {
  assertRoomOwner(storage, playerId);
  const readyGate = resolveRoomReadyGate(storage);
  if (!readyGate.canStart) {
    throw new RoomLifecycleRejectedError(readyGate.reason ?? 'room is not ready to start');
  }
  if (storage.lifecycle.phase === 'active') {
    return { storage, readyGate };
  }
  if (storage.lifecycle.phase !== 'lobby' && storage.lifecycle.phase !== 'countdown') {
    throw new RoomLifecycleRejectedError('room is not waiting for match start');
  }
  return {
    readyGate,
    storage: {
      ...storage,
      lifecycle: {
        phase: 'active',
        enteredAt: now,
        activeStartedAt: now,
      },
    },
  };
};

export const stopRoomFromOwner = (
  storage: RoomStorage,
  playerId: string,
  now: string,
  reason = 'owner stopped room',
): RoomStorage => {
  assertRoomOwner(storage, playerId);
  if (storage.lifecycle.phase === 'finished' || storage.lifecycle.phase === 'archived') {
    return storage;
  }
  return {
    ...storage,
    results: storage.results ?? createRoomResultsSummary(storage, now, reason),
    lifecycle: {
      phase: 'finished',
      enteredAt: now,
      finishedAt: now,
      reason,
    },
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

const resetCountdownToLobby = (
  lifecycle: RoomLifecycleState,
  now: string,
  reason: string,
): RoomLifecycleState => ({
  phase: 'lobby',
  enteredAt: now,
  reason,
});

export const setRoomPlayerReady = (
  storage: RoomStorage,
  playerId: string,
  isReady: boolean,
  now: string,
): RoomReadyUpdateResult => {
  if (storage.players[playerId] === undefined) {
    throw new RoomLifecycleRejectedError('player is not in the room', 404);
  }
  if (storage.lifecycle.phase !== 'lobby' && storage.lifecycle.phase !== 'countdown') {
    throw new RoomLifecycleRejectedError('room is not waiting for match start');
  }
  const readyStorage: RoomStorage = {
    ...storage,
    ready: {
      players: {
        ...storage.ready.players,
        [playerId]: {
          playerId,
          isReady,
          updatedAt: now,
        },
      },
    },
  };
  const readyGate = resolveRoomReadyGate(readyStorage);
  if (readyGate.canStart) {
    return {
      storage:
        readyStorage.lifecycle.phase === 'lobby'
          ? {
              ...readyStorage,
              lifecycle: startCountdown(
                readyStorage.lifecycle,
                now,
                resolveRoomCountdownMs(readyStorage.options),
              ),
            }
          : readyStorage,
      readyGate,
    };
  }
  if (readyStorage.lifecycle.phase === 'countdown') {
    return {
      storage: {
        ...readyStorage,
        lifecycle: resetCountdownToLobby(
          readyStorage.lifecycle,
          now,
          readyGate.reason ?? 'ready gate no longer satisfied',
        ),
      },
      readyGate,
    };
  }
  return { storage: readyStorage, readyGate };
};

export const admitPlayerToRoom = (
  storage: RoomStorage,
  playerId: string,
  now: string,
  options: RoomPlayerAdmissionOptions = {},
): RoomStorage => {
  assertRoomAdmission(storage, playerId);
  const existing = storage.players[playerId];
  const displayName = options.displayName ?? existing?.displayName;
  const players = {
    ...storage.players,
    [playerId]: {
      id: playerId,
      joinedAt: existing?.joinedAt ?? now,
      lastHeartbeatAt: now,
      ...(displayName === undefined ? {} : { displayName }),
    },
  };
  const readyPlayers = {
    ...storage.ready.players,
    [playerId]: storage.ready.players[playerId] ?? {
      playerId,
      isReady: false,
      updatedAt: now,
    },
  };
  const previousPresence = storage.presence.players[playerId];
  const previousReconnectSeat = storage.reconnect.seats[playerId];
  const presencePlayers = {
    ...storage.presence.players,
    [playerId]: {
      playerId,
      status: 'connected' as const,
      lastSeenAt: now,
      connectedAt: previousPresence?.connectedAt ?? now,
    },
  };
  const reconnectSeats = {
    ...storage.reconnect.seats,
    [playerId]: {
      playerId,
      issuedAt: previousReconnectSeat?.issuedAt ?? now,
    },
  };
  return {
    ...storage,
    players,
    ready: { players: readyPlayers },
    presence: { players: presencePlayers },
    reconnect: { seats: reconnectSeats },
    emptySince: null,
    lifecycle: storage.lifecycle,
  };
};

export const markRoomPlayerDisconnected = (
  storage: RoomStorage,
  playerId: string,
  now: string,
  reconnectExpiresAt: string,
): RoomStorage => {
  if (storage.players[playerId] === undefined) {
    return storage;
  }
  const previousPresence = storage.presence.players[playerId];
  return {
    ...storage,
    presence: {
      players: {
        ...storage.presence.players,
        [playerId]: {
          playerId,
          status: 'disconnected',
          lastSeenAt: now,
          ...(previousPresence?.connectedAt === undefined
            ? {}
            : { connectedAt: previousPresence.connectedAt }),
          disconnectedAt: now,
        },
      },
    },
    reconnect: {
      seats: {
        ...storage.reconnect.seats,
        [playerId]: {
          playerId,
          issuedAt: storage.reconnect.seats[playerId]?.issuedAt ?? now,
          expiresAt: reconnectExpiresAt,
        },
      },
    },
  };
};

const sortedResultPlayerIds = (storage: RoomStorage): readonly string[] =>
  [
    ...new Set([
      ...Object.keys(storage.players),
      ...Object.keys(storage.ready.players),
      ...Object.keys(storage.presence.players),
      ...Object.keys(storage.reconnect.seats),
    ]),
  ].sort((left, right) => left.localeCompare(right));

export const createRoomResultsSummary = (
  storage: RoomStorage,
  now: string,
  reason: string,
): RoomResultsSummary => ({
  completedAt: now,
  reason,
  players: sortedResultPlayerIds(storage).map((playerId) => ({
    playerId,
    outcome: reason === 'match complete' ? 'completed' : 'abandoned',
  })),
});

export const finishRoomFromMatchEnd = (
  storage: RoomStorage,
  now: string,
  winnerPlayerId: string,
): RoomStorage => {
  // The first authoritative terminal event wins. A replayed/duplicate event
  // must never mutate durable results, placements, or completion time.
  if (storage.lifecycle.phase !== 'active' || storage.results !== null) {
    return storage;
  }
  const playerIds = [...new Set([...sortedResultPlayerIds(storage), winnerPlayerId])].sort(
    (left, right) => left.localeCompare(right),
  );
  return {
    ...storage,
    results: {
      completedAt: now,
      reason: 'match complete',
      players: playerIds.map((playerId) => ({
        playerId,
        outcome: 'completed',
        placement: playerId === winnerPlayerId ? 1 : 2,
      })),
    },
    lifecycle: {
      phase: 'finished',
      enteredAt: now,
      finishedAt: now,
      reason: 'match complete',
    },
  };
};

export const reserveRoomPlayer = (
  storage: RoomStorage,
  requestedPlayerId: string | undefined,
  now: string,
  options: RoomPlayerAdmissionOptions = {},
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
      storage: admitPlayerToRoom(storage, requestedPlayerId, now, options),
    };
  }

  for (let slot = 1; slot <= maxPlayers; slot += 1) {
    const playerId = `player-${slot}`;
    if (storage.players[playerId] === undefined) {
      return {
        playerId,
        storage: admitPlayerToRoom(storage, playerId, now, options),
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
    results: storage.results ?? createRoomResultsSummary(storage, now, reason),
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
  const readyGate = resolveRoomReadyGate(storage);
  if (!readyGate.canStart) {
    return {
      storage: {
        ...storage,
        lifecycle: resetCountdownToLobby(
          storage.lifecycle,
          now,
          readyGate.reason ?? 'ready gate no longer satisfied',
        ),
      },
      changed: true,
      runSimulation: false,
    };
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

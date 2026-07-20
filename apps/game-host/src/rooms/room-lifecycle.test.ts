import { describe, expect, it } from 'vitest';

import { ROOM_CLOSED_CLOSE_CODE, ROOM_SCHEMA_VERSION } from './room-config.js';
import {
  allowsRoomAdmissionPhase,
  admitPlayerToRoom,
  createRoomJoinCode,
  createRoomResultsSummary,
  finishRoomFromMatchEnd,
  isRoomJoinCode,
  markRoomPlayerDisconnected,
  projectRoomPresence,
  resolveRoomAdmission,
  resolveRoomReadyGate,
  resolveRoomReconnectEligibility,
  setRoomPlayerReady,
} from './room-lifecycle.js';
import {
  emptyRoomStorage,
  migrateRoomStorage,
  type RoomStorage,
  type RoomStorageV2,
} from './storage-schema.js';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-01T00:01:00.000Z';

const withPlayers = (storage: RoomStorage, playerIds: readonly string[]): RoomStorage =>
  playerIds.reduce((next, playerId, index) => {
    const joinedAt = new Date(Date.parse(NOW) + index).toISOString();
    return admitPlayerToRoom(next, playerId, joinedAt);
  }, storage);

const storageV2Fixture = (): RoomStorageV2 => ({
  schemaVersion: 2,
  mapId: 'map:fixture',
  seed: 42,
  createdAt: NOW,
  lifecycle: {
    phase: 'lobby',
    enteredAt: NOW,
  },
  options: {},
  players: {},
  tick: 0,
  baseTick: 0,
  lastPersistedTick: 0,
  lastTickAt: null,
  emptySince: null,
  simState: {},
});

describe('room storage M4 defaults', () => {
  it('creates new rooms with lobby, ready, presence, reconnect, and results defaults', () => {
    const storage = emptyRoomStorage('map:fixture', 42, {}, undefined, NOW);

    expect(storage.schemaVersion).toBe(ROOM_SCHEMA_VERSION);
    expect(storage.lobby).toEqual({ visibility: 'private' });
    expect(storage.ready).toEqual({ players: {} });
    expect(storage.presence).toEqual({ players: {} });
    expect(storage.reconnect).toEqual({ seats: {} });
    expect(storage.results).toBeNull();
  });

  it('migrates v2 room storage by adding M4 state defaults', () => {
    const migrated = migrateRoomStorage(storageV2Fixture());

    expect(migrated.schemaVersion).toBe(ROOM_SCHEMA_VERSION);
    expect(migrated.lobby).toEqual({ visibility: 'private' });
    expect(migrated.ready).toEqual({ players: {} });
    expect(migrated.presence).toEqual({ players: {} });
    expect(migrated.reconnect).toEqual({ seats: {} });
    expect(migrated.results).toBeNull();
  });
});

describe('room join-code policy', () => {
  it('normalizes accepted join codes and rejects ambiguous shapes', () => {
    expect(createRoomJoinCode('ab-c2d3')).toBe('ABC2D3');
    expect(isRoomJoinCode('ABC2D3')).toBe(true);
    expect(isRoomJoinCode('ABC20D')).toBe(false);
    expect(isRoomJoinCode('ABC21D')).toBe(false);
    expect(isRoomJoinCode('ABCI2D')).toBe(false);
    expect(() => createRoomJoinCode('short')).toThrow(/join code/);
  });
});

describe('room admission policy', () => {
  it('keeps admission open for pre-closed phases only', () => {
    expect(allowsRoomAdmissionPhase('lobby')).toBe(true);
    expect(allowsRoomAdmissionPhase('countdown')).toBe(true);
    expect(allowsRoomAdmissionPhase('active')).toBe(true);
    expect(allowsRoomAdmissionPhase('finished')).toBe(false);
    expect(allowsRoomAdmissionPhase('archived')).toBe(false);
  });

  it('rejects pure admission checks after closed phases', () => {
    const storage: RoomStorage = {
      ...emptyRoomStorage('map:fixture', 42, {}, undefined, NOW),
      lifecycle: {
        phase: 'finished',
        enteredAt: NOW,
        finishedAt: NOW,
        reason: 'match complete',
      },
    };

    expect(resolveRoomAdmission(storage, 'player-1')).toMatchObject({
      acceptsPlayers: false,
      closeCode: ROOM_CLOSED_CLOSE_CODE,
      reason: 'room admission closed',
    });
  });
});

describe('room ready-up policy', () => {
  it('requires the minimum player count and every required player to be ready', () => {
    const storage = withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
      'player-1',
      'player-2',
    ]);

    const waiting = resolveRoomReadyGate({
      ...storage,
      ready: {
        players: {
          ...storage.ready.players,
          'player-1': { playerId: 'player-1', isReady: true, updatedAt: LATER },
        },
      },
    });
    expect(waiting).toMatchObject({
      canStart: false,
      playerCount: 2,
      readyPlayerCount: 1,
      missingReadyPlayerIds: ['player-2'],
      reason: 'waiting for required players to ready up',
    });

    const ready = resolveRoomReadyGate({
      ...storage,
      ready: {
        players: {
          'player-1': { playerId: 'player-1', isReady: true, updatedAt: LATER },
          'player-2': { playerId: 'player-2', isReady: true, updatedAt: LATER },
        },
      },
    });
    expect(ready).toMatchObject({
      canStart: true,
      playerCount: 2,
      readyPlayerCount: 2,
      missingReadyPlayerIds: [],
    });
  });

  it('blocks start when the lobby is under the minimum player count', () => {
    const storage = withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
      'player-1',
    ]);

    expect(resolveRoomReadyGate(storage)).toMatchObject({
      canStart: false,
      playerCount: 1,
      minPlayers: 2,
      reason: 'not enough players ready to start',
    });
  });

  it('starts countdown only after every required player is ready', () => {
    const storage = withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
      'player-1',
      'player-2',
    ]);

    const firstReady = setRoomPlayerReady(storage, 'player-1', true, LATER);
    expect(firstReady.readyGate.canStart).toBe(false);
    expect(firstReady.storage.lifecycle.phase).toBe('lobby');

    const secondReady = setRoomPlayerReady(firstReady.storage, 'player-2', true, LATER);
    expect(secondReady.readyGate.canStart).toBe(true);
    expect(secondReady.storage.lifecycle.phase).toBe('countdown');
    expect(secondReady.storage.lifecycle.countdownEndsAt).toBeDefined();
  });

  it('rejects ready updates after the room is active or finished', () => {
    const storage = withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
      'player-1',
      'player-2',
    ]);
    const active: RoomStorage = {
      ...storage,
      lifecycle: {
        phase: 'active',
        enteredAt: LATER,
        activeStartedAt: LATER,
      },
    };
    const finished: RoomStorage = {
      ...storage,
      lifecycle: {
        phase: 'finished',
        enteredAt: LATER,
        finishedAt: LATER,
      },
    };

    expect(() => setRoomPlayerReady(active, 'player-1', true, LATER)).toThrow(
      /room is not waiting/,
    );
    expect(() => setRoomPlayerReady(finished, 'player-1', true, LATER)).toThrow(
      /room is not waiting/,
    );
  });
});

describe('room presence and reconnect policy', () => {
  it('projects presence from storage, ready state, live sockets, and reconnect seats', () => {
    const storage: RoomStorage = {
      ...withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
        'player-1',
        'player-2',
      ]),
      ready: {
        players: {
          'player-1': { playerId: 'player-1', isReady: true, updatedAt: LATER },
        },
      },
      presence: {
        players: {
          'player-1': {
            playerId: 'player-1',
            status: 'connected',
            lastSeenAt: LATER,
            connectedAt: NOW,
          },
          'player-2': {
            playerId: 'player-2',
            status: 'disconnected',
            lastSeenAt: LATER,
            disconnectedAt: LATER,
          },
        },
      },
      reconnect: {
        seats: {
          'player-2': {
            playerId: 'player-2',
            issuedAt: NOW,
            expiresAt: '2026-01-01T00:05:00.000Z',
          },
        },
      },
    };

    expect(projectRoomPresence(storage, { connectedPlayerIds: ['player-1'], now: LATER })).toEqual([
      {
        playerId: 'player-1',
        role: 'participant',
        status: 'connected',
        ready: true,
        reconnectEligible: true,
        lastSeenAt: LATER,
        connectedAt: NOW,
      },
      {
        playerId: 'player-2',
        role: 'participant',
        status: 'disconnected',
        ready: false,
        reconnectEligible: true,
        lastSeenAt: LATER,
        disconnectedAt: LATER,
      },
    ]);
  });

  it('requires an open room, reserved seat, and unexpired reconnect window', () => {
    const storage = withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
      'player-1',
    ]);

    expect(resolveRoomReconnectEligibility(storage, 'player-1', LATER)).toMatchObject({
      eligible: true,
    });
    expect(resolveRoomReconnectEligibility(storage, 'player-unknown', LATER)).toMatchObject({
      eligible: false,
      reason: 'player seat is not reserved',
    });

    const expired: RoomStorage = {
      ...storage,
      reconnect: {
        seats: {
          'player-1': {
            playerId: 'player-1',
            issuedAt: NOW,
            expiresAt: NOW,
          },
        },
      },
    };
    expect(resolveRoomReconnectEligibility(expired, 'player-1', LATER)).toMatchObject({
      eligible: false,
      reason: 'reconnect seat expired',
    });

    const finished: RoomStorage = {
      ...storage,
      lifecycle: {
        phase: 'finished',
        enteredAt: LATER,
        finishedAt: LATER,
      },
    };
    expect(resolveRoomReconnectEligibility(finished, 'player-1', LATER)).toMatchObject({
      eligible: false,
      reason: 'room is closed',
    });
  });

  it('marks disconnected players as reconnect eligible until their seat expires', () => {
    const storage = withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
      'player-1',
    ]);
    const disconnected = markRoomPlayerDisconnected(
      storage,
      'player-1',
      LATER,
      '2026-01-01T00:05:00.000Z',
    );

    expect(disconnected.players['player-1']).toBeDefined();
    expect(projectRoomPresence(disconnected, { now: LATER })).toEqual([
      {
        playerId: 'player-1',
        role: 'participant',
        status: 'disconnected',
        ready: false,
        reconnectEligible: true,
        lastSeenAt: LATER,
        connectedAt: NOW,
        disconnectedAt: LATER,
      },
    ]);
  });
});

describe('room results summary policy', () => {
  it('freezes winner placements and completion time from the first match end', () => {
    const active: RoomStorage = {
      ...withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), [
        'player-1',
        'player-2',
      ]),
      lifecycle: { phase: 'active', enteredAt: NOW, activeStartedAt: NOW },
    };

    const finished = finishRoomFromMatchEnd(active, LATER, 'player-2');
    expect(finished).toMatchObject({
      lifecycle: {
        phase: 'finished',
        finishedAt: LATER,
        reason: 'match complete',
      },
      results: {
        completedAt: LATER,
        reason: 'match complete',
        players: [
          { playerId: 'player-1', outcome: 'completed', placement: 2 },
          { playerId: 'player-2', outcome: 'completed', placement: 1 },
        ],
      },
    });

    expect(finishRoomFromMatchEnd(finished, '2026-01-01T00:02:00.000Z', 'player-1')).toBe(finished);
  });

  it('persists minimal abandoned results from known room participants', () => {
    const storage = markRoomPlayerDisconnected(
      withPlayers(emptyRoomStorage('map:fixture', 42, {}, undefined, NOW), ['player-1']),
      'player-1',
      LATER,
      '2026-01-01T00:05:00.000Z',
    );

    expect(createRoomResultsSummary(storage, LATER, 'reconnect expired')).toEqual({
      completedAt: LATER,
      reason: 'reconnect expired',
      players: [{ playerId: 'player-1', outcome: 'abandoned' }],
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roomUrlMocks = vi.hoisted(() => ({
  parsePlaytestRoomInput: vi.fn(() => ({
    baseUrl: 'http://127.0.0.1:8787',
    roomId: 'room-1',
  })),
  startPlaytestJoinSession: vi.fn(() =>
    Promise.resolve({
      wsUrl: 'ws://127.0.0.1:8787/rooms/room-1/connect',
      playerId: 'player-1',
      handoffToken: 'handoff-1',
      reconnectToken: 'reconnect-1',
    }),
  ),
  getLocalMultiplayerLobby: vi.fn(),
  getLocalMultiplayerResults: vi.fn(() => Promise.resolve(null)),
  setLocalMultiplayerReady: vi.fn(),
}));
const clientMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
const editorUiMocks = vi.hoisted(() => ({
  setPlaytestMode: vi.fn(),
  setPlaytestActive: vi.fn(),
  setPlaytestJoinModalOpen: vi.fn(),
  resetMultiplayerPlaytest: vi.fn(),
}));

vi.mock('@/lib/playtest-room-url', () => ({
  ...roomUrlMocks,
  createLocalMultiplayerRoom: vi.fn(),
}));
vi.mock('@/lib/playtest-multiplayer-client', () => ({
  PlaytestMultiplayerClient: class PlaytestMultiplayerClient {
    connect = clientMocks.connect;
    disconnect = clientMocks.disconnect;
  },
}));
vi.mock('@/lib/playtest-plugin-bridge', () => ({
  resolvePlaytestPlugin: vi.fn(() => ({})),
}));
vi.mock('@/lib/lobby-model-selection', () => ({ readLobbyModelSelection: vi.fn() }));
vi.mock('@/stores/app-notifications-store', () => ({
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock('@/stores/editor-commands-bridge', () => ({
  useEditorCommandsBridge: { getState: () => ({ flushPersistFor: vi.fn() }) },
}));
vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: { getState: () => editorUiMocks },
}));

import { usePlaytestMultiplayerStore } from '@/stores/playtest-multiplayer-store';

const lobby = (phase: 'lobby' | 'countdown' | 'active' | 'finished' = 'lobby') => ({
  roomId: 'room-1',
  mapId: 'map-1',
  phase,
  lobby: { visibility: 'private' as const },
  playerCount: 2,
  maxPlayers: 8,
  minReadyPlayers: 2,
  canStart: phase !== 'lobby',
  players: [
    {
      playerId: 'player-1',
      status: 'connected' as const,
      ready: false,
      reconnectEligible: true,
      lastSeenAt: null,
    },
    {
      playerId: 'player-2',
      status: 'connected' as const,
      ready: false,
      reconnectEligible: true,
      lastSeenAt: null,
    },
  ],
});

describe('playtest multiplayer lobby coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    roomUrlMocks.getLocalMultiplayerLobby.mockResolvedValue(lobby());
    roomUrlMocks.setLocalMultiplayerReady.mockResolvedValue(lobby('countdown'));
    usePlaytestMultiplayerStore.getState().reset();
  });

  afterEach(() => {
    usePlaytestMultiplayerStore.getState().reset();
    vi.useRealTimers();
  });

  it('retains participant credentials, remains in the lobby, and cleans up polling on reset', async () => {
    await usePlaytestMultiplayerStore
      .getState()
      .joinFromInput(
        'http://127.0.0.1:8787/rooms/room-1',
        'battle-royale.renderer',
        'map-1',
        64,
        64,
      );
    await vi.advanceTimersByTimeAsync(0);

    expect(usePlaytestMultiplayerStore.getState()).toMatchObject({
      flowPhase: 'lobby',
      participantSession: {
        roomId: 'room-1',
        playerId: 'player-1',
        handoffToken: 'handoff-1',
        reconnectToken: 'reconnect-1',
      },
      lobbyState: { phase: 'lobby' },
    });
    expect(clientMocks.connect).toHaveBeenCalledWith(
      'ws://127.0.0.1:8787/rooms/room-1/connect',
      'player-1',
    );
    expect(editorUiMocks.setPlaytestActive).toHaveBeenCalledWith(true);

    await usePlaytestMultiplayerStore.getState().setLocalReady(true);
    expect(roomUrlMocks.setLocalMultiplayerReady).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: 'player-1',
        reconnectToken: 'reconnect-1',
      }),
      true,
    );
    expect(usePlaytestMultiplayerStore.getState()).toMatchObject({
      flowPhase: 'countdown',
      lobbyState: { phase: 'countdown' },
    });

    const pollCount = roomUrlMocks.getLocalMultiplayerLobby.mock.calls.length;
    usePlaytestMultiplayerStore.getState().reset();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(roomUrlMocks.getLocalMultiplayerLobby).toHaveBeenCalledTimes(pollCount);
    expect(clientMocks.disconnect).toHaveBeenCalled();
  });
});

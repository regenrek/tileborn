import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getLocalMultiplayerLobby,
  getLocalMultiplayerResults,
  setLocalMultiplayerReady,
  startPlaytestJoinSession,
} from '@/lib/playtest-room-url';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const lobby = {
  roomId: 'room-1',
  mapId: 'map-1',
  phase: 'lobby' as const,
  lobby: { visibility: 'private' as const },
  playerCount: 1,
  maxPlayers: 8,
  minReadyPlayers: 2,
  canStart: false,
  players: [],
};

describe('playtest room HTTP contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retains join credentials and sends the reconnect token when readying', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          wsUrl: 'http://127.0.0.1:8787/rooms/room-1/connect',
          playerId: 'player-1',
          handoffToken: 'handoff-1',
          reconnectToken: 'reconnect-1',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ lobby, canStart: false }));
    vi.stubGlobal('fetch', fetchMock);

    const joined = await startPlaytestJoinSession('http://127.0.0.1:8787', 'room-1');
    expect(joined).toEqual({
      wsUrl: 'ws://127.0.0.1:8787/rooms/room-1/connect',
      playerId: 'player-1',
      handoffToken: 'handoff-1',
      reconnectToken: 'reconnect-1',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8787/playtest/start');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      options: { idempotencyKey: 'room-1' },
    });

    await setLocalMultiplayerReady(
      {
        ...joined,
        baseUrl: 'http://127.0.0.1:8787',
        roomId: 'room-1',
      },
      true,
    );

    const readyCall = fetchMock.mock.calls[1];
    expect(String(readyCall?.[0])).toBe('http://127.0.0.1:8787/lobbies/room-1/ready');
    expect(JSON.parse(String(readyCall?.[1]?.body))).toEqual({
      playerId: 'player-1',
      ready: true,
      reconnectToken: 'reconnect-1',
    });
  });

  it('reads lobby lifecycle and terminal results from their canonical endpoints', async () => {
    const results = {
      completedAt: '2026-07-14T12:00:00.000Z',
      reason: 'last-player-standing',
      players: [{ playerId: 'player-1', outcome: 'winner', placement: 1 }],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(lobby))
      .mockResolvedValueOnce(jsonResponse({ roomId: 'room-1', results }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLocalMultiplayerLobby('http://127.0.0.1:8787', 'room-1')).resolves.toEqual(
      lobby,
    );
    await expect(getLocalMultiplayerResults('http://127.0.0.1:8787', 'room-1')).resolves.toEqual(
      results,
    );

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:8787/lobbies/room-1',
      'http://127.0.0.1:8787/rooms/room-1/results',
    ]);
  });
});

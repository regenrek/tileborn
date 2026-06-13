import { afterEach, describe, expect, it } from 'vitest';

import {
  SMOKE_ASSET_PACK_ID,
  SMOKE_PLUGIN_ID,
  SMOKE_RUNTIME_VERSION,
  SMOKE_SEED,
} from './fixtures/smoke-manifest.js';
import { bootMiniflare } from './setup.js';
import {
  attachSnapshotAck,
  delay,
  encodeInputCommand,
  isDeltaForPlayer,
  isWelcomeForPlayer,
  parseJson,
  tamperHandoffToken,
  waitForMessage,
  type DiscoverPayload,
  type HealthPayload,
  type PlaytestStartPayload,
  type StructuredErrorPayload,
} from './wire-helpers.js';
import type {
  LobbyCreateResponse,
  LobbyJoinResponse,
  LobbyReadyResponse,
  PlaytestSummary,
  RoomLobbySummary,
  RoomReconnectResponse,
  RoomResultsResponse,
} from '../types.js';
import type { WebSocket as MiniflareWebSocket } from 'miniflare';

/**
 * Room creation is explicit (hard cut): `/playtest/start` only joins an
 * EXISTING room, so every smoke flow creates the room via `/rooms/create`
 * first (idempotent per idempotencyKey) and then joins it.
 */
const createRoom = async (
  harness: Awaited<ReturnType<typeof bootMiniflare>>,
  idempotencyKey: string,
  options: Record<string, string | number | boolean> = {},
): Promise<string> => {
  const response = await harness.fetch('http://localhost/rooms/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mapId: 'map:smoke',
      seed: SMOKE_SEED,
      options: { idempotencyKey, ...options },
    }),
  });
  expect(response.status).toBe(201);
  const created = await parseJson<{ readonly roomId: string }>(response);
  return created.roomId;
};

const joinPlaytest = async (
  harness: Awaited<ReturnType<typeof bootMiniflare>>,
  roomId: string,
  playerId?: string,
) =>
  harness.fetch('http://localhost/playtest/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mapId: 'map:smoke',
      seed: SMOKE_SEED,
      ...(playerId === undefined ? {} : { playerId }),
      options: { idempotencyKey: roomId },
    }),
  });

type ReservedLobbyCreateResponse = LobbyCreateResponse & {
  readonly playerId: string;
  readonly handoffToken: string;
  readonly reconnectToken: string;
};

type ReservedLobbyJoinResponse = LobbyJoinResponse & {
  readonly reconnectToken: string;
};

type SmokeHarness = Awaited<ReturnType<typeof bootMiniflare>>;
type SmokeFetchResponse = Awaited<ReturnType<SmokeHarness['fetch']>>;
type ReadyPlayerCredential = {
  readonly playerId: string;
  readonly reconnectToken: string;
};

const postJson = (
  harness: SmokeHarness,
  path: string,
  body: unknown,
): Promise<SmokeFetchResponse> =>
  harness.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const lobbyPlayer = (
  lobby: RoomLobbySummary,
  playerId: string,
): RoomLobbySummary['players'][number] | undefined =>
  lobby.players.find((player) => player.playerId === playerId);

const waitForLobbyPlayer = async (
  harness: Awaited<ReturnType<typeof bootMiniflare>>,
  roomId: string,
  playerId: string,
  predicate: (player: RoomLobbySummary['players'][number], lobby: RoomLobbySummary) => boolean,
  label: string,
): Promise<RoomLobbySummary> => {
  const deadline = performance.now() + 1_000;
  let lastSummary: RoomLobbySummary | null = null;
  while (performance.now() < deadline) {
    const response = await harness.fetch(`http://localhost/lobbies/${roomId}`);
    expect(response.status).toBe(200);
    const lobby = await parseJson<RoomLobbySummary>(response);
    lastSummary = lobby;
    const player = lobbyPlayer(lobby, playerId);
    if (player !== undefined && predicate(player, lobby)) {
      return lobby;
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}; last lobby=${JSON.stringify(lastSummary)}`);
};

const readyPlayersAndStart = async (
  harness: Awaited<ReturnType<typeof bootMiniflare>>,
  roomId: string,
  players: readonly ReadyPlayerCredential[],
): Promise<RoomLobbySummary> => {
  for (const player of players) {
    const response = await postJson(harness, `/lobbies/${roomId}/ready`, {
      playerId: player.playerId,
      ready: true,
      reconnectToken: player.reconnectToken,
    });
    expect(response.status).toBe(200);
  }
  await harness.triggerRoomAlarm(roomId);
  const response = await harness.fetch(`http://localhost/lobbies/${roomId}`);
  expect(response.status).toBe(200);
  const lobby = await parseJson<RoomLobbySummary>(response);
  expect(lobby.phase).toBe('active');
  return lobby;
};

const closeSocketQuietly = (socket: MiniflareWebSocket): void => {
  try {
    socket.close(1000, 'done');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already closed')) {
      throw error;
    }
  }
};

describe('game-host smoke — health and discover', () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  it('GET /health returns ok with version and buildId', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch('http://localhost/health');
    expect(response.status).toBe(200);
    const body = await parseJson<HealthPayload>(response);
    expect(body.status).toBe('ok');
    expect(body.version?.length).toBeGreaterThan(0);
    expect(body.buildId?.length).toBeGreaterThan(0);
  });

  it('GET /discover returns bundled manifest with plugin and asset pack', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch('http://localhost/discover');
    expect(response.status).toBe(200);
    const body = await parseJson<DiscoverPayload>(response);
    expect(body.plugin.id).toBe(SMOKE_PLUGIN_ID);
    expect(body.assetPacks.length).toBeGreaterThanOrEqual(1);
    expect(body.assetPacks[0]?.id).toBe(SMOKE_ASSET_PACK_ID);
    expect(body.runtimeVersion).toBe(SMOKE_RUNTIME_VERSION);
    expect(body.protocolVersion).toBe(1);
    expect(body.buildId).toMatch(/^sha256:/);
  });
});

describe('game-host smoke — playtest creation', () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  it('POST /playtest/start joins an existing room and returns playtestId, wsUrl, handoffToken, and playerId', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomId = await createRoom(harness, 'playtest-join-smoke');
    const response = await joinPlaytest(harness, roomId);
    expect(response.status).toBe(201);
    const body = await parseJson<PlaytestStartPayload>(response);
    expect(body.playtestId).toBe(roomId);
    expect(body.wsUrl).toContain('/playtest/');
    expect(body.handoffToken.length).toBeGreaterThan(0);
    expect(body.playerId.length).toBeGreaterThan(0);
  });

  it('POST /playtest/start returns 404 for an unknown room (joining never creates)', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await joinPlaytest(harness, 'room-that-was-never-created');
    expect(response.status).toBe(404);
    const body = await parseJson<StructuredErrorPayload>(response);
    expect(body.error).toBe('playtest not found');
  });

  it('POST /playtest/start joins the same room repeatedly for the same idempotency key', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomId = await createRoom(harness, 'playtest-idem-smoke');
    const first = await joinPlaytest(harness, roomId, 'player-1');
    const second = await joinPlaytest(harness, roomId, 'player-2');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await parseJson<PlaytestStartPayload>(first);
    const secondBody = await parseJson<PlaytestStartPayload>(second);
    expect(firstBody.playtestId).toBe('playtest-idem-smoke');
    expect(secondBody.playtestId).toBe('playtest-idem-smoke');
  });

  it('adds CORS headers to proxied playtest summary responses', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomId = await createRoom(harness, 'playtest-summary-cors-smoke');
    const start = await joinPlaytest(harness, roomId);
    expect(start.status).toBe(201);
    const started = await parseJson<PlaytestStartPayload>(start);

    const summary = await harness.fetch(`http://localhost/playtest/${started.playtestId}`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(summary.status).toBe(200);
    expect(summary.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /playtest/start returns 400 when mapId is missing', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: SMOKE_SEED }),
    });
    expect(response.status).toBe(400);
    const body = await parseJson<StructuredErrorPayload>(response);
    expect(body.error).toContain('mapId');
  });
});

describe('game-host smoke — M4 two-client lobby proof', () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  it('proves join-code lobby, ready start, reconnect resume, and observable results summary', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const sockets: MiniflareWebSocket[] = [];

    try {
      const createResponse = await postJson(harness, '/lobbies/create', {
        mapId: 'map:smoke',
        displayName: 'M4 smoke lobby',
        visibility: 'private',
        reserveCreator: true,
        playerDisplayName: 'Ada',
      });
      expect(createResponse.status).toBe(201);
      const created = await parseJson<ReservedLobbyCreateResponse>(createResponse);
      expect(created.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(created.roomId).toBe(`lobby-${created.joinCode}`);
      expect(created.joinUrl).toBe(`http://localhost/lobbies/join?code=${created.joinCode}`);
      expect(created.wsUrl).toContain(`/rooms/${created.roomId}/connect`);
      expect(created.wsUrl).toContain(`playerId=${created.playerId}`);
      expect(created.handoffToken.length).toBeGreaterThan(0);
      expect(created.reconnectToken.length).toBeGreaterThan(0);
      expect(created.lobby.players).toHaveLength(1);
      expect(lobbyPlayer(created.lobby, created.playerId)).toMatchObject({
        displayName: 'Ada',
        ready: false,
        reconnectEligible: true,
      });

      const creatorSocket = await harness.websocketConnect(created.wsUrl);
      sockets.push(creatorSocket);
      await waitForMessage(creatorSocket, (message) => isWelcomeForPlayer(message, created.playerId), {
        timeoutMs: 1_000,
        label: 'creator WelcomeSnapshot',
      });

      const joinResponse = await postJson(harness, '/lobbies/join', {
        joinCode: created.joinCode.toLowerCase(),
        displayName: 'Grace',
      });
      expect(joinResponse.status).toBe(201);
      const joined = await parseJson<ReservedLobbyJoinResponse>(joinResponse);
      expect(joined.roomId).toBe(created.roomId);
      expect(joined.playerId).not.toBe(created.playerId);
      expect(joined.wsUrl).toContain(`/rooms/${created.roomId}/connect`);
      expect(joined.wsUrl).toContain(`playerId=${joined.playerId}`);
      expect(joined.handoffToken.length).toBeGreaterThan(0);
      expect(joined.reconnectToken.length).toBeGreaterThan(0);
      expect(joined.lobby.players.map((player) => player.playerId).sort()).toEqual([
        created.playerId,
        joined.playerId,
      ]);
      expect(lobbyPlayer(joined.lobby, joined.playerId)).toMatchObject({
        displayName: 'Grace',
        ready: false,
        reconnectEligible: true,
      });

      const joinerSocket = await harness.websocketConnect(joined.wsUrl);
      sockets.push(joinerSocket);
      await waitForMessage(joinerSocket, (message) => isWelcomeForPlayer(message, joined.playerId), {
        timeoutMs: 1_000,
        label: 'joiner WelcomeSnapshot',
      });

      const codeSummary = await parseJson<RoomLobbySummary>(
        await harness.fetch(`http://localhost/lobbies/code/${created.joinCode}`),
      );
      expect(codeSummary).toMatchObject({
        roomId: created.roomId,
        playerCount: 2,
        minReadyPlayers: 2,
        canStart: false,
      });
      expect(codeSummary.players.map((player) => player.playerId).sort()).toEqual([
        created.playerId,
        joined.playerId,
      ]);

      const firstReadyResponse = await postJson(harness, `/lobbies/${created.roomId}/ready`, {
        playerId: created.playerId,
        ready: true,
        reconnectToken: created.reconnectToken,
      });
      expect(firstReadyResponse.status).toBe(200);
      const firstReady = await parseJson<LobbyReadyResponse>(firstReadyResponse);
      expect(firstReady.canStart).toBe(false);
      expect(firstReady.lobby.phase).toBe('lobby');
      expect(lobbyPlayer(firstReady.lobby, created.playerId)).toMatchObject({ ready: true });

      const secondReadyResponse = await postJson(harness, `/lobbies/${created.roomId}/ready`, {
        playerId: joined.playerId,
        ready: true,
        reconnectToken: joined.reconnectToken,
      });
      expect(secondReadyResponse.status).toBe(200);
      const secondReady = await parseJson<LobbyReadyResponse>(secondReadyResponse);
      expect(secondReady.canStart).toBe(true);
      expect(secondReady.lobby.phase).toBe('countdown');
      expect(secondReady.lobby.players.map((player) => player.ready)).toEqual([true, true]);

      await harness.triggerRoomAlarm(created.roomId);
      const activeSummary = await waitForLobbyPlayer(
        harness,
        created.roomId,
        created.playerId,
        (_player, lobby) => lobby.phase === 'active',
        'active lobby phase',
      );
      expect(activeSummary.canStart).toBe(false);
      expect(activeSummary.players.map((player) => player.ready)).toEqual([true, true]);

      const playtestSummary = await parseJson<PlaytestSummary>(
        await harness.fetch(`http://localhost/playtest/${created.roomId}`),
      );
      expect(playtestSummary.metrics).toMatchObject({
        lifecyclePhase: 'active',
        playerCount: 2,
        connectedClients: 2,
      });

      const liveResults = await parseJson<RoomResultsResponse>(
        await harness.fetch(`http://localhost/rooms/${created.roomId}/results`),
      );
      expect(liveResults).toEqual({ roomId: created.roomId, results: null });

      creatorSocket.close(1000, 'simulate disconnect');
      const disconnectedSummary = await waitForLobbyPlayer(
        harness,
        created.roomId,
        created.playerId,
        (player) => player.status === 'disconnected' && player.reconnectEligible === true,
        'creator disconnect presence',
      );
      expect(lobbyPlayer(disconnectedSummary, created.playerId)).toMatchObject({
        ready: true,
        status: 'disconnected',
      });

      const reconnectResponse = await postJson(harness, '/rooms/reconnect', {
        roomId: created.roomId,
        playerId: created.playerId,
        reconnectToken: created.reconnectToken,
      });
      expect(reconnectResponse.status).toBe(200);
      const reconnected = await parseJson<RoomReconnectResponse>(reconnectResponse);
      expect(reconnected.roomId).toBe(created.roomId);
      expect(reconnected.playerId).toBe(created.playerId);
      expect(reconnected.wsUrl).toContain(`/rooms/${created.roomId}/connect`);
      expect(reconnected.wsUrl).toContain(`playerId=${created.playerId}`);
      expect(reconnected.handoffToken.length).toBeGreaterThan(0);
      expect(reconnected.reconnectToken?.length).toBeGreaterThan(0);

      const reconnectedSocket = await harness.websocketConnect(reconnected.wsUrl);
      sockets.push(reconnectedSocket);
      await waitForMessage(
        reconnectedSocket,
        (message) => isWelcomeForPlayer(message, created.playerId),
        {
          timeoutMs: 1_000,
          label: 'reconnected creator WelcomeSnapshot',
        },
      );
      const resumedSummary = await waitForLobbyPlayer(
        harness,
        created.roomId,
        created.playerId,
        (player, lobby) => lobby.phase === 'active' && player.status === 'connected',
        'creator reconnect presence',
      );
      expect(lobbyPlayer(resumedSummary, created.playerId)).toMatchObject({
        ready: true,
        status: 'connected',
      });
    } finally {
      for (const socket of sockets) {
        closeSocketQuietly(socket);
      }
    }
  });
});

describe('game-host smoke — handoff and websocket upgrade', () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  const startPlaytest = async (
    harness: Awaited<ReturnType<typeof bootMiniflare>>,
  ): Promise<PlaytestStartPayload> => {
    const roomId = await createRoom(harness, 'smoke-handoff-room');
    const response = await joinPlaytest(harness, roomId);
    expect(response.status).toBe(201);
    return parseJson<PlaytestStartPayload>(response);
  };

  it('connects with a valid handoff token and receives a player welcome within 200ms', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const started = await startPlaytest(harness);
    const socket = await harness.websocketConnect(started.wsUrl);
    const welcome = await waitForMessage(socket, (message) => isWelcomeForPlayer(message, started.playerId), {
      timeoutMs: 200,
      label: 'WelcomeSnapshot',
    });
    expect(welcome._tag).toBe('WelcomeSnapshot');
    socket.close(1000, 'done');
  });

  it('rejects a shared room websocket when configured capacity is reached', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const idempotencyKey = 'smoke-capacity-room';
    const roomId = await createRoom(harness, idempotencyKey, { maxPlayers: 1 });
    const start = async (playerId: string): Promise<PlaytestStartPayload> => {
      const response = await joinPlaytest(harness, roomId, playerId);
      expect(response.status).toBe(201);
      return parseJson<PlaytestStartPayload>(response);
    };

    const first = await start('player-1');
    const firstSocket = await harness.websocketConnect(first.wsUrl);
    await waitForMessage(
      firstSocket,
      (message) => isWelcomeForPlayer(message, 'player-1'),
      {
        timeoutMs: 500,
        label: 'player-1 WelcomeSnapshot',
      },
    );

    const second = await joinPlaytest(harness, roomId);
    expect(second.status).toBe(409);
    expect(await parseJson<{ readonly error: string }>(second)).toEqual({
      error: 'room capacity reached',
    });
    firstSocket.close(1000, 'done');
  });

  it('rejects websocket upgrade with 401 when the handoff token is missing', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const started = await startPlaytest(harness);
    const url = new URL(started.wsUrl);
    url.searchParams.delete('token');
    const response = await harness.fetch(url.toString(), {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        Origin: 'http://localhost',
      },
    });
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeFalsy();
  });

  it('rejects websocket upgrade with 401 when the handoff token is tampered', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const started = await startPlaytest(harness);
    const url = new URL(started.wsUrl);
    url.searchParams.set('token', tamperHandoffToken(started.handoffToken));
    const response = await harness.fetch(url.toString(), {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        Origin: 'http://localhost',
      },
    });
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeFalsy();
  });
});

describe('game-host smoke — live simulation fanout', () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  const startSharedRoom = async (
    harness: Awaited<ReturnType<typeof bootMiniflare>>,
    idempotencyKey: string,
    playerId: string,
    maxPlayers?: number,
  ): Promise<PlaytestStartPayload> => {
    // /rooms/create is idempotent per key, so every player can run it.
    const roomId = await createRoom(
      harness,
      idempotencyKey,
      maxPlayers === undefined ? {} : { maxPlayers },
    );
    const response = await joinPlaytest(harness, roomId, playerId);
    expect(response.status).toBe(201);
    return parseJson<PlaytestStartPayload>(response);
  };

  it.each([2, 4, 16] as const)(
    'admits and fans out DeltaSnapshot to %i connected players within load budget',
    async (playerCount) => {
      const harness = await bootMiniflare();
      dispose = harness.mfDispose;
      const roomKey = `smoke-room-load-${playerCount}`;
      const players = Array.from(
        { length: playerCount },
        (_, index) => `player-${index + 1}`,
      );
      const sockets: MiniflareWebSocket[] = [];
      const readyCredentials: ReadyPlayerCredential[] = [];
      const cleanupAcks: (() => void)[] = [];
      const connectStarted = performance.now();
      try {
        for (const playerId of players) {
          const started = await startSharedRoom(harness, roomKey, playerId, playerCount);
          expect(started.playtestId).toBe(roomKey);
          readyCredentials.push({ playerId, reconnectToken: started.reconnectToken });
          const socket = await harness.websocketConnect(started.wsUrl);
          cleanupAcks.push(attachSnapshotAck(socket));
          await waitForMessage(socket, (message) => isWelcomeForPlayer(message, playerId), {
            timeoutMs: 1_000,
            label: `WelcomeSnapshot(${playerId})`,
          });
          sockets.push(socket);
        }
        await readyPlayersAndStart(harness, roomKey, readyCredentials);
        const connectElapsedMs = performance.now() - connectStarted;
        expect(connectElapsedMs).toBeLessThan(5_000);

        const summary = await parseJson<{
          readonly connectedClients: number;
          readonly metrics: {
            readonly connectedClients: number;
            readonly playerCount: number;
          };
        }>(await harness.fetch(`http://localhost/playtest/${roomKey}`));
        expect(summary.connectedClients).toBe(playerCount);
        expect(summary.metrics.connectedClients).toBe(playerCount);
        expect(summary.metrics.playerCount).toBe(playerCount);

        const fanoutStarted = performance.now();
        const senderId = players[0]!;
        const deltaWaits = sockets.slice(1).map((socket, index) =>
          waitForMessage(socket, (message) => isDeltaForPlayer(message, senderId), {
            timeoutMs: 2_500,
            label: `DeltaSnapshot(${players[index + 1]})`,
          }),
        );
        sockets[0]!.send(encodeInputCommand(senderId, 1, { move: 'south' }));
        await harness.triggerRoomAlarm(roomKey);
        await harness.triggerRoomAlarm(roomKey);
        try {
          await Promise.all(deltaWaits);
        } catch (error) {
          const failureSummary = await parseJson<{
            readonly metrics: {
              readonly tick: number;
              readonly lifecyclePhase: string;
              readonly connectedClients: number;
              readonly playerCount: number;
              readonly pendingPluginFrames: number;
              readonly replayFrames: number;
              readonly transport: {
                readonly trackedClients: number;
                readonly maxPendingSnapshotLagTicks: number;
                readonly totalDroppedOutboundFrames: number;
                readonly totalResyncs: number;
                readonly totalStaleSnapshotAcks: number;
              };
            };
          }>(await harness.fetch(`http://localhost/playtest/${roomKey}`));
          throw new Error(
            `load fanout failed for ${playerCount} players; metrics=${JSON.stringify(failureSummary.metrics)}`,
            { cause: error },
          );
        }
        expect(performance.now() - fanoutStarted).toBeLessThan(2_500);
      } finally {
        for (const cleanupAck of cleanupAcks) {
          cleanupAck();
        }
        for (const socket of sockets) {
          socket.close(1000, 'done');
        }
      }
    },
  );

  it('fans out DeltaSnapshot to three connected players', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomKey = 'smoke-room-fanout';
    const players = ['player-1', 'player-2', 'player-3'] as const;
    const sockets: MiniflareWebSocket[] = [];
    const readyCredentials: ReadyPlayerCredential[] = [];
    for (const playerId of players) {
      const started = await startSharedRoom(harness, roomKey, playerId);
      readyCredentials.push({ playerId, reconnectToken: started.reconnectToken });
      const socket = await harness.websocketConnect(started.wsUrl);
      await waitForMessage(socket, (message) => isWelcomeForPlayer(message, playerId), {
        timeoutMs: 1_000,
        label: `WelcomeSnapshot(${playerId})`,
      });
      sockets.push(socket);
    }
    await readyPlayersAndStart(harness, roomKey, readyCredentials);
    const deltaWaits = sockets.map((socket, index) =>
      waitForMessage(socket, (message) => message._tag === 'DeltaSnapshot', {
        timeoutMs: 1_000,
        label: `DeltaSnapshot(${players[index]})`,
      }),
    );
    await harness.triggerRoomAlarm(roomKey);
    await Promise.all(deltaWaits);
    for (const socket of sockets) {
      socket.close(1000, 'done');
    }
  });

  it('delivers SnapshotDelta within two ticks after InputCommand', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const senderId = 'player-1';
    const observerId = 'player-2';
    const sender = await startSharedRoom(harness, 'smoke-input-room', senderId);
    const observer = await startSharedRoom(harness, 'smoke-input-room', observerId);
    const senderSocket = await harness.websocketConnect(sender.wsUrl);
    const senderJoin = waitForMessage(
      senderSocket,
      (message) => isWelcomeForPlayer(message, senderId),
      {
        timeoutMs: 500,
        label: 'sender WelcomeSnapshot',
      },
    );
    const observerSocket = await harness.websocketConnect(observer.wsUrl);
    const observerJoin = waitForMessage(
      observerSocket,
      (message) => isWelcomeForPlayer(message, observerId),
      { timeoutMs: 500, label: 'observer WelcomeSnapshot' },
    );
    await Promise.all([senderJoin, observerJoin]);
    await readyPlayersAndStart(harness, sender.playtestId, [
      { playerId: senderId, reconnectToken: sender.reconnectToken },
      { playerId: observerId, reconnectToken: observer.reconnectToken },
    ]);
    const deltaWait = waitForMessage(observerSocket, (message) => isDeltaForPlayer(message, senderId), {
      timeoutMs: 1_000,
      label: 'sender DeltaSnapshot',
    });
    senderSocket.send(encodeInputCommand(senderId, 1, { move: 'north' }));
    await harness.triggerRoomAlarm(sender.playtestId);
    await harness.triggerRoomAlarm(sender.playtestId);
    const delta = await deltaWait;
    expect(delta._tag).toBe('DeltaSnapshot');
    if (delta._tag === 'DeltaSnapshot') {
      expect(delta.tick).toBeGreaterThan(0);
    }
    senderSocket.close(1000, 'done');
    observerSocket.close(1000, 'done');
  });

  it('expires an idle websocket after heartbeat timeout', async () => {
    const harness = await bootMiniflare({ heartbeatTimeoutSeconds: 1 });
    dispose = harness.mfDispose;
    const roomKey = 'smoke-heartbeat-room';
    const stale = await startSharedRoom(harness, roomKey, 'player-1');
    const staleSocket = await harness.websocketConnect(stale.wsUrl);
    await waitForMessage(
      staleSocket,
      (message) => isWelcomeForPlayer(message, 'player-1'),
      {
        timeoutMs: 500,
        label: 'stale WelcomeSnapshot',
      },
    );
    await delay(1_100);
    await harness.triggerRoomAlarm(roomKey);
    await delay(200);
    const summary = await parseJson<{
      readonly connectedClients: number;
      readonly metrics: {
        readonly lifecyclePhase: string;
        readonly connectedClients: number;
        readonly playerCount: number;
        readonly transport: {
          readonly trackedClients: number;
        };
      };
    }>(await harness.fetch(`http://localhost/playtest/${roomKey}`));
    expect(summary.connectedClients).toBe(0);
    expect(summary.metrics.lifecyclePhase).toBe('lobby');
    expect(summary.metrics.connectedClients).toBe(0);
    expect(summary.metrics.playerCount).toBe(1);
    expect(summary.metrics.transport.trackedClients).toBe(0);

    const lobby = await parseJson<RoomLobbySummary>(
      await harness.fetch(`http://localhost/lobbies/${roomKey}`),
    );
    expect(lobbyPlayer(lobby, 'player-1')).toMatchObject({
      status: 'disconnected',
      reconnectEligible: true,
    });
    closeSocketQuietly(staleSocket);
  });

  it('marks a peer disconnected while keeping its reconnect seat', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomKey = 'smoke-cancel-room';
    const leaverId = 'player-1';
    const peerId = 'player-2';
    const leaver = await startSharedRoom(harness, roomKey, leaverId);
    const peer = await startSharedRoom(harness, roomKey, peerId);
    const leaverSocket = await harness.websocketConnect(leaver.wsUrl);
    await waitForMessage(
      leaverSocket,
      (message) => isWelcomeForPlayer(message, leaverId),
      {
        timeoutMs: 500,
        label: 'leaver WelcomeSnapshot',
      },
    );
    const peerSocket = await harness.websocketConnect(peer.wsUrl);
    const peerJoin = waitForMessage(
      peerSocket,
      (message) => isWelcomeForPlayer(message, peerId),
      {
        timeoutMs: 500,
        label: 'peer WelcomeSnapshot',
      },
    );
    await peerJoin;
    leaverSocket.close(1000, 'sigint');
    await delay(200);
    const summary = await parseJson<{
      readonly connectedClients: number;
      readonly metrics: {
        readonly connectedClients: number;
        readonly playerCount: number;
      };
    }>(await harness.fetch(`http://localhost/playtest/${roomKey}`));
    expect(summary.connectedClients).toBe(1);
    expect(summary.metrics.connectedClients).toBe(1);
    expect(summary.metrics.playerCount).toBe(2);

    const lobby = await parseJson<RoomLobbySummary>(
      await harness.fetch(`http://localhost/lobbies/${roomKey}`),
    );
    expect(lobbyPlayer(lobby, leaverId)).toMatchObject({
      status: 'disconnected',
      reconnectEligible: true,
    });
    expect(lobbyPlayer(lobby, peerId)).toMatchObject({ status: 'connected' });
    peerSocket.close(1000, 'done');
  });
});

describe('game-host smoke — failure modes', () => {
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
  });

  it('returns 503 on /health and 503 on /playtest/start when HANDOFF_SIGNING_KEY is missing', async () => {
    const harness = await bootMiniflare({ includeSigningKey: false });
    dispose = harness.mfDispose;
    const health = await harness.fetch('http://localhost/health');
    expect(health.status).toBe(503);
    const healthBody = await parseJson<HealthPayload>(health);
    expect(healthBody.status).toBe('unavailable');
    const start = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapId: 'map:smoke' }),
    });
    expect([500, 503]).toContain(start.status);
  });
});

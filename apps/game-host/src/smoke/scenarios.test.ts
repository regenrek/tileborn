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
import type { WebSocket as MiniflareWebSocket } from 'miniflare';

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

  it('POST /playtest/start returns playtestId, wsUrl, handoffToken, and playerId', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const response = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapId: 'map:smoke', seed: SMOKE_SEED }),
    });
    expect(response.status).toBe(201);
    const body = await parseJson<PlaytestStartPayload>(response);
    expect(body.playtestId.length).toBeGreaterThan(0);
    expect(body.wsUrl).toContain('/playtest/');
    expect(body.handoffToken.length).toBeGreaterThan(0);
    expect(body.playerId.length).toBeGreaterThan(0);
  });

  it('POST /playtest/start is idempotent for the same idempotency key', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const payload = {
      mapId: 'map:smoke',
      seed: SMOKE_SEED,
      options: { idempotencyKey: 'playtest-idem-smoke' },
    };
    const first = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const second = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
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
    const start = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mapId: 'map:smoke',
        seed: SMOKE_SEED,
        options: { idempotencyKey: 'playtest-summary-cors-smoke' },
      }),
    });
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
    const response = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapId: 'map:smoke', seed: SMOKE_SEED }),
    });
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
    const start = async (playerId: string): Promise<PlaytestStartPayload> => {
      const response = await harness.fetch('http://localhost/playtest/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: 'map:smoke',
          seed: SMOKE_SEED,
          playerId,
          options: { idempotencyKey, maxPlayers: 1 },
        }),
      });
      expect(response.status).toBe(201);
      return parseJson<PlaytestStartPayload>(response);
    };

    const first = await start('player-a');
    const firstSocket = await harness.websocketConnect(first.wsUrl);
    await waitForMessage(
      firstSocket,
      (message) => isWelcomeForPlayer(message, 'player-a'),
      {
        timeoutMs: 500,
        label: 'player-a WelcomeSnapshot',
      },
    );

    const second = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mapId: 'map:smoke',
        seed: SMOKE_SEED,
        playerId: 'player-b',
        options: { idempotencyKey, maxPlayers: 1 },
      }),
    });
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
    const response = await harness.fetch('http://localhost/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mapId: 'map:smoke',
        seed: SMOKE_SEED,
        playerId,
        options: { idempotencyKey, ...(maxPlayers === undefined ? {} : { maxPlayers }) },
      }),
    });
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
        (_, index) => `player-${playerCount}-${String(index + 1).padStart(2, '0')}`,
      );
      const sockets: MiniflareWebSocket[] = [];
      const cleanupAcks: (() => void)[] = [];
      const connectStarted = performance.now();
      try {
        for (const playerId of players) {
          const started = await startSharedRoom(harness, roomKey, playerId, playerCount);
          expect(started.playtestId).toBe(roomKey);
          const socket = await harness.websocketConnect(started.wsUrl);
          cleanupAcks.push(attachSnapshotAck(socket));
          await waitForMessage(socket, (message) => isWelcomeForPlayer(message, playerId), {
            timeoutMs: 1_000,
            label: `WelcomeSnapshot(${playerId})`,
          });
          sockets.push(socket);
        }
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
    const players = ['player-a', 'player-b', 'player-c'] as const;
    const sockets: MiniflareWebSocket[] = [];
    for (const playerId of players) {
      const started = await startSharedRoom(harness, roomKey, playerId);
      const socket = await harness.websocketConnect(started.wsUrl);
      await waitForMessage(socket, (message) => isWelcomeForPlayer(message, playerId), {
        timeoutMs: 1_000,
        label: `WelcomeSnapshot(${playerId})`,
      });
      sockets.push(socket);
    }
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
    const sender = await startSharedRoom(harness, 'smoke-input-room', 'sender');
    const observer = await startSharedRoom(harness, 'smoke-input-room', 'observer');
    const senderSocket = await harness.websocketConnect(sender.wsUrl);
    const senderJoin = waitForMessage(
      senderSocket,
      (message) => isWelcomeForPlayer(message, 'sender'),
      {
        timeoutMs: 500,
        label: 'sender WelcomeSnapshot',
      },
    );
    const observerSocket = await harness.websocketConnect(observer.wsUrl);
    const observerJoin = waitForMessage(
      observerSocket,
      (message) => isWelcomeForPlayer(message, 'observer'),
      { timeoutMs: 500, label: 'observer WelcomeSnapshot' },
    );
    await Promise.all([senderJoin, observerJoin]);
    const deltaWait = waitForMessage(observerSocket, (message) => isDeltaForPlayer(message, 'sender'), {
      timeoutMs: 1_000,
      label: 'sender DeltaSnapshot',
    });
    senderSocket.send(encodeInputCommand('sender', 1, { move: 'north' }));
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
    const stale = await startSharedRoom(harness, roomKey, 'stale-player');
    const staleSocket = await harness.websocketConnect(stale.wsUrl);
    await waitForMessage(
      staleSocket,
      (message) => isWelcomeForPlayer(message, 'stale-player'),
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
    expect(summary.metrics.lifecyclePhase).toBe('finished');
    expect(summary.metrics.connectedClients).toBe(0);
    expect(summary.metrics.playerCount).toBe(0);
    expect(summary.metrics.transport.trackedClients).toBe(0);
    staleSocket.close(1000, 'done');
  });

  it('removes a peer from room state when a websocket disconnects', async () => {
    const harness = await bootMiniflare();
    dispose = harness.mfDispose;
    const roomKey = 'smoke-cancel-room';
    const leaver = await startSharedRoom(harness, roomKey, 'leaver');
    const peer = await startSharedRoom(harness, roomKey, 'peer');
    const leaverSocket = await harness.websocketConnect(leaver.wsUrl);
    await waitForMessage(
      leaverSocket,
      (message) => isWelcomeForPlayer(message, 'leaver'),
      {
        timeoutMs: 500,
        label: 'leaver WelcomeSnapshot',
      },
    );
    const peerSocket = await harness.websocketConnect(peer.wsUrl);
    const peerJoin = waitForMessage(
      peerSocket,
      (message) => isWelcomeForPlayer(message, 'peer'),
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
    expect(summary.metrics.playerCount).toBe(1);
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

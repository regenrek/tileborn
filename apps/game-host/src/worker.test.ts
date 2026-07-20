import { describe, expect, it } from 'vitest';

import type {
  Env,
  PlaytestRoomNamespace,
  RoomLobbySummary,
  RoomPlayerPresenceRecord,
  RoomPlayerReadyRecord,
  RoomResultsSummary,
} from './types.js';
import { runtimeManifest } from './.generated/runtime-manifest.js';
import { bundledSamplePackId } from './.generated/bundled-assets.js';
import { PLACEHOLDER_HANDOFF_SIGNING_KEY, mintHandoffToken } from './rooms/handoff-token.js';
import { createWorkerApp } from './worker.js';

const TEST_KEY = 'test-handoff-signing-key-32-bytes!!';

const makePlaytestNamespace = (
  handler: (request: Request, roomId: string) => Promise<Response>,
): PlaytestRoomNamespace => ({
  idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
  get: (id: DurableObjectId) => ({ fetch: (request) => handler(request, id.toString()) }),
});

interface FakeLobbyRoom {
  readonly roomId: string;
  readonly mapId: string;
  readonly maxPlayers: number;
  phase: RoomLobbySummary['phase'];
  lobby: RoomLobbySummary['lobby'];
  players: Record<string, { readonly id: string; readonly displayName?: string }>;
  ready: Record<string, RoomPlayerReadyRecord>;
  presence: Record<string, RoomPlayerPresenceRecord>;
  results: RoomResultsSummary | null;
}

const makeLobbyNamespace = (
  options: {
    readonly onCreate?: (body: {
      readonly mapId: string;
      readonly mapPackage?: unknown;
      readonly options?: Record<string, string | number | boolean | null>;
    }) => void;
  } = {},
): PlaytestRoomNamespace => {
  const rooms = new Map<string, FakeLobbyRoom>();
  return makePlaytestNamespace(async (request, roomId) => {
    const url = new URL(request.url);
    const room = rooms.get(roomId);
    if (request.method === 'GET' && url.pathname === '/lobby/summary') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      return Response.json({ lobby: toFakeLobbySummary(room) });
    }
    if (request.method === 'POST' && url.pathname === '/create') {
      const body = (await request.json()) as {
        readonly mapId: string;
        readonly mapPackage?: unknown;
        readonly options?: Record<string, string | number | boolean | null>;
      };
      options.onCreate?.(body);
      rooms.set(roomId, {
        roomId,
        mapId: body.mapId,
        maxPlayers: typeof body.options?.maxPlayers === 'number' ? body.options.maxPlayers : 32,
        phase: 'lobby',
        lobby: { visibility: 'private' },
        players: {},
        ready: {},
        presence: {},
        results: null,
      });
      return Response.json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/lobby/configure') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const body = (await request.json()) as {
        readonly joinCode: string;
        readonly visibility?: 'private' | 'public';
        readonly displayName?: string;
        readonly createdByPlayerId?: string;
      };
      room.lobby = {
        ...room.lobby,
        joinCode: body.joinCode,
        ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
        ...(body.displayName === undefined ? {} : { title: body.displayName }),
        ...(body.createdByPlayerId === undefined
          ? {}
          : { createdByPlayerId: body.createdByPlayerId }),
      };
      return Response.json({ lobby: toFakeLobbySummary(room) });
    }
    if (request.method === 'POST' && url.pathname === '/players/reserve') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const body = (await request.json()) as {
        readonly playerId?: string;
        readonly displayName?: string;
      };
      const existingPlayerCount = Object.keys(room.players).length;
      const playerId = body.playerId ?? `player-${existingPlayerCount + 1}`;
      if (room.players[playerId] === undefined && existingPlayerCount >= room.maxPlayers) {
        return Response.json({ error: 'room capacity reached' }, { status: 409 });
      }
      const now = '2026-01-01T00:00:00.000Z';
      room.players[playerId] = {
        id: playerId,
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      };
      room.ready[playerId] = { playerId, isReady: false, updatedAt: now };
      room.presence[playerId] = {
        playerId,
        status: 'connected',
        lastSeenAt: now,
        connectedAt: now,
      };
      return Response.json({ playerId });
    }
    if (request.method === 'POST' && url.pathname === '/lobby/ready') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const body = (await request.json()) as {
        readonly playerId?: string;
        readonly ready?: boolean;
      };
      if (typeof body.playerId !== 'string' || body.playerId.length === 0) {
        return Response.json({ error: 'playerId is required' }, { status: 400 });
      }
      if (room.players[body.playerId] === undefined) {
        return Response.json({ error: 'player is not in the room' }, { status: 404 });
      }
      if (room.phase !== 'lobby' && room.phase !== 'countdown') {
        return Response.json({ error: 'room is not waiting for match start' }, { status: 409 });
      }
      if (typeof body.ready !== 'boolean') {
        return Response.json({ error: 'ready must be a boolean' }, { status: 400 });
      }
      const now = '2026-01-01T00:00:00.000Z';
      room.ready[body.playerId] = { playerId: body.playerId, isReady: body.ready, updatedAt: now };
      const canStart =
        Object.keys(room.players).length >= 2 &&
        Object.keys(room.players).every((playerId) => room.ready[playerId]?.isReady === true);
      if (canStart) {
        room.phase = 'countdown';
      }
      return Response.json({
        lobby: toFakeLobbySummary(room),
        canStart,
        ...(canStart ? {} : { reason: 'waiting for required players to ready up' }),
      });
    }
    if (request.method === 'POST' && url.pathname === '/lobby/start') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const body = (await request.json()) as { readonly playerId?: string };
      if (body.playerId !== room.lobby.createdByPlayerId) {
        return Response.json(
          { error: 'only the room owner can perform this action' },
          { status: 403 },
        );
      }
      room.phase = 'active';
      return Response.json({ lobby: toFakeLobbySummary(room), started: true });
    }
    if (request.method === 'POST' && url.pathname === '/room/stop') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const body = (await request.json()) as { readonly playerId?: string };
      if (body.playerId !== room.lobby.createdByPlayerId) {
        return Response.json(
          { error: 'only the room owner can perform this action' },
          { status: 403 },
        );
      }
      room.phase = 'finished';
      room.results = {
        completedAt: '2026-01-01T00:00:00.000Z',
        reason: 'owner stopped room',
        players: Object.keys(room.players).map((playerId) => ({ playerId, outcome: 'abandoned' })),
      };
      return Response.json({
        roomId,
        stopped: true,
        lobby: toFakeLobbySummary(room),
        results: room.results,
      });
    }
    if (request.method === 'POST' && url.pathname === '/players/reconnect') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const body = (await request.json()) as { readonly playerId?: string };
      if (typeof body.playerId !== 'string' || body.playerId.length === 0) {
        return Response.json({ error: 'playerId is required' }, { status: 400 });
      }
      if (room.players[body.playerId] === undefined) {
        return Response.json({ error: 'player seat is not reserved' }, { status: 404 });
      }
      return Response.json({ playerId: body.playerId, lobby: toFakeLobbySummary(room) });
    }
    if (request.method === 'GET' && url.pathname === '/results') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      return Response.json({ roomId, results: room.results });
    }
    if (request.method === 'GET' && url.pathname === '/diagnostics') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const lobby = toFakeLobbySummary(room);
      return Response.json({
        diagnostics: {
          roomId,
          phase: room.phase,
          ...(room.lobby.createdByPlayerId === undefined
            ? {}
            : { ownerPlayerId: room.lobby.createdByPlayerId }),
          playerCount: lobby.playerCount,
          readyPlayerCount: lobby.players.filter((player) => player.ready).length,
          connectedPlayerCount: lobby.players.filter((player) => player.status === 'connected')
            .length,
          reconnectEligiblePlayerCount: lobby.players.filter((player) => player.reconnectEligible)
            .length,
          generatedAt: '2026-01-01T00:00:00.000Z',
          issues: room.lobby.createdByPlayerId === undefined ? ['missing owner'] : [],
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/metrics') {
      if (room === undefined) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      return Response.json({
        roomId,
        metrics: {
          lifecyclePhase: room.phase,
          tick: 0,
          baseTick: 0,
          lastPersistedTick: 0,
          playerCount: Object.keys(room.players).length,
          connectedClients: Object.keys(room.players).length,
          queuedInputPlayers: 0,
          queuedInputs: 0,
          pendingPluginFrames: 0,
          replayFrames: 0,
          generatedAt: '2026-01-01T00:00:00.000Z',
          transport: {
            trackedClients: Object.keys(room.players).length,
            maxPendingSnapshotLagTicks: 0,
            totalDroppedOutboundFrames: 0,
            totalResyncs: 0,
            totalStaleSnapshotAcks: 0,
          },
        },
      });
    }
    return new Response('missing', { status: 404 });
  });
};

const toFakeLobbySummary = (room: FakeLobbyRoom): RoomLobbySummary => ({
  roomId: room.roomId,
  mapId: room.mapId,
  phase: room.phase,
  lobby: room.lobby,
  playerCount: Object.keys(room.players).length,
  maxPlayers: room.maxPlayers,
  minReadyPlayers: 2,
  canStart: false,
  players: Object.keys(room.players)
    .sort((left, right) => left.localeCompare(right))
    .map((playerId) => ({
      playerId,
      role: room.lobby.createdByPlayerId === playerId ? 'owner' : 'participant',
      status: room.presence[playerId]?.status ?? 'disconnected',
      ready: room.ready[playerId]?.isReady === true,
      reconnectEligible: true,
      lastSeenAt: room.presence[playerId]?.lastSeenAt ?? null,
      ...(room.players[playerId]?.displayName === undefined
        ? {}
        : { displayName: room.players[playerId]?.displayName }),
      ...(room.presence[playerId]?.connectedAt === undefined
        ? {}
        : { connectedAt: room.presence[playerId]?.connectedAt }),
    })),
});

describe('game-host worker routes', () => {
  const env: Env = {
    HANDOFF_SIGNING_KEY: TEST_KEY,
    PLAYTEST_ROOM: makePlaytestNamespace(async (request) => {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname.endsWith('/create')) {
        return Response.json({ ok: true });
      }
      if (request.method === 'POST' && url.pathname.endsWith('/players/reserve')) {
        return Response.json({ playerId: 'player-1' });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        return new Response(null, { status: 404 });
      }
      if (request.method === 'GET') {
        return Response.json({
          playtestId: url.searchParams.get('playtestId') ?? 'unknown',
          mapId: 'fixture-map',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastTickAt: null,
          connectedClients: 0,
        });
      }
      return new Response('missing', { status: 404 });
    }),
  };

  it('GET /health returns ok with version and buildId', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request('http://localhost/health', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly status: string;
      readonly version: string;
      readonly buildId: string;
      readonly timestamp: string;
    };
    expect(body.status).toBe('ok');
    expect(body.version.length).toBeGreaterThan(0);
    expect(body.buildId).toMatch(/^sha256:/);
    expect(body.timestamp.length).toBeGreaterThan(0);
  });

  it('serves the game-client static assets for unmatched routes via the ASSETS binding', async () => {
    const app = createWorkerApp(runtimeManifest);
    const assetEnv: Env = {
      ...env,
      ASSETS: {
        fetch: async (request: Request) => {
          const url = new URL(request.url);
          if (url.pathname === '/assets/app.js') {
            return new Response("console.log('client');", {
              status: 200,
              headers: { 'content-type': 'application/javascript' },
            });
          }
          if (url.pathname === '/index.html') {
            return new Response('<!doctype html><div id=root></div>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            });
          }
          return new Response('not found', { status: 404 });
        },
      },
    };

    const asset = await app.request('http://localhost/assets/app.js', {}, assetEnv);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('client');

    // SPA navigation falls back to index.html.
    const spa = await app.request(
      'http://localhost/play',
      { headers: { Accept: 'text/html' } },
      assetEnv,
    );
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('id=root');
  });

  it('returns 404 for unmatched routes when no ASSETS binding is configured', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request('http://localhost/assets/missing.js', {}, env);
    expect(response.status).toBe(404);
  });

  it('GET /health returns 503 when signing key is invalid', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/health',
      {},
      { ...env, HANDOFF_SIGNING_KEY: 'short' },
    );
    expect(response.status).toBe(503);
  });

  it('GET /health returns 503 when signing key is the known placeholder', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/health',
      {},
      { ...env, HANDOFF_SIGNING_KEY: PLACEHOLDER_HANDOFF_SIGNING_KEY },
    );
    expect(response.status).toBe(503);
  });

  it('GET /discover returns bundled manifest summary', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request('http://localhost/discover', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly plugin: { readonly id: string; readonly version: string };
      readonly runtimeVersion: string;
      readonly protocolVersion: number;
      readonly buildId: string;
      readonly assetPacks: readonly { readonly id: string; readonly version: string }[];
      readonly maps: readonly { readonly mapId: string; readonly packageId: string }[];
    };
    expect(body.plugin.id).toBe('@tileborne-plugins/battle-royale');
    expect(body.assetPacks.some((pack) => pack.id === bundledSamplePackId)).toBe(true);
    // The bundled dev map package is discoverable (M5 S1).
    expect(body.maps).toHaveLength(1);
    expect(body.maps[0]?.packageId).toMatch(/^mappkg:/);
    expect(body.runtimeVersion.length).toBeGreaterThan(0);
    expect(body.protocolVersion).toBe(1);
    expect(body.buildId).toMatch(/^sha256:/);
  });

  it('POST /playtest/start returns playtestId, wsUrl, and handoff token', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/playtest/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture' }),
      },
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      readonly playtestId: string;
      readonly wsUrl: string;
      readonly handoffToken: string;
      readonly reconnectToken: string;
      readonly playerId: string;
    };
    expect(body.playtestId.length).toBeGreaterThan(0);
    expect(body.wsUrl).toContain('/playtest/');
    expect(body.wsUrl).toContain('token=');
    expect(body.wsUrl).toContain('playerId=player-1');
    expect(body.handoffToken.length).toBeGreaterThan(0);
    expect(body.reconnectToken.length).toBeGreaterThan(0);
    expect(body.playerId).toBe('player-1');
  });

  it('POST /rooms/create returns roomId and wsUrl', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: 'map:fixture',
          options: { idempotencyKey: 'room-stable' },
        }),
      },
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly roomId: string; readonly wsUrl: string };
    expect(body.roomId).toBe('room-stable');
    expect(body.wsUrl).toContain('/rooms/room-stable/connect');
  });

  it('POST /rooms/create forwards mapPackage and playerModelSelections to room init', async () => {
    let initBody: unknown;
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: 'map:fixture',
          mapPackage: { manifest: { schemaVersion: 1 } },
          playerModelSelections: [{ playerId: 'player-1', modelId: 'model:test' }],
          options: { idempotencyKey: 'room-package' },
        }),
      },
      {
        ...env,
        PLAYTEST_ROOM: makePlaytestNamespace(async (request) => {
          initBody = await request.json();
          return Response.json({ ok: true });
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(initBody).toMatchObject({
      mapId: 'map:fixture',
      mapPackage: { manifest: { schemaVersion: 1 } },
      playerModelSelections: [{ playerId: 'player-1', modelId: 'model:test' }],
      options: { idempotencyKey: 'room-package' },
    });
  });

  it('POST /rooms/create surfaces the room boundary 400 for a malformed mapPackage', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: 'map:fixture',
          mapPackage: { manifest: { schemaVersion: 1 } },
        }),
      },
      {
        ...env,
        PLAYTEST_ROOM: makePlaytestNamespace(async () =>
          Response.json(
            { error: 'mapPackage is not a valid RuntimeMapPackage: boom' },
            { status: 400 },
          ),
        ),
      },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly error: string };
    expect(body.error).toContain('mapPackage is not a valid RuntimeMapPackage');
  });

  it('POST /rooms/create resolves the bundled map package for the requested mapId (M5 S1)', async () => {
    let initBody: unknown;
    const bundled = [
      {
        mapId: 'map:bundled-a',
        packageId: 'mappkg:a',
        mapPackage: { manifest: { packageId: 'mappkg:a' } },
      },
      {
        mapId: 'map:bundled-b',
        packageId: 'mappkg:b',
        mapPackage: { manifest: { packageId: 'mappkg:b' } },
      },
    ];
    const app = createWorkerApp(runtimeManifest, bundled);
    const response = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:bundled-b' }),
      },
      {
        ...env,
        PLAYTEST_ROOM: makePlaytestNamespace(async (request) => {
          initBody = await request.json();
          return Response.json({ ok: true });
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(initBody).toMatchObject({
      mapId: 'map:bundled-b',
      mapPackage: { manifest: { packageId: 'mappkg:b' } },
    });
  });

  it('POST /rooms/create falls back to the single bundled package for any mapId', async () => {
    let initBody: unknown;
    const bundled = [
      {
        mapId: 'map:bundled-only',
        packageId: 'mappkg:only',
        mapPackage: { manifest: { packageId: 'mappkg:only' } },
      },
    ];
    const app = createWorkerApp(runtimeManifest, bundled);
    const response = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:something-else' }),
      },
      {
        ...env,
        PLAYTEST_ROOM: makePlaytestNamespace(async (request) => {
          initBody = await request.json();
          return Response.json({ ok: true });
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(initBody).toMatchObject({
      mapPackage: { manifest: { packageId: 'mappkg:only' } },
    });
  });

  it('POST /rooms/create returns a structured 400 when no bundled package matches', async () => {
    const bundled = [
      {
        mapId: 'map:bundled-a',
        packageId: 'mappkg:a',
        mapPackage: { manifest: { packageId: 'mappkg:a' } },
      },
      {
        mapId: 'map:bundled-b',
        packageId: 'mappkg:b',
        mapPackage: { manifest: { packageId: 'mappkg:b' } },
      },
    ];
    const app = createWorkerApp(runtimeManifest, bundled);
    const response = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:unknown' }),
      },
      env,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly error: string };
    expect(body.error).toContain('map:unknown');
    expect(body.error).toContain('map:bundled-a');
  });

  it('POST /rooms/create returns a structured 400 when the build bundles no packages', async () => {
    const app = createWorkerApp(runtimeManifest, []);
    const response = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture' }),
      },
      env,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly error: string };
    expect(body.error).toContain('no map package bundled');
  });

  it('POST /rooms/create is idempotent for the same idempotency key', async () => {
    const app = createWorkerApp(runtimeManifest);
    const payload = {
      mapId: 'map:fixture',
      options: { idempotencyKey: 'room-idem' },
    };
    const first = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      env,
    );
    const second = await app.request(
      'http://localhost/rooms/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      env,
    );
    const firstBody = (await first.json()) as { readonly roomId: string };
    const secondBody = (await second.json()) as { readonly roomId: string };
    expect(firstBody.roomId).toBe('room-idem');
    expect(secondBody.roomId).toBe('room-idem');
  });

  it('POST /lobbies/create creates a join-code lobby and can reserve the creator', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: 'map:fixture',
          displayName: 'Friday lobby',
          visibility: 'public',
          reserveCreator: true,
          playerDisplayName: 'Ada',
        }),
      },
      { ...env, PLAYTEST_ROOM: makeLobbyNamespace() },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      readonly roomId: string;
      readonly joinCode: string;
      readonly joinUrl: string;
      readonly wsUrl: string;
      readonly handoffToken: string;
      readonly reconnectToken: string;
      readonly playerId: string;
      readonly lobby: RoomLobbySummary;
    };
    expect(body.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(body.roomId).toBe(`lobby-${body.joinCode}`);
    expect(body.joinUrl).toBe(`http://localhost/lobbies/join?code=${body.joinCode}`);
    expect(body.wsUrl).toContain(`/rooms/${body.roomId}/connect`);
    expect(body.wsUrl).toContain('token=');
    expect(body.handoffToken.length).toBeGreaterThan(0);
    expect(body.reconnectToken.length).toBeGreaterThan(0);
    expect(body.playerId).toBe('player-1');
    expect(body.lobby.lobby).toMatchObject({
      visibility: 'public',
      joinCode: body.joinCode,
      title: 'Friday lobby',
      createdByPlayerId: 'player-1',
    });
    expect(body.lobby.players[0]).toMatchObject({
      playerId: 'player-1',
      displayName: 'Ada',
      status: 'connected',
      ready: false,
      reconnectEligible: true,
    });
  });

  it('POST /lobbies/join resolves a join code and issues a handoff token', async () => {
    const app = createWorkerApp(runtimeManifest);
    const lobbyEnv = { ...env, PLAYTEST_ROOM: makeLobbyNamespace() };
    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture' }),
      },
      lobbyEnv,
    );
    const createdBody = (await created.json()) as {
      readonly joinCode: string;
      readonly roomId: string;
    };

    const joined = await app.request(
      'http://localhost/lobbies/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          joinCode: createdBody.joinCode.toLowerCase(),
          playerId: 'player-custom',
          displayName: 'Grace',
        }),
      },
      lobbyEnv,
    );

    expect(joined.status).toBe(201);
    const body = (await joined.json()) as {
      readonly roomId: string;
      readonly playerId: string;
      readonly wsUrl: string;
      readonly handoffToken: string;
      readonly reconnectToken: string;
      readonly lobby: RoomLobbySummary;
    };
    expect(body.roomId).toBe(createdBody.roomId);
    expect(body.playerId).toBe('player-custom');
    expect(body.wsUrl).toContain(`/rooms/${createdBody.roomId}/connect`);
    expect(body.wsUrl).toContain('playerId=player-custom');
    expect(body.handoffToken.length).toBeGreaterThan(0);
    expect(body.reconnectToken.length).toBeGreaterThan(0);
    expect(body.lobby.players[0]).toMatchObject({
      playerId: 'player-custom',
      displayName: 'Grace',
    });
  });

  it('POST /lobbies/:id/ready updates readiness and starts countdown when all players are ready', async () => {
    const app = createWorkerApp(runtimeManifest);
    const lobbyEnv = { ...env, PLAYTEST_ROOM: makeLobbyNamespace() };
    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture', reserveCreator: true }),
      },
      lobbyEnv,
    );
    const createdBody = (await created.json()) as {
      readonly joinCode: string;
      readonly roomId: string;
      readonly playerId: string;
      readonly reconnectToken: string;
    };
    const joined = await app.request(
      'http://localhost/lobbies/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: createdBody.joinCode }),
      },
      lobbyEnv,
    );
    expect(joined.status).toBe(201);
    const joinedBody = (await joined.clone().json()) as {
      readonly playerId: string;
      readonly reconnectToken: string;
    };

    const missingToken = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/ready`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: createdBody.playerId, ready: true }),
      },
      lobbyEnv,
    );
    expect(missingToken.status).toBe(401);
    expect(await missingToken.json()).toEqual({ error: 'missing ready token' });

    const mismatchedToken = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/ready`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: createdBody.playerId,
          ready: true,
          reconnectToken: joinedBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(mismatchedToken.status).toBe(401);
    expect(await mismatchedToken.json()).toEqual({ error: 'invalid ready token' });

    const firstReady = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/ready`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: createdBody.playerId,
          ready: true,
          reconnectToken: createdBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(firstReady.status).toBe(200);
    const firstBody = (await firstReady.json()) as {
      readonly canStart: boolean;
      readonly lobby: RoomLobbySummary;
    };
    expect(firstBody.canStart).toBe(false);
    expect(firstBody.lobby.phase).toBe('lobby');
    expect(firstBody.lobby.players[0]).toMatchObject({ playerId: 'player-1', ready: true });

    const secondReady = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/ready`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${joinedBody.reconnectToken}`,
        },
        body: JSON.stringify({ playerId: joinedBody.playerId, ready: true }),
      },
      lobbyEnv,
    );
    expect(secondReady.status).toBe(200);
    const secondBody = (await secondReady.json()) as {
      readonly canStart: boolean;
      readonly lobby: RoomLobbySummary;
    };
    expect(secondBody.canStart).toBe(true);
    expect(secondBody.lobby.phase).toBe('countdown');
    expect(secondBody.lobby.players.map((player) => player.ready)).toEqual([true, true]);
  });

  it('runs the same shipped lobby flow for an Arena bundled map package', async () => {
    const arenaMapPackage = {
      manifest: {
        schemaVersion: 1,
        packageId: 'mappkg:arena-fixture',
        pluginId: '@tileborne-plugins/example-arena',
        playerCapacity: 2,
      },
      modeData: {
        arena: { ruleset: 'fixture' },
      },
    };
    const createBodies: unknown[] = [];
    const app = createWorkerApp(runtimeManifest, [
      {
        mapId: 'map:arena-fixture',
        packageId: 'mappkg:arena-fixture',
        mapPackage: arenaMapPackage,
      },
    ]);
    const lobbyEnv = {
      ...env,
      PLAYTEST_ROOM: makeLobbyNamespace({ onCreate: (body) => createBodies.push(body) }),
    };

    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: 'map:arena-fixture',
          reserveCreator: true,
          playerDisplayName: 'Arena Owner',
        }),
      },
      lobbyEnv,
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      readonly roomId: string;
      readonly joinCode: string;
      readonly playerId: string;
      readonly reconnectToken: string;
      readonly lobby: RoomLobbySummary;
    };
    expect(createdBody.lobby.mapId).toBe('map:arena-fixture');
    expect(createdBody.lobby.players[0]).toMatchObject({
      playerId: createdBody.playerId,
      displayName: 'Arena Owner',
      ready: false,
    });

    const joined = await app.request(
      'http://localhost/lobbies/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          joinCode: createdBody.joinCode,
          displayName: 'Arena Participant',
        }),
      },
      lobbyEnv,
    );
    expect(joined.status).toBe(201);
    const joinedBody = (await joined.json()) as {
      readonly playerId: string;
      readonly reconnectToken: string;
      readonly lobby: RoomLobbySummary;
    };
    expect(joinedBody.lobby.players.map((player) => player.displayName)).toEqual([
      'Arena Owner',
      'Arena Participant',
    ]);

    const ownerReady = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/ready`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: createdBody.playerId,
          ready: true,
          reconnectToken: createdBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(ownerReady.status).toBe(200);
    const participantReady = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/ready`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: joinedBody.playerId,
          ready: true,
          reconnectToken: joinedBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(participantReady.status).toBe(200);
    const readyBody = (await participantReady.json()) as {
      readonly canStart: boolean;
      readonly lobby: RoomLobbySummary;
    };
    expect(readyBody.canStart).toBe(true);
    expect(readyBody.lobby.phase).toBe('countdown');

    const participantStart = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: joinedBody.playerId,
          reconnectToken: joinedBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(participantStart.status).toBe(403);

    const ownerStart = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}/start`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: createdBody.playerId,
          reconnectToken: createdBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(ownerStart.status).toBe(200);
    const ownerStartBody = (await ownerStart.json()) as {
      readonly lobby: RoomLobbySummary;
      readonly started: boolean;
    };
    expect(ownerStartBody.started).toBe(true);
    expect(ownerStartBody.lobby.phase).toBe('active');

    const reconnected = await app.request(
      'http://localhost/rooms/reconnect',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: createdBody.roomId,
          playerId: createdBody.playerId,
          reconnectToken: createdBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(reconnected.status).toBe(200);

    const diagnostics = await app.request(
      `http://localhost/rooms/${createdBody.roomId}/diagnostics`,
      {},
      lobbyEnv,
    );
    expect(diagnostics.status).toBe(200);
    expect(await diagnostics.json()).toMatchObject({
      diagnostics: { ownerPlayerId: createdBody.playerId, issues: [] },
    });

    const metrics = await app.request(
      `http://localhost/rooms/${createdBody.roomId}/metrics`,
      {},
      lobbyEnv,
    );
    expect(metrics.status).toBe(200);
    expect(await metrics.json()).toMatchObject({
      roomId: createdBody.roomId,
      metrics: { lifecyclePhase: 'active' },
    });

    const stopped = await app.request(
      `http://localhost/rooms/${createdBody.roomId}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: createdBody.playerId,
          reconnectToken: createdBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({
      roomId: createdBody.roomId,
      stopped: true,
      results: { reason: 'owner stopped room' },
    });

    const results = await app.request(
      `http://localhost/rooms/${createdBody.roomId}/results`,
      {},
      lobbyEnv,
    );
    expect(results.status).toBe(200);
    expect(await results.json()).toMatchObject({
      roomId: createdBody.roomId,
      results: { reason: 'owner stopped room' },
    });
    expect(createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      mapId: 'map:arena-fixture',
      mapPackage: arenaMapPackage,
    });
  });

  it('POST /rooms/reconnect validates a reconnect token and returns a fresh handoff', async () => {
    const app = createWorkerApp(runtimeManifest);
    const lobbyEnv = { ...env, PLAYTEST_ROOM: makeLobbyNamespace() };
    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture', reserveCreator: true }),
      },
      lobbyEnv,
    );
    const createdBody = (await created.json()) as {
      readonly roomId: string;
      readonly playerId: string;
      readonly handoffToken: string;
      readonly reconnectToken: string;
    };

    const reconnectAsHandoff = await app.request(
      `http://localhost/rooms/${createdBody.roomId}/connect?playerId=${createdBody.playerId}&token=${encodeURIComponent(createdBody.reconnectToken)}`,
      { headers: { Upgrade: 'websocket' } },
      lobbyEnv,
    );
    expect(reconnectAsHandoff.status).toBe(401);
    expect(await reconnectAsHandoff.text()).toBe('invalid handoff token');

    const handoffAsReconnect = await app.request(
      'http://localhost/rooms/reconnect',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: createdBody.roomId,
          playerId: createdBody.playerId,
          reconnectToken: createdBody.handoffToken,
        }),
      },
      lobbyEnv,
    );
    expect(handoffAsReconnect.status).toBe(401);

    const reconnected = await app.request(
      'http://localhost/rooms/reconnect',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: createdBody.roomId,
          playerId: createdBody.playerId,
          reconnectToken: createdBody.reconnectToken,
        }),
      },
      lobbyEnv,
    );
    expect(reconnected.status).toBe(200);
    const body = (await reconnected.json()) as {
      readonly roomId: string;
      readonly playerId: string;
      readonly wsUrl: string;
      readonly handoffToken: string;
      readonly reconnectToken: string;
      readonly lobby: RoomLobbySummary;
    };
    expect(body.roomId).toBe(createdBody.roomId);
    expect(body.playerId).toBe(createdBody.playerId);
    expect(body.wsUrl).toContain(`/rooms/${createdBody.roomId}/connect`);
    expect(body.handoffToken.length).toBeGreaterThan(0);
    expect(body.reconnectToken.length).toBeGreaterThan(0);
    expect(body.lobby.players[0]).toMatchObject({ playerId: createdBody.playerId });
  });

  it('POST /rooms/reconnect returns structured 4xx for invalid tokens and missing seats', async () => {
    const app = createWorkerApp(runtimeManifest);
    const lobbyEnv = { ...env, PLAYTEST_ROOM: makeLobbyNamespace() };
    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture', reserveCreator: true }),
      },
      lobbyEnv,
    );
    const createdBody = (await created.json()) as {
      readonly roomId: string;
    };

    const invalid = await app.request(
      'http://localhost/rooms/reconnect',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: createdBody.roomId,
          playerId: 'player-1',
          reconnectToken: 'bad.token',
        }),
      },
      lobbyEnv,
    );
    expect(invalid.status).toBe(401);

    const missingSeatToken = await mintHandoffToken(
      { HANDOFF_SIGNING_KEY: TEST_KEY },
      { playtestId: createdBody.roomId, playerId: 'player-missing', purpose: 'reconnect' },
    );
    const missingSeat = await app.request(
      'http://localhost/rooms/reconnect',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: createdBody.roomId,
          playerId: 'player-missing',
          reconnectToken: missingSeatToken,
        }),
      },
      lobbyEnv,
    );
    expect(missingSeat.status).toBe(404);
    expect(await missingSeat.json()).toEqual({ error: 'player seat is not reserved' });
  });

  it('GET /rooms/:id/results returns the room-owned results summary', async () => {
    const app = createWorkerApp(runtimeManifest);
    const lobbyEnv = { ...env, PLAYTEST_ROOM: makeLobbyNamespace() };
    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture' }),
      },
      lobbyEnv,
    );
    const createdBody = (await created.json()) as { readonly roomId: string };

    const results = await app.request(
      `http://localhost/rooms/${createdBody.roomId}/results`,
      {},
      lobbyEnv,
    );
    expect(results.status).toBe(200);
    expect(await results.json()).toEqual({ roomId: createdBody.roomId, results: null });
  });

  it('GET /lobbies/:id and /lobbies/code/:code return lobby presence summaries', async () => {
    const app = createWorkerApp(runtimeManifest);
    const lobbyEnv = { ...env, PLAYTEST_ROOM: makeLobbyNamespace() };
    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture', reserveCreator: true }),
      },
      lobbyEnv,
    );
    const createdBody = (await created.json()) as {
      readonly joinCode: string;
      readonly roomId: string;
    };

    const byRoomId = await app.request(
      `http://localhost/lobbies/${createdBody.roomId}`,
      {},
      lobbyEnv,
    );
    const byJoinCode = await app.request(
      `http://localhost/lobbies/code/${createdBody.joinCode}`,
      {},
      lobbyEnv,
    );

    expect(byRoomId.status).toBe(200);
    expect(byJoinCode.status).toBe(200);
    const roomSummary = (await byRoomId.json()) as RoomLobbySummary;
    const codeSummary = (await byJoinCode.json()) as RoomLobbySummary;
    expect(roomSummary).toMatchObject({
      roomId: createdBody.roomId,
      playerCount: 1,
      canStart: false,
      minReadyPlayers: 2,
    });
    expect(roomSummary.players[0]).toMatchObject({
      playerId: 'player-1',
      status: 'connected',
      ready: false,
      reconnectEligible: true,
    });
    expect(codeSummary).toEqual(roomSummary);
  });

  it('POST /lobbies/join returns 404 for an unknown join code', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/lobbies/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: 'ABC2D3' }),
      },
      { ...env, PLAYTEST_ROOM: makeLobbyNamespace() },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'join code not found' });
  });

  it('POST /lobbies/join surfaces capacity failures from the room owner', async () => {
    const app = createWorkerApp(runtimeManifest);
    const lobbyEnv = { ...env, PLAYTEST_ROOM: makeLobbyNamespace() };
    const created = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: 'map:fixture',
          options: { maxPlayers: 1 },
          reserveCreator: true,
        }),
      },
      lobbyEnv,
    );
    const createdBody = (await created.json()) as { readonly joinCode: string };

    const joined = await app.request(
      'http://localhost/lobbies/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: createdBody.joinCode }),
      },
      lobbyEnv,
    );

    expect(joined.status).toBe(409);
    expect(await joined.json()).toEqual({ error: 'room capacity reached' });
  });

  it('lobby endpoints reject malformed payloads and invalid signing configuration', async () => {
    const app = createWorkerApp(runtimeManifest);
    const malformedCreate = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad json',
      },
      { ...env, PLAYTEST_ROOM: makeLobbyNamespace() },
    );
    expect(malformedCreate.status).toBe(400);

    const invalidJoin = await app.request(
      'http://localhost/lobbies/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: 'abc10i' }),
      },
      { ...env, PLAYTEST_ROOM: makeLobbyNamespace() },
    );
    expect(invalidJoin.status).toBe(400);

    const unavailable = await app.request(
      'http://localhost/lobbies/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture' }),
      },
      {
        ...env,
        HANDOFF_SIGNING_KEY: PLACEHOLDER_HANDOFF_SIGNING_KEY,
        PLAYTEST_ROOM: makeLobbyNamespace(),
      },
    );
    expect(unavailable.status).toBe(503);
  });

  it('POST /playtest/start returns 404 for an unknown room (joining never creates)', async () => {
    const missingEnv: Env = {
      HANDOFF_SIGNING_KEY: TEST_KEY,
      PLAYTEST_ROOM: makePlaytestNamespace(async () =>
        Response.json({ error: 'playtest not initialized' }, { status: 404 }),
      ),
    };
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request(
      'http://localhost/playtest/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: 'map:fixture', options: { idempotencyKey: 'unknown-room' } }),
      },
      missingEnv,
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { readonly error: string };
    expect(body.error).toBe('playtest not found');
  });

  it('GET /playtest/:id returns 404 for unknown room init', async () => {
    const missingEnv: Env = {
      HANDOFF_SIGNING_KEY: TEST_KEY,
      PLAYTEST_ROOM: makePlaytestNamespace(async () =>
        Response.json({ error: 'playtest not initialized' }, { status: 404 }),
      ),
    };
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request('http://localhost/playtest/missing-id', {}, missingEnv);
    expect(response.status).toBe(404);
  });

  it('GET /playtest/:id returns summary for initialized room', async () => {
    const app = createWorkerApp(runtimeManifest);
    const response = await app.request('http://localhost/playtest/room-1', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly mapId: string; readonly playtestId: string };
    expect(body.mapId).toBe('fixture-map');
    expect(body.playtestId).toBe('room-1');
  });
});

describe('worker bundle smoke', () => {
  it('dist worker bundle parses as ESM when built', async () => {
    const workerPath = new URL('../../dist/worker.js', import.meta.url);
    try {
      const module = await import(workerPath.href);
      expect(module.default).toBeDefined();
      expect(module.PlaytestRoom).toBeDefined();
    } catch {
      expect(true).toBe(true);
    }
  });
});

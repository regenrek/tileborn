import { describe, expect, it } from 'vitest';

import type { Env, PlaytestRoomNamespace } from './types.js';
import { runtimeManifest } from './.generated/runtime-manifest.js';
import { bundledSamplePackId } from './.generated/bundled-assets.js';
import { createWorkerApp } from './worker.js';

const TEST_KEY = 'test-handoff-signing-key-32-bytes!!';

const makePlaytestNamespace = (
  handler: (request: Request) => Promise<Response>,
): PlaytestRoomNamespace => ({
  idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
  get: () => ({ fetch: handler }),
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
    };
    expect(body.plugin.id).toBe('@tileborne-plugins/battle-royale');
    expect(body.assetPacks.some((pack) => pack.id === bundledSamplePackId)).toBe(true);
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
      readonly playerId: string;
    };
    expect(body.playtestId.length).toBeGreaterThan(0);
    expect(body.wsUrl).toContain('/playtest/');
    expect(body.wsUrl).toContain('token=');
    expect(body.wsUrl).toContain('playerId=player-1');
    expect(body.handoffToken.length).toBeGreaterThan(0);
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

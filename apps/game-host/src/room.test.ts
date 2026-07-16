import { describe, expect, it } from 'vitest';

import { bundledMapPackages } from './.generated/bundled-map-packages.js';
import {
  broadcastBinaryFrame,
  createRoomMeta,
  parsePlaytestInitBody,
  toPlaytestSessionMetrics,
  toPlaytestSummary,
  type BinarySocket,
} from './room.js';
import { emptyRoomStorage } from './rooms/storage-schema.js';
import { installWorkerGlobals } from './test-helpers/do-fake.js';

const TEST_KEY = 'test-handoff-signing-key-32-bytes!!';

describe('PlaytestRoom stub helpers', () => {
  it('parsePlaytestInitBody requires mapId', () => {
    expect(() => parsePlaytestInitBody('{}')).toThrow(/mapId/);
    const parsed = parsePlaytestInitBody('{"mapId":"map:1","seed":42}');
    expect(parsed.mapId).toBe('map:1');
    expect(parsed.seed).toBe(42);
  });

  it('parsePlaytestInitBody preserves the ORIGINAL mapPackage wire and selections', () => {
    const wire = JSON.parse(JSON.stringify(bundledMapPackages[0]!.mapPackage)) as Record<
      string,
      unknown
    >;
    const parsed = parsePlaytestInitBody(
      JSON.stringify({
        mapId: 'map:1',
        mapPackage: wire,
        playerModelSelections: [{ playerId: 'player-1', modelId: 'model:test' }],
        options: { maxPlayers: 8 },
      }),
    );

    // Original wire JSON survives validation untouched (no re-encode).
    expect(parsed.mapPackage).toEqual(wire);
    expect(parsed.playerModelSelections).toEqual([{ playerId: 'player-1', modelId: 'model:test' }]);
    expect(parsed.options).toEqual({ maxPlayers: 8 });
  });

  it('parsePlaytestInitBody rejects a mapPackage that fails RuntimeMapPackage decode', () => {
    expect(() =>
      parsePlaytestInitBody(
        JSON.stringify({
          mapId: 'map:1',
          mapPackage: { manifest: { schemaVersion: 1 } },
        }),
      ),
    ).toThrow(/mapPackage is not a valid RuntimeMapPackage/);
  });

  it('createRoomMeta stores mapId and timestamps', () => {
    const meta = createRoomMeta('map:fixture', 'seed-a');
    expect(meta.mapId).toBe('map:fixture');
    expect(meta.seed).toBe('seed-a');
    expect(meta.lastTickAt).toBeNull();
    expect(meta.createdAt.length).toBeGreaterThan(0);
  });

  it('toPlaytestSummary exposes connected client count', () => {
    const storage = emptyRoomStorage('map:1', 42, {}, undefined, '2026-01-01T00:00:00.000Z');
    const metrics = toPlaytestSessionMetrics({
      storage,
      connectedClients: 2,
      generatedAt: '2026-01-01T00:00:01.000Z',
    });
    const summary = toPlaytestSummary('id-1', createRoomMeta('map:1'), metrics);
    expect(summary.playtestId).toBe('id-1');
    expect(summary.connectedClients).toBe(2);
    expect(summary.metrics).toMatchObject({
      lifecyclePhase: 'lobby',
      tick: 0,
      playerCount: 0,
      connectedClients: 2,
      transport: {
        trackedClients: 0,
        maxPendingSnapshotLagTicks: 0,
      },
    });
  });

  it('broadcastBinaryFrame sends binary payload to every socket', () => {
    const sent: ArrayBuffer[] = [];
    const sockets: BinarySocket[] = [
      {
        readyState: WebSocket.OPEN,
        send: (data: ArrayBuffer) => {
          sent.push(data);
        },
      },
      {
        readyState: WebSocket.OPEN,
        send: (data: ArrayBuffer) => {
          sent.push(data);
        },
      },
      { readyState: WebSocket.CLOSED, send: () => undefined },
    ];
    const payload = new Uint8Array([1, 2, 3]).buffer;
    broadcastBinaryFrame(sockets, payload);
    expect(sent).toHaveLength(2);
    expect(new Uint8Array(sent[0] ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('PlaytestRoom DO fake', () => {
  it('accepts websocket upgrade path via fetch handler contract', async () => {
    installWorkerGlobals();
    const storage = new Map<string, unknown>();
    const state = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
        delete: async (key: string) => {
          storage.delete(key);
        },
        list: async () => ({ keys: [], cursor: '', list_complete: true }),
        setAlarm: async () => undefined,
        getAlarm: async () => null,
        deleteAlarm: async () => undefined,
      },
      acceptWebSocket: (ws: WebSocket) => {
        void ws;
      },
      getWebSockets: () => [] as WebSocket[],
      waitUntil: (promise: Promise<unknown>) => {
        void promise;
      },
      blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
    } as DurableObjectState;

    const { PlaytestRoom } = await import('./room.js');
    const room = new PlaytestRoom(state, {
      HANDOFF_SIGNING_KEY: TEST_KEY,
      PLAYTEST_ROOM: {
        idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
        get: () => ({ fetch: async () => new Response('unused') }),
      },
    });
    // `/playtest/init` is hard-cut: rooms are created via `/create` only.
    const legacyInit = await room.fetch(
      new Request('https://do/playtest/init', {
        method: 'POST',
        body: JSON.stringify({ mapId: 'map:fixture' }),
      }),
    );
    expect(legacyInit.status).toBe(404);
    const init = await room.fetch(
      new Request('https://do/create', {
        method: 'POST',
        body: JSON.stringify({ mapId: 'map:fixture' }),
      }),
    );
    expect(init.status).toBe(200);
    const summary = await room.fetch(new Request('https://do/?playtestId=abc'));
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as { readonly mapId: string };
    expect(body.mapId).toBe('map:fixture');
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';

import {
  ProofRouteError,
  assertMatchingReconnectLocalPlayerIds,
  classifyElectronLifecycleCloseObservations,
  connectWebSocketWithRetry,
  createRoomWithRetry,
  jsonFetch,
  normalizeWebSocketUrl,
  safeWebSocketLabel,
  summarizeMatchCompleteResults,
} from './prove-alchemy-cloudflare-lifecycle-helpers.mjs';

const response = (body, init) =>
  new Response(body, {
    ...init,
    headers: {
      'content-type': init.contentType ?? 'application/json',
      ...(init.headers ?? {}),
    },
  });

const assertNoTokenLeak = (error) => {
  for (const surface of [String(error), inspect(error), JSON.stringify(error)]) {
    assert.doesNotMatch(surface, /token|secret|\?/);
  }
};

const makeFakeWebSocket = (behaviors, urls = []) =>
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      urls.push(url);
      const behavior = behaviors.shift() ?? { type: 'open' };
      queueMicrotask(() => {
        if (behavior.type === 'throw') return;
        this.emit(behavior.type, behavior.event ?? {});
      });
      if (behavior.type === 'throw') {
        throw new Error(behavior.message ?? 'constructor failed');
      }
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        listeners.filter((candidate) => candidate !== listener),
      );
    }

    close() {
      this.closed = true;
    }

    emit(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  };

test('jsonFetch preserves non-JSON 500 status and safe body text', async () => {
  await assert.rejects(
    () =>
      jsonFetch('https://example.invalid', '/rooms/create', undefined, async () =>
        response('500 Internal Server Error', { status: 500, contentType: 'text/plain' }),
      ),
    (error) => {
      assert.equal(error instanceof ProofRouteError, true);
      assert.equal(error.route, '/rooms/create');
      assert.equal(error.status, 500);
      assert.equal(error.contentType, 'text/plain');
      assert.match(error.message, /\/rooms\/create failed 500: 500 Internal Server Error/);
      return true;
    },
  );
});

test('createRoomWithRetry retries transient 5xx with the same idempotency key', async () => {
  const calls = [];
  const room = await createRoomWithRetry(
    'https://example.invalid',
    {
      mapId: 'map:one',
      seed: 'run-one',
      idempotencyKey: 'room-run-one',
    },
    {
      timeoutMs: 1_000,
      intervalMs: 1,
      sleep: async () => undefined,
      fetch: async (_url, init) => {
        calls.push(JSON.parse(String(init.body)));
        if (calls.length === 1) {
          return response('Internal Server Error', { status: 500, contentType: 'text/plain' });
        }
        return response(JSON.stringify({ roomId: 'room-one' }), { status: 201 });
      },
    },
  );

  assert.equal(room.status, 201);
  assert.equal(room.body.roomId, 'room-one');
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.options.idempotencyKey),
    ['room-run-one', 'room-run-one'],
  );
});

test('createRoomWithRetry retries a pending workers.dev route 404', async () => {
  let attempts = 0;
  const room = await createRoomWithRetry(
    'https://example.invalid',
    { mapId: 'map:one', seed: 'run-one', idempotencyKey: 'room-run-one' },
    {
      timeoutMs: 1_000,
      intervalMs: 1,
      sleep: async () => undefined,
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          return response(
            '<title>Page not found</title><a href="https://workers.cloudflare.com">',
            {
              status: 404,
              contentType: 'text/html; charset=UTF-8',
            },
          );
        }
        return response(JSON.stringify({ roomId: 'room-one' }), { status: 201 });
      },
    },
  );

  assert.equal(room.body.roomId, 'room-one');
  assert.equal(attempts, 2);
});

test('createRoomWithRetry does not retry deterministic 4xx failures', async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      createRoomWithRetry(
        'https://example.invalid',
        {
          mapId: 'map:one',
          seed: 'run-one',
          idempotencyKey: 'room-run-one',
        },
        {
          timeoutMs: 1_000,
          intervalMs: 1,
          sleep: async () => undefined,
          fetch: async () => {
            attempts += 1;
            return response(JSON.stringify({ error: 'bad map' }), { status: 400 });
          },
        },
      ),
    ProofRouteError,
  );
  assert.equal(attempts, 1);
});

test('normalizeWebSocketUrl converts canonical HTTP handoffs to WebSocket schemes', () => {
  assert.equal(
    normalizeWebSocketUrl('https://worker.example/playtest/room-one?token=secret'),
    'wss://worker.example/playtest/room-one?token=secret',
  );
  assert.equal(
    normalizeWebSocketUrl('http://127.0.0.1:8787/playtest/room-one?token=secret'),
    'ws://127.0.0.1:8787/playtest/room-one?token=secret',
  );
  assert.equal(
    safeWebSocketLabel('https://worker.example/playtest/room-one?token=secret'),
    'wss://worker.example/playtest/room-one',
  );
});

test('connectWebSocketWithRetry retries transient handshakes with the same signed URL', async () => {
  const urls = [];
  const signedUrl = 'https://worker.example/playtest/room-one?token=secret';
  const connection = await connectWebSocketWithRetry(signedUrl, {
    WebSocket: makeFakeWebSocket([{ type: 'error' }, { type: 'open' }], urls),
    timeoutMs: 1_000,
    handshakeTimeoutMs: 100,
    intervalMs: 1,
    sleep: async () => undefined,
  });

  assert.equal(typeof connection.messageCount, 'function');
  assert.deepEqual(urls, [
    'wss://worker.example/playtest/room-one?token=secret',
    'wss://worker.example/playtest/room-one?token=secret',
  ]);
});

test('connectWebSocketWithRetry redacts query tokens from timeout errors', async () => {
  await assert.rejects(
    () =>
      connectWebSocketWithRetry('https://worker.example/playtest/room-one?token=secret', {
        WebSocket: makeFakeWebSocket([{ type: 'never' }]),
        timeoutMs: 1,
        handshakeTimeoutMs: 1,
        intervalMs: 1,
        sleep: async () => undefined,
      }),
    (error) => {
      assert.match(error.message, /wss:\/\/worker\.example\/playtest\/room-one/);
      assertNoTokenLeak(error);
      return true;
    },
  );
});

test('connectWebSocketWithRetry does not retry deterministic auth close codes', async () => {
  const urls = [];
  await assert.rejects(
    () =>
      connectWebSocketWithRetry('https://worker.example/playtest/room-one?token=secret', {
        WebSocket: makeFakeWebSocket([{ type: 'close', event: { code: 1008 } }], urls),
        timeoutMs: 1_000,
        handshakeTimeoutMs: 100,
        intervalMs: 1,
        sleep: async () => undefined,
      }),
    (error) => {
      assert.match(error.message, /1008/);
      assertNoTokenLeak(error);
      return true;
    },
  );
  assert.equal(urls.length, 1);
});

test('assertMatchingReconnectLocalPlayerIds returns the preserved reconnect identity', () => {
  assert.equal(
    assertMatchingReconnectLocalPlayerIds({
      beforeDisconnect: { localPlayerId: 'player-2' },
      afterReconnect: { localPlayerId: 'player-2' },
    }),
    'player-2',
  );
});

test('assertMatchingReconnectLocalPlayerIds rejects missing and empty identities', () => {
  const malformedReceipts = [
    {
      name: 'both identities missing',
      reconnect: { beforeDisconnect: {}, afterReconnect: {} },
    },
    {
      name: 'before identity missing',
      reconnect: { beforeDisconnect: {}, afterReconnect: { localPlayerId: 'player-2' } },
    },
    {
      name: 'after identity missing',
      reconnect: { beforeDisconnect: { localPlayerId: 'player-2' }, afterReconnect: {} },
    },
    {
      name: 'before identity empty',
      reconnect: {
        beforeDisconnect: { localPlayerId: '' },
        afterReconnect: { localPlayerId: 'player-2' },
      },
    },
    {
      name: 'after identity empty',
      reconnect: {
        beforeDisconnect: { localPlayerId: 'player-2' },
        afterReconnect: { localPlayerId: '' },
      },
    },
  ];

  for (const { name, reconnect } of malformedReceipts) {
    assert.throws(
      () => assertMatchingReconnectLocalPlayerIds(reconnect),
      /electron reconnect identity missing/,
      name,
    );
  }
});

test('assertMatchingReconnectLocalPlayerIds rejects changed reconnect identity', () => {
  assert.throws(
    () =>
      assertMatchingReconnectLocalPlayerIds({
        beforeDisconnect: { localPlayerId: 'player-1' },
        afterReconnect: { localPlayerId: 'player-2' },
      }),
    /electron reconnect identity changed/,
  );
});

test('classifyElectronLifecycleCloseObservations returns derived expected close evidence', () => {
  assert.deepEqual(
    classifyElectronLifecycleCloseObservations({
      afterReconnect: [
        {
          _tag: 'close',
          code: 4000,
          wasClean: false,
          reconnectable: true,
        },
        {
          _tag: 'reconnectPredecessorClose',
          code: 1000,
          wasClean: true,
          reconnectable: false,
        },
      ],
      terminalFirst: [
        {
          _tag: 'close',
          code: 4006,
          wasClean: true,
          reconnectable: false,
        },
      ],
      terminalSecond: [
        {
          _tag: 'close',
          code: 4006,
          wasClean: true,
          reconnectable: false,
        },
      ],
    }),
    {
      expectedCloseCodes: [1000, 4006, 4006],
      abnormalExpectedCloseCodeObserved: false,
      forcedNetworkDropCloseCodeObserved: 4000,
    },
  );
});

test('classifyElectronLifecycleCloseObservations rejects extra abnormal close observations', () => {
  assert.throws(
    () =>
      classifyElectronLifecycleCloseObservations({
        afterReconnect: [
          {
            _tag: 'close',
            code: 4000,
            wasClean: false,
            reconnectable: true,
          },
          {
            _tag: 'close',
            code: 1006,
            wasClean: false,
            reconnectable: true,
          },
        ],
        terminalFirst: [
          {
            _tag: 'close',
            code: 4006,
            wasClean: true,
            reconnectable: false,
          },
        ],
        terminalSecond: [
          {
            _tag: 'close',
            code: 4006,
            wasClean: true,
            reconnectable: false,
          },
        ],
      }),
    /unexpected close observations/,
  );
});

test('connectWebSocketWithRetry does not retain raw constructor errors with signed URLs', async () => {
  class ThrowingWebSocket {
    constructor() {
      throw new Error('constructor saw https://worker.example/playtest/room-one?token=secret');
    }
  }

  await assert.rejects(
    () =>
      connectWebSocketWithRetry('https://worker.example/playtest/room-one?token=secret', {
        WebSocket: ThrowingWebSocket,
        timeoutMs: 1,
        handshakeTimeoutMs: 1,
        intervalMs: 1,
        sleep: async () => undefined,
      }),
    (error) => {
      assert.equal(error.cause, undefined);
      assertNoTokenLeak(error);
      return true;
    },
  );
});

test('summarizeMatchCompleteResults derives the winner from canonical placement-1 row', () => {
  const summary = summarizeMatchCompleteResults({
    body: {
      results: {
        reason: 'match complete',
        players: [
          { playerId: 'player-1', outcome: 'completed', placement: 1 },
          { playerId: 'player-2', outcome: 'completed', placement: 2 },
        ],
      },
    },
  });

  assert.deepEqual(summary, {
    reason: 'match complete',
    winnerPlayerId: 'player-1',
    winnerSource: 'placement-1',
    players: [
      { playerId: 'player-1', outcome: 'completed', placement: 1 },
      { playerId: 'player-2', outcome: 'completed', placement: 2 },
    ],
  });
});

test('summarizeMatchCompleteResults rejects ambiguous winner placements', () => {
  assert.equal(
    summarizeMatchCompleteResults({
      body: {
        results: {
          reason: 'match complete',
          players: [
            { playerId: 'player-1', outcome: 'completed', placement: 1 },
            { playerId: 'player-2', outcome: 'completed', placement: 1 },
          ],
        },
      },
    }),
    undefined,
  );
});

test('summarizeMatchCompleteResults rejects missing placement-1 winner', () => {
  assert.equal(
    summarizeMatchCompleteResults({
      body: {
        results: {
          reason: 'match complete',
          players: [
            { playerId: 'player-1', outcome: 'completed', placement: 2 },
            { playerId: 'player-2', outcome: 'completed', placement: 3 },
          ],
        },
      },
    }),
    undefined,
  );
});

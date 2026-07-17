import { Cause, Effect, Option, Queue, Ref, Stream } from 'effect';

import { TransportError } from './protocol.js';

export const NORMAL_CLOSE_CODE = 1000;
export const KICKED_CLOSE_CODE = 4001;
export const MATCH_ENDED_CLOSE_CODE = 4006;
export const DEFAULT_RECONNECT_ATTEMPT_CAP = 6;

export type RuntimeTransportError = TransportError;

export interface TransportMessageEvent {
  readonly _tag: 'message';
  readonly data: Uint8Array;
}

export interface TransportCloseEvent {
  readonly _tag: 'close';
  readonly code: number;
  readonly reason?: string;
  readonly wasClean: boolean;
}

export type TransportEvent = TransportMessageEvent | TransportCloseEvent;

export interface Transport {
  readonly connect: (url: string) => Effect.Effect<void, TransportError>;
  readonly send: (data: Uint8Array) => Effect.Effect<void, TransportError>;
  readonly receive: () => Stream.Stream<TransportEvent, TransportError>;
  readonly close: (code?: number, reason?: string) => Effect.Effect<void, TransportError>;
  readonly markHealthy: () => Effect.Effect<void>;
  readonly reconnect?: (roomId: string) => Effect.Effect<void, TransportError>;
}

export interface BrowserWebSocketTransportOptions {
  readonly reconnectToken?: string;
  readonly reconnectAttemptCap?: number;
  readonly fetch?: typeof fetch;
}

export const isReconnectableCloseCode = (code: number): boolean =>
  code !== NORMAL_CLOSE_CODE && code !== KICKED_CLOSE_CODE && code !== MATCH_ENDED_CLOSE_CODE;

export const makeBrowserWebSocketTransport = (
  options: BrowserWebSocketTransportOptions = {},
): Transport => {
  const queue = Effect.runSync(Queue.unbounded<TransportEvent, TransportError | Cause.Done>());
  const sessionAttempts = Ref.makeUnsafe(0);
  const pendingHealthAck = Ref.makeUnsafe(true);
  let socket: WebSocket | undefined;
  let lastUrl: string | undefined;
  let reconnectToken = options.reconnectToken;
  const reconnectAttemptCap = options.reconnectAttemptCap ?? DEFAULT_RECONNECT_ATTEMPT_CAP;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  const markHealthy = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const shouldReset = yield* Ref.getAndSet(pendingHealthAck, false);
      if (shouldReset) {
        yield* Ref.set(sessionAttempts, 0);
      }
    });

  const openSocket = (url: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      socket = ws;
      lastUrl = url;

      ws.onopen = () => resolve();
      ws.onerror = () => {
        reject(
          new TransportError({
            message: `failed to connect websocket ${url}`,
            code: Option.none(),
            cause: Option.none(),
          }),
        );
      };
      ws.onmessage = (event: MessageEvent<ArrayBuffer | Blob>) => {
        Effect.runSync(markHealthy());
        if (event.data instanceof ArrayBuffer) {
          Queue.offerUnsafe(queue, { _tag: 'message', data: new Uint8Array(event.data) });
          return;
        }
        void event.data.arrayBuffer().then((buffer) => {
          Queue.offerUnsafe(queue, { _tag: 'message', data: new Uint8Array(buffer) });
        });
      };
      ws.onclose = (event) => {
        if (socket === ws) {
          socket = undefined;
        }
        Queue.offerUnsafe(queue, {
          _tag: 'close',
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        if (!isReconnectableCloseCode(event.code)) {
          void Effect.runPromise(Queue.end(queue));
        }
      };
    });

  return {
    connect: (url) =>
      Effect.tryPromise({
        try: () => openSocket(url),
        catch: (cause) =>
          cause instanceof TransportError
            ? cause
            : new TransportError({
                message: 'websocket connect failed',
                code: Option.none(),
                cause: Option.some(cause),
              }),
      }),
    send: (data) =>
      Effect.try({
        try: () => {
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new TransportError({
              message: 'websocket is not open',
              code: Option.none(),
              cause: Option.none(),
            });
          }
          const body = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          socket.send(body);
        },
        catch: (cause) =>
          cause instanceof TransportError
            ? cause
            : new TransportError({
                message: 'websocket send failed',
                code: Option.none(),
                cause: Option.some(cause),
              }),
      }),
    receive: () => Stream.fromQueue(queue),
    markHealthy,
    close: (code = NORMAL_CLOSE_CODE, reason) =>
      Effect.try({
        try: () => {
          socket?.close(code, reason);
        },
        catch: (cause) =>
          new TransportError({
            message: 'websocket close failed',
            code: Option.some(code),
            cause: Option.some(cause),
          }),
      }),
    reconnect: (roomId) =>
      Effect.gen(function* () {
        const nextAttempt = yield* Ref.updateAndGet(sessionAttempts, (attempts) => attempts + 1);
        if (nextAttempt > reconnectAttemptCap) {
          yield* new TransportError({
            message: 'reconnect attempts exhausted',
            code: Option.none(),
            cause: Option.none(),
          });
        }
        if (!reconnectToken) {
          yield* new TransportError({
            message: 'reconnectToken is required for reconnect',
            code: Option.none(),
            cause: Option.none(),
          });
        }
        const response = yield* Effect.tryPromise({
          try: () =>
            fetchImpl(`/api/matches/${encodeURIComponent(roomId)}/reconnect`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ reconnectToken }),
            }),
          catch: (cause) =>
            cause instanceof TransportError
              ? cause
              : new TransportError({
                  message:
                    lastUrl === undefined
                      ? 'reconnect failed'
                      : `reconnect failed after ${lastUrl}`,
                  code: Option.none(),
                  cause: Option.some(cause),
                }),
        });
        if (!response.ok) {
          yield* new TransportError({
            message: `reconnect failed with status ${response.status}`,
            code: Option.some(response.status),
            cause: Option.none(),
          });
        }
        const body = (yield* Effect.tryPromise({
          try: () =>
            response.json() as Promise<{
              readonly wsUrl?: string;
              readonly reconnectToken?: string;
            }>,
          catch: (cause) =>
            new TransportError({
              message: 'reconnect response decode failed',
              code: Option.none(),
              cause: Option.some(cause),
            }),
        })) as { readonly wsUrl?: string; readonly reconnectToken?: string };
        const wsUrl = body.wsUrl;
        if (wsUrl === undefined) {
          yield* new TransportError({
            message: 'reconnect response missing wsUrl',
            code: Option.none(),
            cause: Option.none(),
          });
          return;
        }
        reconnectToken = body.reconnectToken ?? reconnectToken;
        yield* Ref.set(pendingHealthAck, true);
        socket?.close(NORMAL_CLOSE_CODE, 'reconnecting');
        yield* Effect.tryPromise({
          try: () => openSocket(wsUrl),
          catch: (cause) =>
            cause instanceof TransportError
              ? cause
              : new TransportError({
                  message:
                    lastUrl === undefined
                      ? 'reconnect failed'
                      : `reconnect failed after ${lastUrl}`,
                  code: Option.none(),
                  cause: Option.some(cause),
                }),
        });
      }),
  };
};

import { Cause, Effect, Option, Queue, Ref, Stream } from 'effect';

import { TransportError } from './protocol.js';

export const NORMAL_CLOSE_CODE = 1000;
export const KICKED_CLOSE_CODE = 4001;
export const MATCH_ENDED_CLOSE_CODE = 4006;
export const DEFAULT_RECONNECT_ATTEMPT_CAP = 6;
export const DEFAULT_TRANSPORT_EVENT_QUEUE_CAP = 256;
export const DEFAULT_ROOM_RECONNECT_PATH = '/rooms/reconnect';

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

export type TransportObservation =
  | {
      readonly _tag: 'close';
      readonly code: number;
      readonly reason?: string;
      readonly wasClean: boolean;
      readonly reconnectable: boolean;
    }
  | {
      readonly _tag: 'reconnectAttempt';
      readonly roomId: string;
      readonly attempt: number;
    }
  | {
      readonly _tag: 'reconnectPredecessorClose';
      readonly roomId: string;
      readonly code: number;
      readonly reason?: string;
      readonly wasClean: boolean;
      readonly reconnectable: boolean;
    }
  | {
      readonly _tag: 'reconnectOpened';
      readonly roomId: string;
      readonly attempt: number;
    };

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
  readonly eventQueueCap?: number;
  readonly reconnectBaseUrl?: string;
  readonly reconnectPlayerId?: string;
  readonly reconnectEndpoint?: string | ((roomId: string) => string);
  readonly reconnectRequest?: (roomId: string, reconnectToken: string) => Record<string, unknown>;
  readonly reconnectResponseWsUrl?: (body: {
    readonly wsUrl?: string;
    readonly reconnectToken?: string;
  }) => string | undefined;
  readonly fetch?: typeof fetch;
  readonly observe?: (observation: TransportObservation) => void;
}

export const isReconnectableCloseCode = (code: number): boolean =>
  code !== NORMAL_CLOSE_CODE && code !== KICKED_CLOSE_CODE && code !== MATCH_ENDED_CLOSE_CODE;

export const normalizeReconnectWsUrl = (wsUrl: string): string =>
  wsUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');

export const makeBrowserWebSocketTransport = (
  options: BrowserWebSocketTransportOptions = {},
): Transport => {
  const queue = Effect.runSync(
    Queue.bounded<TransportEvent, TransportError | Cause.Done>(
      options.eventQueueCap ?? DEFAULT_TRANSPORT_EVENT_QUEUE_CAP,
    ),
  );
  const sessionAttempts = Ref.makeUnsafe(0);
  const pendingHealthAck = Ref.makeUnsafe(true);
  let socket: WebSocket | undefined;
  let lastUrl: string | undefined;
  let lastClose:
    | {
        readonly socket: WebSocket;
        readonly event: TransportCloseEvent;
      }
    | undefined;
  let reconnectToken = options.reconnectToken;
  const reconnectPredecessorSockets = new Map<WebSocket, string>();
  const closeWaiters = new Map<WebSocket, Array<(event: TransportCloseEvent) => void>>();
  const textEncoder = new TextEncoder();
  const reconnectAttemptCap = options.reconnectAttemptCap ?? DEFAULT_RECONNECT_ATTEMPT_CAP;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const reconnectBaseUrl = options.reconnectBaseUrl?.replace(/\/$/, '');
  const reconnectEndpoint =
    options.reconnectEndpoint ??
    ((roomId: string): string =>
      reconnectBaseUrl === undefined
        ? `/api/matches/${encodeURIComponent(roomId)}/reconnect`
        : `${reconnectBaseUrl}${DEFAULT_ROOM_RECONNECT_PATH}`);
  const reconnectRequest =
    options.reconnectRequest ??
    ((roomId: string, token: string): Record<string, unknown> => ({
      roomId,
      ...(options.reconnectPlayerId === undefined ? {} : { playerId: options.reconnectPlayerId }),
      reconnectToken: token,
    }));
  const reconnectResponseWsUrl =
    options.reconnectResponseWsUrl ??
    ((body: { readonly wsUrl?: string }): string | undefined =>
      body.wsUrl === undefined ? undefined : normalizeReconnectWsUrl(body.wsUrl));

  const offerMessage = (data: Uint8Array): void => {
    // Bounded message backpressure: if consumers fall behind, drop newest data
    // frames. Close events use Queue.offer below and are never dropped.
    Queue.offerUnsafe(queue, { _tag: 'message', data });
  };

  const offerClose = (event: TransportCloseEvent): void => {
    options.observe?.({
      ...event,
      reconnectable: isReconnectableCloseCode(event.code),
    });
    const enqueueClose = Queue.offer(queue, event).pipe(
      Effect.flatMap(() =>
        !isReconnectableCloseCode(event.code) ? Queue.end(queue) : Effect.succeed(void 0),
      ),
    );
    void Effect.runPromise(enqueueClose);
  };

  const recordClose = (ws: WebSocket, event: TransportCloseEvent): void => {
    lastClose = { socket: ws, event };
    const waiters = closeWaiters.get(ws);
    if (waiters === undefined) {
      return;
    }
    closeWaiters.delete(ws);
    for (const resolve of waiters) {
      resolve(event);
    }
  };

  const waitForClose = (ws: WebSocket): Promise<TransportCloseEvent> => {
    if (lastClose?.socket === ws) {
      return Promise.resolve(lastClose.event);
    }
    return new Promise((resolve) => {
      const waiters = closeWaiters.get(ws);
      if (waiters === undefined) {
        closeWaiters.set(ws, [resolve]);
        return;
      }
      waiters.push(resolve);
    });
  };

  const isMatchEndedClose = (event: TransportCloseEvent): boolean =>
    event.code === MATCH_ENDED_CLOSE_CODE;

  const socketNotOpenError = (): TransportError =>
    new TransportError({
      message: 'websocket is not open',
      code: Option.none(),
      cause: Option.none(),
    });

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
      lastClose = undefined;

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
      ws.onmessage = (event: MessageEvent<ArrayBuffer | Blob | string>) => {
        Effect.runSync(markHealthy());
        if (event.data instanceof ArrayBuffer) {
          offerMessage(new Uint8Array(event.data));
          return;
        }
        if (ArrayBuffer.isView(event.data)) {
          offerMessage(
            new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength),
          );
          return;
        }
        if (typeof event.data === 'string') {
          offerMessage(textEncoder.encode(event.data));
          return;
        }
        void event.data.arrayBuffer().then((buffer) => {
          offerMessage(new Uint8Array(buffer));
        });
      };
      ws.onclose = (event) => {
        const predecessorRoomId = reconnectPredecessorSockets.get(ws);
        if (predecessorRoomId !== undefined) {
          reconnectPredecessorSockets.delete(ws);
          options.observe?.({
            _tag: 'reconnectPredecessorClose',
            roomId: predecessorRoomId,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            reconnectable: isReconnectableCloseCode(event.code),
          });
          return;
        }
        const closeEvent = {
          _tag: 'close' as const,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        };
        if (socket === ws) {
          socket = undefined;
        }
        recordClose(ws, closeEvent);
        offerClose(closeEvent);
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
      Effect.gen(function* () {
        const activeSocket = socket;
        if (!activeSocket) {
          if (lastClose !== undefined && isMatchEndedClose(lastClose.event)) {
            return;
          }
          yield* socketNotOpenError();
          return;
        }
        if (activeSocket.readyState !== WebSocket.OPEN) {
          if (
            activeSocket.readyState !== WebSocket.CLOSING &&
            activeSocket.readyState !== WebSocket.CLOSED
          ) {
            yield* socketNotOpenError();
            return;
          }
          const close = yield* Effect.promise(() => waitForClose(activeSocket));
          if (isMatchEndedClose(close)) {
            return;
          }
          yield* socketNotOpenError();
          return;
        }
        yield* Effect.try({
          try: () => {
            const body = data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            ) as ArrayBuffer;
            activeSocket.send(body);
          },
          catch: (cause) =>
            cause instanceof TransportError
              ? cause
              : new TransportError({
                  message: 'websocket send failed',
                  code: Option.none(),
                  cause: Option.some(cause),
                }),
        });
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
        options.observe?.({ _tag: 'reconnectAttempt', roomId, attempt: nextAttempt });
        if (nextAttempt > reconnectAttemptCap) {
          yield* new TransportError({
            message: 'reconnect attempts exhausted',
            code: Option.none(),
            cause: Option.none(),
          });
        }
        const reconnectTokenForRequest = reconnectToken;
        if (!reconnectTokenForRequest) {
          yield* new TransportError({
            message: 'reconnectToken is required for reconnect',
            code: Option.none(),
            cause: Option.none(),
          });
          return;
        }
        const response = yield* Effect.tryPromise({
          try: () =>
            fetchImpl(
              typeof reconnectEndpoint === 'function'
                ? reconnectEndpoint(roomId)
                : reconnectEndpoint,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(reconnectRequest(roomId, reconnectTokenForRequest)),
              },
            ),
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
        const wsUrl = reconnectResponseWsUrl(body);
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
        const predecessor = socket;
        if (predecessor !== undefined) {
          reconnectPredecessorSockets.set(predecessor, roomId);
          predecessor.close(NORMAL_CLOSE_CODE, 'reconnecting');
        }
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
        options.observe?.({ _tag: 'reconnectOpened', roomId, attempt: nextAttempt });
      }),
  };
};

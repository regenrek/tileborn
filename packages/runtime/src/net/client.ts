import { Effect, Match, Option, Stream } from 'effect';

import {
  decodeMessage,
  encodeMessage,
  ProtocolError,
  RuntimeMessage,
  TransportError,
} from './protocol.js';
import {
  isReconnectableCloseCode,
  MATCH_ENDED_CLOSE_CODE,
  type Transport,
  type TransportCloseEvent,
  type TransportEvent,
} from './transport.js';

export interface NetClientOptions {
  readonly roomId?: string;
}

export interface NetFrameHeartbeatOptions {
  readonly intervalMs: number;
  readonly makeFrame: () => Uint8Array;
}

export interface NetFrameClientOptions extends NetClientOptions {
  readonly heartbeat?: NetFrameHeartbeatOptions;
}

export interface NetClient {
  readonly connect: (url: string) => Effect.Effect<void, TransportError>;
  readonly send: (message: RuntimeMessage) => Effect.Effect<void, ProtocolError | TransportError>;
  readonly receive: () => Stream.Stream<RuntimeMessage, ProtocolError | TransportError>;
  readonly close: () => Effect.Effect<void, TransportError>;
}

export interface NetFrameClient {
  readonly connect: (url: string) => Effect.Effect<void, TransportError>;
  readonly connectPromise: (url: string) => Promise<void>;
  readonly sendFrame: (frame: Uint8Array) => Effect.Effect<void, TransportError>;
  readonly sendFramePromise: (frame: Uint8Array) => Promise<void>;
  readonly receiveFrames: () => Stream.Stream<Uint8Array, TransportError>;
  readonly runFrames: (handler: (frame: Uint8Array) => void) => Promise<void>;
  readonly close: () => Effect.Effect<void, TransportError>;
  readonly closePromise: () => Promise<void>;
}

export const encodeMessageEffect = (
  message: RuntimeMessage,
): Effect.Effect<Uint8Array, ProtocolError> =>
  Effect.try({
    try: () => encodeMessage(message),
    catch: (cause) =>
      cause instanceof ProtocolError
        ? cause
        : new ProtocolError({
            message: 'failed to encode runtime message',
            cause: Option.some(cause),
          }),
  });

export const decodeMessageEffect = (
  frame: Uint8Array,
): Effect.Effect<RuntimeMessage, ProtocolError> =>
  Effect.try({
    try: () => decodeMessage(frame),
    catch: (cause) =>
      cause instanceof ProtocolError
        ? cause
        : new ProtocolError({
            message: 'failed to decode runtime message',
            cause: Option.some(cause),
          }),
  });

export const makeNetClient = (transport: Transport, options: NetClientOptions = {}): NetClient => {
  const reconnect = (close: TransportCloseEvent): Effect.Effect<void, TransportError> =>
    Effect.gen(function* () {
      if (!isReconnectableCloseCode(close.code)) {
        return;
      }
      const roomId = options.roomId;
      const reconnectTransport = transport.reconnect;
      if (!roomId || !reconnectTransport) {
        yield* new TransportError({
          message: `unexpected websocket close ${close.code} without reconnect support`,
          code: Option.some(close.code),
          cause: Option.none(),
        });
        return;
      }

      yield* reconnectTransport(roomId);
    });

  const toMessageStream = (event: TransportEvent) =>
    Match.valueTags(event, {
      message: ({ data }) => Stream.fromEffect(decodeMessageEffect(data)),
      close: (close) =>
        Stream.fromEffect(reconnect(close)).pipe(Stream.flatMap(() => Stream.empty)),
    });

  return {
    connect: (url) => transport.connect(url),
    send: (message) =>
      Effect.gen(function* () {
        const encoded = yield* encodeMessageEffect(message);
        yield* transport.send(encoded);
      }),
    receive: () => transport.receive().pipe(Stream.flatMap(toMessageStream)),
    close: () => transport.close(),
  };
};

export const makeNetFrameClient = (
  transport: Transport,
  options: NetFrameClientOptions = {},
): NetFrameClient => {
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let terminalCloseCode: number | undefined;

  const stopHeartbeat = (): void => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const startHeartbeat = (): void => {
    stopHeartbeat();
    const heartbeat = options.heartbeat;
    if (heartbeat === undefined || terminalCloseCode !== undefined) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      void Effect.runPromise(sendFrame(heartbeat.makeFrame())).catch(() => undefined);
    }, heartbeat.intervalMs);
  };

  const markTerminalClose = (close: TransportCloseEvent): void => {
    if (close.code !== MATCH_ENDED_CLOSE_CODE) {
      return;
    }
    terminalCloseCode = close.code;
    stopHeartbeat();
  };

  const reconnect = (close: TransportCloseEvent): Effect.Effect<void, TransportError> =>
    Effect.gen(function* () {
      yield* Effect.sync(() => markTerminalClose(close));
      if (!isReconnectableCloseCode(close.code)) {
        return;
      }
      const roomId = options.roomId;
      const reconnectTransport = transport.reconnect;
      if (!roomId || !reconnectTransport) {
        yield* new TransportError({
          message: `unexpected websocket close ${close.code} without reconnect support`,
          code: Option.some(close.code),
          cause: Option.none(),
        });
        return;
      }

      yield* reconnectTransport(roomId);
    });

  const toFrameStream = (event: TransportEvent) =>
    Match.valueTags(event, {
      message: ({ data }) => Stream.fromEffect(transport.markHealthy().pipe(Effect.as(data))),
      close: (close) =>
        Stream.fromEffect(reconnect(close)).pipe(Stream.flatMap(() => Stream.empty)),
    });

  const connect = (url: string): Effect.Effect<void, TransportError> =>
    transport.connect(url).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          terminalCloseCode = undefined;
          startHeartbeat();
        }),
      ),
    );
  const sendFrame = (frame: Uint8Array): Effect.Effect<void, TransportError> =>
    Effect.suspend(() =>
      terminalCloseCode !== undefined
        ? Effect.succeed(void 0)
        : transport.send(frame).pipe(
            Effect.catchIf(
              () => terminalCloseCode !== undefined,
              () => Effect.succeed(void 0),
            ),
          ),
    );
  const receiveFrames = (): Stream.Stream<Uint8Array, TransportError> =>
    transport
      .receive()
      .pipe(Stream.flatMap(toFrameStream), Stream.ensuring(Effect.sync(stopHeartbeat)));
  const close = (): Effect.Effect<void, TransportError> =>
    Effect.sync(stopHeartbeat).pipe(Effect.flatMap(() => transport.close()));

  return {
    connect,
    connectPromise: (url) => Effect.runPromise(connect(url)),
    sendFrame,
    sendFramePromise: (frame) => Effect.runPromise(sendFrame(frame)),
    receiveFrames,
    runFrames: (handler) =>
      Effect.runPromise(
        receiveFrames().pipe(Stream.runForEach((frame) => Effect.sync(() => handler(frame)))),
      ),
    close,
    closePromise: () => Effect.runPromise(close()),
  };
};

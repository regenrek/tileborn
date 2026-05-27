import { Effect, Match, Option, Stream } from "effect";

import {
  decodeMessage,
  encodeMessage,
  ProtocolError,
  RuntimeMessage,
  TransportError,
} from "./protocol.js";
import { isReconnectableCloseCode, type Transport, type TransportCloseEvent, type TransportEvent } from "./transport.js";

export interface NetClientOptions {
  readonly roomId?: string;
}

export interface NetClient {
  readonly connect: (url: string) => Effect.Effect<void, TransportError>;
  readonly send: (message: RuntimeMessage) => Effect.Effect<void, ProtocolError | TransportError>;
  readonly receive: () => Stream.Stream<RuntimeMessage, ProtocolError | TransportError>;
  readonly close: () => Effect.Effect<void, TransportError>;
}

export const encodeMessageEffect = (message: RuntimeMessage): Effect.Effect<Uint8Array, ProtocolError> =>
  Effect.try({
    try: () => encodeMessage(message),
    catch: (cause) =>
      cause instanceof ProtocolError
        ? cause
        : new ProtocolError({
            message: "failed to encode runtime message",
            cause: Option.some(cause),
          }),
  });

export const decodeMessageEffect = (frame: Uint8Array): Effect.Effect<RuntimeMessage, ProtocolError> =>
  Effect.try({
    try: () => decodeMessage(frame),
    catch: (cause) =>
      cause instanceof ProtocolError
        ? cause
        : new ProtocolError({
            message: "failed to decode runtime message",
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
      close: (close) => Stream.fromEffect(reconnect(close)).pipe(Stream.flatMap(() => Stream.empty)),
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

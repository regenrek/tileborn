import { Effect, Option, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InputCommand } from "../input/input.js";
import { makeNetClient } from "./client.js";
import {
  Chat,
  ClientReady,
  decodeMessage,
  encodeMessage,
  Events,
  InputBatch,
  MatchEnd,
  Ping,
  Pong,
  ProtocolError,
  RuntimeMessage,
  ServerNotice,
  SnapshotDelta,
  SnapshotFull,
  TransportError,
  Welcome,
} from "./protocol.js";
import { DEFAULT_RECONNECT_ATTEMPT_CAP, makeBrowserWebSocketTransport, type Transport, type TransportEvent } from "./transport.js";

const sampleMessages: readonly RuntimeMessage[] = [
  new Welcome({
    entityId: "entity-1",
    slot: 1,
    mapWidth: 128,
    mapHeight: 64,
    snapshotHz: 20,
    seed: "seed-1",
  }),
  new ClientReady({}),
  new InputBatch({
    commands: [new InputCommand({ tick: 1, buttons: 1, moveX: 1, moveY: 0, aimX: 10, aimY: 20 })],
  }),
  new SnapshotFull({
    players: Option.some([{ entityId: 1, x: 10, y: 20 }]),
    pickups: Option.some([{ id: "pickup-1" }]),
    decoys: Option.some([]),
    safeZone: Option.some({ x: 0, y: 0, radius: 20 }),
  }),
  new SnapshotDelta({
    tick: 2,
    baseTick: 1,
    diff: Option.some([{ entityId: 1, x: 11 }]),
  }),
  new Events({
    events: Option.some([{ type: "pickup", entityId: 1 }]),
  }),
  new Ping({
    sentAtMs: Option.some(100),
  }),
  new Pong({
    sentAtMs: Option.some(100),
  }),
  new Chat({
    text: "hello",
    playerId: Option.some("player-1"),
  }),
  new MatchEnd({
    winner: Option.some("player-1"),
    results: Option.some([{ playerId: "player-1", rank: 1 }]),
  }),
  new ServerNotice({
    message: "Server restart in 60 s",
  }),
];

describe("runtime net protocol", () => {
  for (const message of sampleMessages) {
    it(`round-trips ${message._tag}`, () => {
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    });
  }
});

describe("NetClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces encode failures as typed ProtocolError failures", async () => {
    const sent: Uint8Array[] = [];
    const client = makeNetClient(mockTransport({ sent }));
    const invalid = {
      _tag: "Chat",
      text: (() => "not-msgpack-or-schema-compatible") as unknown as string,
      playerId: Option.none(),
    } as RuntimeMessage;

    const error = await Effect.runPromise(Effect.flip(client.send(invalid)));

    expect(error).toBeInstanceOf(ProtocolError);
    expect(error._tag).toBe("ProtocolError");
    expect(sent).toEqual([]);
  });

  it("reconnects after an unexpected close and resumes the receive stream", async () => {
    let reconnects = 0;
    const resumed = new ServerNotice({ message: "resumed" });
    const client = makeNetClient(
      mockTransport({
        events: [
          { _tag: "close", code: 1011, reason: "server restart", wasClean: false },
          { _tag: "message", data: encodeMessage(resumed) },
        ],
        reconnect: () =>
          Effect.sync(() => {
            reconnects += 1;
          }),
      }),
      {
        roomId: "room-1",
      },
    );

    const messages = await Effect.runPromise(client.receive().pipe(Stream.take(1), Stream.runCollect));

    expect(Array.from(messages as Iterable<RuntimeMessage>)).toEqual([resumed]);
    expect(reconnects).toBe(1);
  });

  it("propagates transport reconnect failures", async () => {
    let reconnects = 0;
    const reconnectError = new TransportError({
      message: "reconnect unavailable",
      code: Option.none(),
      cause: Option.none(),
    });
    const client = makeNetClient(
      mockTransport({
        events: [{ _tag: "close", code: 1011, wasClean: false }],
        reconnect: () =>
          Effect.gen(function* () {
            reconnects += 1;
            yield* reconnectError;
          }),
      }),
      {
        roomId: "room-1",
      },
    );

    const error = await Effect.runPromise(Effect.flip(client.receive().pipe(Stream.runCollect)));

    expect(error).toBeInstanceOf(TransportError);
    expect(error.message).toBe("reconnect unavailable");
    expect(reconnects).toBe(1);
  });

  it("caps reconnect attempts across immediate re-close events", async () => {
    const sockets: FakeWebSocket[] = [];
    let reconnectFetches = 0;
    vi.stubGlobal(
      "WebSocket",
      makeFakeWebSocket(sockets, (socket) => {
        if (socket.url.startsWith("wss://reconnect-")) {
          queueMicrotask(() => socket.close(1006, "abnormal close"));
        }
      }),
    );
    const transport = makeBrowserWebSocketTransport({
      reconnectToken: "token-1",
      fetch: async () => {
        reconnectFetches += 1;
        return jsonResponse({ wsUrl: `wss://reconnect-${reconnectFetches}`, reconnectToken: "token-1" });
      },
    });
    const client = makeNetClient(transport, { roomId: "room-1" });

    await Effect.runPromise(transport.connect("wss://initial"));
    sockets[0]!.close(1006, "initial drop");
    const error = await Effect.runPromise(Effect.flip(client.receive().pipe(Stream.runCollect)));

    expect(error).toBeInstanceOf(TransportError);
    expect(error.message).toBe("reconnect attempts exhausted");
    expect(reconnectFetches).toBe(DEFAULT_RECONNECT_ATTEMPT_CAP);
  });

  it("resets the reconnect budget after the first frame marks the socket healthy", async () => {
    const sockets: FakeWebSocket[] = [];
    const welcome = new Welcome({
      entityId: "entity-1",
      slot: 1,
      mapWidth: 128,
      mapHeight: 64,
      snapshotHz: 20,
      seed: "seed-1",
    });
    const received: RuntimeMessage[] = [];
    let reconnectFetches = 0;
    vi.stubGlobal(
      "WebSocket",
      makeFakeWebSocket(sockets, (socket) => {
        if (!socket.url.startsWith("wss://reconnect-")) {
          return;
        }
        if (socket.url === "wss://reconnect-1") {
          socket.emitMessage(encodeMessage(welcome));
        }
        queueMicrotask(() => socket.close(1006, "abnormal close"));
      }),
    );
    const transport = makeBrowserWebSocketTransport({
      reconnectToken: "token-1",
      fetch: async () => {
        reconnectFetches += 1;
        return jsonResponse({ wsUrl: `wss://reconnect-${reconnectFetches}`, reconnectToken: "token-1" });
      },
    });
    const client = makeNetClient(transport, { roomId: "room-1" });

    await Effect.runPromise(transport.connect("wss://initial"));
    sockets[0]!.close(1006, "initial drop");
    const error = await Effect.runPromise(
      Effect.flip(
        client
          .receive()
          .pipe(
            Stream.tap((message) =>
              Effect.sync(() => {
                received.push(message);
              }),
            ),
            Stream.runCollect,
          ),
      ),
    );

    expect(error).toBeInstanceOf(TransportError);
    expect(error.message).toBe("reconnect attempts exhausted");
    expect(received).toEqual([welcome]);
    expect(reconnectFetches).toBe(DEFAULT_RECONNECT_ATTEMPT_CAP + 1);
  });

  it("propagates typed connect failures", async () => {
    const connectError = new TransportError({
      message: "connect refused",
      code: Option.none(),
      cause: Option.none(),
    });
    const client = makeNetClient(
      mockTransport({
        connect: () => Effect.fail(connectError),
      }),
    );

    const error = await Effect.runPromise(Effect.flip(client.connect("wss://example.test/room")));

    expect(error).toBe(connectError);
  });

  it("sends encoded frames through the transport", async () => {
    const sent: Uint8Array[] = [];
    const client = makeNetClient(mockTransport({ sent }));

    await Effect.runPromise(client.send(sampleMessages[0]!));

    expect(sent).toHaveLength(1);
    expect(decodeMessage(sent[0]!)).toEqual(sampleMessages[0]);
  });

  it("decodes inbound message events", async () => {
    const client = makeNetClient(mockTransport({ events: [{ _tag: "message", data: encodeMessage(sampleMessages[10]!) }] }));

    const messages = await Effect.runPromise(client.receive().pipe(Stream.take(1), Stream.runCollect));

    expect(Array.from(messages as Iterable<RuntimeMessage>)).toEqual([sampleMessages[10]]);
  });

  it("surfaces decode failures as typed ProtocolError failures", async () => {
    const client = makeNetClient(mockTransport({ events: [{ _tag: "message", data: new Uint8Array([0xff]) }] }));

    const error = await Effect.runPromise(Effect.flip(client.receive().pipe(Stream.runCollect)));

    expect(error).toBeInstanceOf(ProtocolError);
    expect(error._tag).toBe("ProtocolError");
  });

  it("does not reconnect for normal close code 1000", async () => {
    let reconnects = 0;
    const client = makeNetClient(
      mockTransport({
        events: [{ _tag: "close", code: 1000, wasClean: true }],
        reconnect: () =>
          Effect.sync(() => {
            reconnects += 1;
          }),
      }),
      { roomId: "room-1" },
    );

    await Effect.runPromise(client.receive().pipe(Stream.runCollect));

    expect(reconnects).toBe(0);
  });

  it("does not reconnect kicked close code 4001", async () => {
    let reconnects = 0;
    const client = makeNetClient(
      mockTransport({
        events: [{ _tag: "close", code: 4001, wasClean: true }],
        reconnect: () =>
          Effect.sync(() => {
            reconnects += 1;
          }),
      }),
      { roomId: "room-1" },
    );

    await Effect.runPromise(client.receive().pipe(Stream.runCollect));

    expect(reconnects).toBe(0);
  });

  it("does not reconnect match-ended close code 4006", async () => {
    let reconnects = 0;
    const client = makeNetClient(
      mockTransport({
        events: [{ _tag: "close", code: 4006, wasClean: true }],
        reconnect: () =>
          Effect.sync(() => {
            reconnects += 1;
          }),
      }),
      { roomId: "room-1" },
    );

    await Effect.runPromise(client.receive().pipe(Stream.runCollect));

    expect(reconnects).toBe(0);
  });
});

const mockTransport = (options: {
  readonly events?: readonly TransportEvent[];
  readonly sent?: Uint8Array[];
  readonly connect?: (url: string) => Effect.Effect<void, TransportError>;
  readonly reconnect?: (roomId: string) => Effect.Effect<void, TransportError>;
}): Transport => ({
  connect: options.connect ?? (() => Effect.succeed(void 0)),
  send: (bytes) =>
    Effect.sync(() => {
      options.sent?.push(bytes);
    }),
  receive: () => Stream.fromIterable(options.events ?? []),
  close: () => Effect.succeed(void 0),
  markHealthy: () => Effect.succeed(void 0),
  ...(options.reconnect === undefined ? {} : { reconnect: options.reconnect }),
});

class FakeWebSocket {
  binaryType: BinaryType = "blob";
  readyState = WebSocket.CONNECTING;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;

  constructor(
    readonly url: string,
    private readonly onOpened: (socket: FakeWebSocket) => void,
  ) {
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      this.onopen?.call(this as unknown as WebSocket, {} as Event);
      this.onOpened(this);
    });
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }
    this.readyState = WebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, {
      code,
      reason,
      wasClean: code === 1000,
    } as CloseEvent);
  }

  send(): void {
    return;
  }

  emitMessage(data: Uint8Array): void {
    const body = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    this.onmessage?.call(this as unknown as WebSocket, { data: body } as MessageEvent<ArrayBuffer>);
  }
}

const makeFakeWebSocket =
  (sockets: FakeWebSocket[], onOpened: (socket: FakeWebSocket) => void) =>
  class extends FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    constructor(url: string) {
      super(url, onOpened);
      sockets.push(this);
    }
  };

const jsonResponse = (body: { readonly wsUrl: string; readonly reconnectToken: string }): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

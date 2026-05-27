import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { makeNetClient, type NetClient } from "../net/client.js";
import { encodeMessage, InputBatch, Welcome } from "../net/protocol.js";
import type { Transport, TransportEvent } from "../net/transport.js";
import { InputCommand } from "../input/input.js";
import { makePluginHost } from "../plugin/plugin-host.js";
import { makeGameRuntime } from "./game-runtime.js";

class MockTransport implements Transport {
  readonly sent: Uint8Array[] = [];
  connectedUrl: string | undefined;
  closed = false;

  constructor(private readonly incoming: readonly TransportEvent[] = []) {}

  connect(url: string) {
    return Effect.sync(() => {
      this.connectedUrl = url;
    });
  }

  send(bytes: Uint8Array) {
    return Effect.sync(() => {
      this.sent.push(bytes);
    });
  }

  receive() {
    return Stream.fromIterable(this.incoming);
  }

  close() {
    return Effect.sync(() => {
      this.closed = true;
    });
  }
}

describe("GameRuntime networking and plugin integration", () => {
  it("dispatches plugin ticks from the fixed update loop", async () => {
    const ticks: number[] = [];
    const pluginHost = makePluginHost();
    await Effect.runPromise(
      pluginHost.register({
        id: "tick-plugin",
        onTick: (_world, _dt, tick) => Effect.sync(() => ticks.push(tick)),
      }),
    );
    const runtime = makeGameRuntime();
    await Effect.runPromise(runtime.init({ pluginHost }));
    await Effect.runPromise(runtime.step(2));
    expect(ticks).toEqual([1, 2]);
  });

  it("connects NetClient and dispatches inbound messages to plugins", async () => {
    const messages: string[] = [];
    const welcome = new Welcome({
      entityId: "entity-1",
      slot: 1,
      mapWidth: 128,
      mapHeight: 64,
      snapshotHz: 20,
      seed: "seed-1",
    });
    const transport = new MockTransport([{ _tag: "message", data: encodeMessage(welcome) }]);
    const netClient = makeNetClient(transport);
    const pluginHost = makePluginHost();
    await Effect.runPromise(
      pluginHost.register({
        id: "message-plugin",
        onMessage: (message) => Effect.sync(() => messages.push(message._tag)),
      }),
    );

    const runtime = makeGameRuntime();
    await Effect.runPromise(runtime.init({ netClient, netUrl: "wss://example.invalid/room", pluginHost }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.connectedUrl).toBe("wss://example.invalid/room");
    expect(messages).toEqual(["Welcome"]);
  });

  it("closes the configured NetClient on stop", async () => {
    let closed = false;
    const netClient: NetClient = {
      connect: () => Effect.succeed(void 0),
      send: () => Effect.succeed(void 0),
      receive: () => Stream.fromIterable([]),
      close: () =>
        Effect.sync(() => {
          closed = true;
        }),
    };
    const runtime = makeGameRuntime();
    await Effect.runPromise(runtime.init({ netClient, netUrl: "wss://example.invalid/room" }));
    await Effect.runPromise(runtime.stop());
    expect(closed).toBe(true);
  });

  it("sends typed input messages through the configured NetClient", async () => {
    const transport = new MockTransport();
    const netClient = makeNetClient(transport);
    await Effect.runPromise(
      netClient.send(
        new InputBatch({
          commands: [new InputCommand({ tick: 1, buttons: 1, moveX: 1, moveY: 0, aimX: 10, aimY: 20 })],
        }),
      ),
    );
    expect(transport.sent).toHaveLength(1);
  });
});

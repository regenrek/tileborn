import { Effect, Match, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { DeterministicClock } from "../clock/deterministic-clock.js";
import { PositionComponent, VelocityComponent } from "../ecs/components.js";
import type { EntityId, World } from "../ecs/world.js";
import { InputCommand } from "../input/input.js";
import { makeNetClient } from "../net/client.js";
import { encodeMessage, SnapshotFull, Welcome } from "../net/protocol.js";
import type { Transport, TransportEvent } from "../net/transport.js";
import { makePluginHost } from "../plugin/plugin-host.js";
import {
  previousPositionFor,
  type MountedRenderer,
  type RendererAdapter,
} from "../renderer/renderer-adapter.js";
import { makeGameRuntime } from "../runtime/game-runtime.js";

const components = [PositionComponent, VelocityComponent] as const;

describe("runtime smoke scenarios", () => {
  it("runs 1000 headless ticks with two movement systems deterministically", async () => {
    const tickRate = 60;
    const ticks = 1000;
    const initialX = 2;
    const initialY = 3;
    const velocityX = 12;
    const velocityY = -6;
    const stepSeconds = 1 / tickRate;
    const runtime = makeGameRuntime();
    const state = await Effect.runPromise(runtime.init({ tickRate }));
    const entity = state.world.createEntity();
    state.world.addComponent(entity, PositionComponent, { x: initialX, y: initialY });
    state.world.addComponent(entity, VelocityComponent, { x: velocityX, y: velocityY });
    await Effect.runPromise(runtime.registerSystem(axisMovementSystem("x-movement", "x")));
    await Effect.runPromise(runtime.registerSystem(axisMovementSystem("y-movement", "y")));

    await Effect.runPromise(runtime.step(ticks));

    const position = getPosition(state.world, entity);
    // docs/03-runtime-game-host.md §7.2 step 2: position integrates velocity * dt each tick.
    const expectedX = initialX + velocityX * stepSeconds * ticks;
    const expectedY = initialY + velocityY * stepSeconds * ticks;
    expect(position.x).toBeCloseTo(expectedX);
    expect(position.y).toBeCloseTo(expectedY);
    expect(state.loop.tick).toBe(ticks);
  });

  it("samples one input command per headless tick", async () => {
    const runtime = makeGameRuntime();
    const state = await Effect.runPromise(runtime.init());
    const ticks: number[] = [];
    await Effect.runPromise(
      runtime.registerSystem({
        name: "input-observer",
        query: [],
        update: (_world, _dt, context) => {
          const command = context.input as InputCommand;
          ticks.push(command.tick);
        },
      }),
    );

    await Effect.runPromise(runtime.step(5));

    expect(ticks).toEqual([1, 2, 3, 4, 5]);
    expect(state.input.consumeCommands().map((command) => command.tick)).toEqual([1, 2, 3, 4, 5]);
  });

  it("calls a renderer once per fixed render boundary across 100 ticks", async () => {
    const renderer = new RecordingRenderer();
    const runtime = makeGameRuntime();
    await Effect.runPromise(runtime.init({ renderer, rendererContainer: {}, assetManifest: emptyManifest }));

    for (let index = 0; index < 100; index += 1) {
      await Effect.runPromise(runtime.step(1));
    }

    expect(renderer.alphas).toEqual(Array.from({ length: 100 }, () => 0));
  });

  it("captures previous positions before renderer-backed ticks mutate entities", async () => {
    const renderer = new RecordingRenderer();
    const runtime = makeGameRuntime();
    const state = await Effect.runPromise(runtime.init({ renderer, rendererContainer: {}, assetManifest: emptyManifest }));
    const entity = state.world.createEntity();
    state.world.addComponent(entity, PositionComponent, { x: 10, y: 20 });
    state.world.addComponent(entity, VelocityComponent, { x: 60, y: 30 });
    await Effect.runPromise(runtime.registerSystem(axisMovementSystem("x-movement", "x")));
    await Effect.runPromise(runtime.registerSystem(axisMovementSystem("y-movement", "y")));

    for (let index = 0; index < 3; index += 1) {
      await Effect.runPromise(runtime.step(1));
    }

    expect(renderer.previousPositionsByFrame).toEqual([
      [{ x: 10, y: 20 }],
      [{ x: 11, y: 20.5 }],
      [{ x: 12, y: 21 }],
    ]);
  });

  it("passes alpha interpolation values from the fixed-step loop to the renderer", async () => {
    const clock = new DeterministicClock();
    const renderer = new RecordingRenderer();
    const runtime = makeGameRuntime();
    const state = await Effect.runPromise(runtime.init({ clock, renderer, rendererContainer: {}, assetManifest: emptyManifest }));
    await Effect.runPromise(runtime.start());

    for (let index = 0; index < 100; index += 1) {
      clock.advance(state.loop.stepMs * 1.25);
      state.loop.runFrame();
    }

    expect(renderer.alphas).toHaveLength(100);
    for (const alpha of renderer.alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
    expect(renderer.alphas.at(-1)).toBeCloseTo(0);
  });

  it("dispatches SnapshotFull from a mock transport to plugin onMessage as a typed variant", async () => {
    const snapshot = new SnapshotFull({
      players: Option.some([{ entityId: 1, x: 12, y: 20 }]),
      pickups: Option.none(),
      decoys: Option.none(),
      safeZone: Option.none(),
    });
    const received: string[] = [];
    const pluginHost = makePluginHost();
    await Effect.runPromise(
      pluginHost.register({
        id: "typed-message-listener",
        onMessage: (message) =>
          Effect.sync(() => {
            received.push(
              Match.valueTags(message, {
                Welcome: () => "Welcome",
                ClientReady: () => "ClientReady",
                InputBatch: () => "InputBatch",
                SnapshotFull: () => "SnapshotFull",
                SnapshotDelta: () => "SnapshotDelta",
                Events: () => "Events",
                Ping: () => "Ping",
                Pong: () => "Pong",
                Chat: () => "Chat",
                MatchEnd: () => "MatchEnd",
                ServerNotice: () => "ServerNotice",
              }),
            );
          }),
      }),
    );
    const transport = mockTransport({ events: [{ _tag: "message", data: encodeMessage(snapshot) }] });
    const runtime = makeGameRuntime();

    await Effect.runPromise(
      runtime.init({
        netClient: makeNetClient(transport),
        netUrl: "wss://runtime.test/room",
        pluginHost,
      }),
    );
    await waitForForkedReceive();

    expect(received).toEqual(["SnapshotFull"]);
    expect(transport.connectedUrls).toEqual(["wss://runtime.test/room"]);
  });

  it("runs ECS, renderer, net, and plugin host together without changing deterministic output", async () => {
    const first = await runIntegratedScenario(123);
    const second = await runIntegratedScenario(123);

    expect(second).toEqual(first);
  });

  it("dispatches plugin ticks while rendering and receiving network messages", async () => {
    const renderer = new RecordingRenderer();
    const ticks: number[] = [];
    const messages: string[] = [];
    const pluginHost = makePluginHost();
    await Effect.runPromise(
      pluginHost.register({
        id: "observer",
        onTick: (_world, _dt, tick) => Effect.sync(() => ticks.push(tick)),
        onMessage: (message) => Effect.sync(() => messages.push(message._tag)),
      }),
    );
    const runtime = makeGameRuntime();
    await Effect.runPromise(
      runtime.init({
        renderer,
        rendererContainer: {},
        assetManifest: emptyManifest,
        netClient: makeNetClient(
          mockTransport({
            events: [
              {
                _tag: "message",
                data: encodeMessage(
                  new Welcome({
                    entityId: "entity-1",
                    slot: 1,
                    mapWidth: 64,
                    mapHeight: 64,
                    snapshotHz: 20,
                    seed: 123,
                  }),
                ),
              },
            ],
          }),
        ),
        netUrl: "wss://runtime.test/room",
        pluginHost,
      }),
    );

    for (let index = 0; index < 200; index += 1) {
      await Effect.runPromise(runtime.step(1));
    }
    await waitForForkedReceive();

    expect(ticks).toHaveLength(200);
    expect(ticks.at(0)).toBe(1);
    expect(ticks.at(-1)).toBe(200);
    expect(renderer.alphas).toHaveLength(200);
    expect(messages).toEqual(["Welcome"]);
  });
});

const axisMovementSystem = (name: string, axis: "x" | "y") => ({
  name,
  query: components,
  update: (world: World, dt: number) => {
    world.query(components, (_entity, position, velocity) => {
      position[axis] += velocity[axis] * dt;
    });
  },
});

class RecordingRenderer implements RendererAdapter {
  readonly alphas: number[] = [];
  readonly previousPositionsByFrame: Array<Array<{ x: number; y: number }>> = [];

  mount(container: unknown): Effect.Effect<MountedRenderer, never> {
    return Effect.succeed({ container });
  }

  loadAssets(): Effect.Effect<ReadonlyMap<string, Uint8Array>, never> {
    return Effect.succeed(new Map());
  }

  renderFrame(world: World, alpha: number): Effect.Effect<void, never> {
    return Effect.sync(() => {
      this.alphas.push(alpha);
      const positions: Array<{ x: number; y: number }> = [];
      world.query([PositionComponent], (entity) => {
        const previous = previousPositionFor(world, entity);
        if (previous) {
          positions.push(previous);
        }
      });
      this.previousPositionsByFrame.push(positions);
    });
  }

  dispose(): Effect.Effect<void, never> {
    return Effect.void;
  }
}

const runIntegratedScenario = async (seed: number): Promise<readonly [number, number, number[]]> => {
  const renderer = new RecordingRenderer();
  const clock = new DeterministicClock({ seed });
  const pluginTicks: number[] = [];
  const pluginHost = makePluginHost();
  await Effect.runPromise(
    pluginHost.register({
      id: "tick-recorder",
      onTick: (_world, _dt, tick) => Effect.sync(() => pluginTicks.push(tick)),
    }),
  );
  const runtime = makeGameRuntime();
  const state = await Effect.runPromise(
    runtime.init({
      clock,
      renderer,
      rendererContainer: {},
      assetManifest: emptyManifest,
      netClient: makeNetClient(mockTransport({ events: [] })),
      netUrl: "wss://runtime.test/room",
      pluginHost,
    }),
  );
  const entity = state.world.createEntity();
  state.world.addComponent(entity, PositionComponent, { x: clock.random() * 10, y: clock.random() * 10 });
  state.world.addComponent(entity, VelocityComponent, { x: 24, y: -12 });
  await Effect.runPromise(runtime.registerSystem(axisMovementSystem("x-movement", "x")));
  await Effect.runPromise(runtime.registerSystem(axisMovementSystem("y-movement", "y")));

  await Effect.runPromise(runtime.step(200));

  const position = getPosition(state.world, entity);
  return [position.x, position.y, pluginTicks] as const;
};

const getPosition = (world: World, entity: EntityId): { readonly x: number; readonly y: number } =>
  Option.getOrThrow(world.getComponent(entity, PositionComponent));

const waitForForkedReceive = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const emptyManifest = {
  id: "pack:00000000-0000-4000-8000-000000000001",
  name: "empty",
  version: "0.0.0",
  assets: [],
};

const mockTransport = (options: { readonly events: readonly TransportEvent[] }): Transport & { readonly connectedUrls: string[] } => {
  const connectedUrls: string[] = [];
  return {
    connectedUrls,
    connect: (url) =>
      Effect.sync(() => {
        connectedUrls.push(url);
      }),
    send: () => Effect.succeed(void 0),
    receive: () => Stream.fromIterable(options.events),
    close: () => Effect.succeed(void 0),
    markHealthy: () => Effect.succeed(void 0),
    reconnect: () => Effect.succeed(void 0),
  } satisfies Transport & { readonly connectedUrls: string[] };
};

import { Size2D } from "@tileborne/core";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildCollisionLayerFromRects,
  CollisionEnvironment,
  createCollisionSystem,
} from "../collision/index.js";
import { PositionComponent, VelocityComponent } from "../ecs/components.js";
import { Button, InputCommand, KeyInputEvent } from "../input/input.js";
import {
  Chat,
  ClientReady,
  decodeMessage,
  encodeMessage,
  Events,
  InputBatch,
  MatchEnd,
  Ping,
  PlayerLoadouts,
  Pong,
  RuntimeMessage,
  ServerNotice,
  SnapshotDelta,
  SnapshotFull,
  Welcome,
} from "../net/protocol.js";
import { SnapshotWorldState } from "../net/snapshot-state.js";
import { makePluginHost } from "../plugin/plugin-host.js";
import { makeGameRuntime } from "../runtime/game-runtime.js";
import {
  createPlayerInputMovementSystem,
  MOVEMENT_TICK_RATE_HZ,
  PLAYER_FOOTPRINT_OFFSET_Y,
  PLAYER_FOOTPRINT_RADIUS,
  PLAYER_SPEED_PX_PER_SECOND,
} from "../simulation/player-movement.js";

const INITIAL_X = 100;
const INITIAL_Y = 100;
const STEP_SECONDS = 1 / MOVEMENT_TICK_RATE_HZ;
const TILE_SIZE = 32;

describe("player movement parity", () => {
  it("maps WASD input to the same straight-line trajectory for W across 60 ticks", async () => {
    const ticks = 60;
    const result = await runMovementParity([{ tick: 1, code: "KeyW", pressed: true }], ticks);
    // docs/03-runtime-game-host.md section 7.2 step 2: position integrates vx/vy * dt each tick.
    const expectedY = INITIAL_Y + -1 * PLAYER_SPEED_PX_PER_SECOND * STEP_SECONDS * ticks;

    expect(result.x).toBeCloseTo(INITIAL_X);
    expect(result.y).toBeCloseTo(expectedY);
  });

  it("maps WASD input to the same straight-line trajectory for D across 60 ticks", async () => {
    const ticks = 60;
    const result = await runMovementParity([{ tick: 1, code: "KeyD", pressed: true }], ticks);
    const expectedX = INITIAL_X + 1 * PLAYER_SPEED_PX_PER_SECOND * STEP_SECONDS * ticks;

    expect(result.x).toBeCloseTo(expectedX);
    expect(result.y).toBeCloseTo(INITIAL_Y);
  });

  it("normalizes diagonal WASD movement", async () => {
    const ticks = 60;
    const result = await runMovementParity(
      [
        { tick: 1, code: "KeyW", pressed: true },
        { tick: 1, code: "KeyD", pressed: true },
      ],
      ticks,
    );
    const axisDelta = PLAYER_SPEED_PX_PER_SECOND * STEP_SECONDS * ticks;
    const normalizedDelta = axisDelta / Math.SQRT2;

    expect(result.x).toBeCloseTo(INITIAL_X + normalizedDelta);
    expect(result.y).toBeCloseTo(INITIAL_Y - normalizedDelta);
  });

  it("keeps Tileborne button masks aligned with runtime constants", () => {
    expect(Button.Up).toBe(1 << 0);
    expect(Button.Down).toBe(1 << 1);
    expect(Button.Left).toBe(1 << 2);
    expect(Button.Right).toBe(1 << 3);
    expect(Button.Fire).toBe(1 << 4);
    expect(Button.Reload).toBe(1 << 5);
    expect(Button.Ability).toBe(1 << 6);
    expect(Button.Drop).toBe(1 << 7);
    expect(Button.Interact).toBe(1 << 8);
  });
});

describe("circle-rect collision parity", () => {
  // Expected values are derived by hand from:
  //   - resolveCircleRect, mirrored at packages/runtime/src/collision/circle-rect.ts;
  //   - docs/03-runtime-game-host.md section 7.2 step 2 (integrate, then resolve);
  //   - PlanDB context c-z6tg: Tileborne CollisionLayer rasterizes arbitrary rects to a
  //     tile grid (Math.floor / Math.ceil bounds in buildCollisionLayerFromRects), so
  //     each input rect is replaced by its tile-aligned cover. Expected outputs reflect
  //     tile-cover collision, not arbitrary-rect collision.
  // The runtime under test must reproduce these values; using resolveCircleRect inside
  // the test to compute "expected" would be tautological.

  it("clamps a player trying to move into a tile-aligned blocking footprint from the left", async () => {
    // Input rect (100, 96, 32, 32) covers tiles (3,3) and (4,3) -> blocking rects at
    // (96,96,32,32) and (128,96,32,32). Player starts at (102, 100), moves +x.
    // 1. Integrate: dx = 260 * 1/60 = 4.333..., next = (106.333, 100).
    // 2. Resolve vs (96,96): cx=106.333 cy=114, closest=(106.333,114), distance=0
    //    -> penetration branch; edge distances left=10.333 right=21.667 top=18 bottom=14
    //    -> min=left -> player.x = 96 - 8 = 88.
    // 3. Resolve vs (128,96): cx=88, dx=-40, distance=40 >= radius -> no push.
    // Final: (88, 100).
    const blockingRect = { x: 100, y: 96, width: 32, height: 32 };
    const position = await runCollisionParity({
      initial: { x: 102, y: 100 },
      input: { tick: 1, code: "KeyD", pressed: true },
      environment: collisionEnvironmentFromRect(blockingRect),
    });

    expect(position.x).toBeCloseTo(88);
    expect(position.y).toBeCloseTo(100);
  });

  it("clamps a player trying to move into a tile-aligned blocking footprint from above", async () => {
    // Input rect (112, 100, 32, 32) covers tiles (3,3) (4,3) (3,4) (4,4) -> four 32x32
    // blocking rects at {96,128} x {96,128}. Player at (128, 90), moves +y.
    // 1. Integrate: dy = 4.333..., next = (128, 94.333).
    // 2. Resolve vs (96,96): cx=128 cy=108.333, closest on right edge, distance=0
    //    -> branch; edges left=32 right=0 top=12.333 bottom=19.667 -> min=right
    //    -> player.x = 96 + 32 + 8 = 136.
    // 3. Resolve vs (128,96): cx=136 cy=108.333, closest=(136,108.333), distance=0
    //    -> branch; edges left=8 right=24 top=12.333 bottom=19.667 -> min=left
    //    -> player.x = 128 - 8 = 120.
    // 4. Resolve vs (96,128) and (128,128): closestY snaps to 128, distance > radius -> no push.
    // Final: (120, 94.333).
    const blockingRect = { x: 112, y: 100, width: 32, height: 32 };
    const position = await runCollisionParity({
      initial: { x: 128, y: 90 },
      input: { tick: 1, code: "KeyS", pressed: true },
      environment: collisionEnvironmentFromRect(blockingRect),
    });

    expect(position.x).toBeCloseTo(120);
    expect(position.y).toBeCloseTo(90 + PLAYER_SPEED_PX_PER_SECOND * STEP_SECONDS);
  });
});

describe("snapshot delta parity", () => {
  it("applies SnapshotDelta changes to match an equivalent SnapshotFull world state", () => {
    const full = new SnapshotFull({
      players: Option.some([
        { entityId: 1, x: 10, y: 20, health: 100 },
        { entityId: 2, x: 30, y: 40, health: 75 },
      ]),
      pickups: Option.none(),
      decoys: Option.none(),
      safeZone: Option.none(),
    });
    const delta = new SnapshotDelta({
      tick: 2,
      baseTick: 1,
      diff: Option.some([
        { entityId: 1, x: 11 },
        { entityId: 2, health: 50 },
      ]),
    });
    const equivalent = new SnapshotFull({
      players: Option.some([
        { entityId: 1, x: 11, y: 20, health: 100 },
        { entityId: 2, x: 30, y: 40, health: 50 },
      ]),
      pickups: Option.none(),
      decoys: Option.none(),
      safeZone: Option.none(),
    });

    const fromDelta = new SnapshotWorldState();
    fromDelta.apply(full);
    fromDelta.apply(delta);
    const fromFull = new SnapshotWorldState();
    fromFull.apply(equivalent);

    expect(fromDelta.playerEntries()).toEqual(fromFull.playerEntries());
  });

  it("keeps SnapshotDelta application idempotent for repeated identical changes", () => {
    const full = new SnapshotFull({
      players: Option.some([{ entityId: 1, x: 10, y: 20, health: 100 }]),
      pickups: Option.none(),
      decoys: Option.none(),
      safeZone: Option.none(),
    });
    const delta = new SnapshotDelta({
      tick: 2,
      baseTick: 1,
      diff: Option.some([{ entityId: 1, x: 12, health: 90 }]),
    });

    const once = new SnapshotWorldState();
    once.apply(full);
    once.apply(delta);
    const twice = new SnapshotWorldState();
    twice.apply(full);
    twice.apply(delta);
    twice.apply(delta);

    expect(twice.playerEntries()).toEqual(once.playerEntries());
  });
});

describe("wire protocol round-trip parity", () => {
  for (const message of runtimeMessages) {
    it(`round-trips ${message._tag} through the canonical runtime codec`, () => {
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    });
  }
});

describe("plugin hook ordering parity", () => {
  it("dispatches three plugins in insertion order for 60 ticks", async () => {
    const host = makePluginHost();
    const calls: string[] = [];
    for (const id of ["alpha", "bravo", "charlie"]) {
      await Effect.runPromise(host.register({ id, onTick: () => Effect.sync(() => calls.push(id)) }));
    }
    const runtime = makeGameRuntime();
    await Effect.runPromise(runtime.init({ pluginHost: host }));

    await Effect.runPromise(runtime.step(60));

    const expected = Array.from({ length: 60 * 3 }, (_, index) => ["alpha", "bravo", "charlie"][index % 3]!);
    expect(calls).toEqual(expected);
  });
});

const runMovementParity = async (
  events: readonly { readonly tick: number; readonly code: string; readonly pressed: boolean }[],
  ticks: number,
): Promise<{ readonly x: number; readonly y: number }> => {
  const runtime = makeGameRuntime();
  const state = await Effect.runPromise(runtime.init({ tickRate: MOVEMENT_TICK_RATE_HZ }));
  const entity = state.world.createEntity();
  state.world.addComponent(entity, PositionComponent, { x: INITIAL_X, y: INITIAL_Y });
  state.world.addComponent(entity, VelocityComponent, { x: 0, y: 0 });
  for (const event of events) {
    state.input.record(new KeyInputEvent(event));
  }
  await Effect.runPromise(runtime.registerSystem(createPlayerInputMovementSystem()));
  await Effect.runPromise(runtime.step(ticks));

  return Option.getOrThrow(state.world.getComponent(entity, PositionComponent));
};

const runCollisionParity = async (options: {
  readonly initial: { readonly x: number; readonly y: number };
  readonly input: { readonly tick: number; readonly code: string; readonly pressed: boolean };
  readonly environment: CollisionEnvironment;
}): Promise<{ readonly x: number; readonly y: number }> => {
  const runtime = makeGameRuntime();
  const state = await Effect.runPromise(runtime.init({ tickRate: MOVEMENT_TICK_RATE_HZ }));
  const entity = state.world.createEntity();
  state.world.addComponent(entity, PositionComponent, options.initial);
  state.world.addComponent(entity, VelocityComponent, { x: 0, y: 0 });
  state.input.record(new KeyInputEvent(options.input));
  await Effect.runPromise(runtime.registerSystem(createPlayerInputMovementSystem()));
  await Effect.runPromise(
    runtime.registerSystem(
      createCollisionSystem(options.environment, {
        radius: PLAYER_FOOTPRINT_RADIUS,
        offsetY: PLAYER_FOOTPRINT_OFFSET_Y,
      }),
    ),
  );
  await Effect.runPromise(runtime.step(1));

  return Option.getOrThrow(state.world.getComponent(entity, PositionComponent));
};

const collisionEnvironmentFromRect = (
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): CollisionEnvironment => {
  const collisionLayer = buildCollisionLayerFromRects([rect], TILE_SIZE);
  const tileSize = new Size2D({ width: TILE_SIZE, height: TILE_SIZE });
  return CollisionEnvironment.fromCollisionLayer(collisionLayer, tileSize);
};

const runtimeMessages: readonly RuntimeMessage[] = [
  new Welcome({ entityId: "entity-1", slot: 1, mapWidth: 128, mapHeight: 64, snapshotHz: 20, seed: 123 }),
  new ClientReady({}),
  new InputBatch({
    commands: [new InputCommand({ tick: 1, buttons: Button.Up, moveX: 0, moveY: -1, aimX: 10, aimY: 20 })],
  }),
  new SnapshotFull({
    players: Option.some([{ entityId: 1, x: 10, y: 20 }]),
    pickups: Option.some([{ id: 1, active: true }]),
    decoys: Option.some([]),
    safeZone: Option.some({ centerX: 32, centerY: 32, radiusPx: 64 }),
  }),
  new SnapshotDelta({ tick: 2, baseTick: 1, diff: Option.some([{ entityId: 1, x: 11 }]) }),
  new Events({ events: Option.some([{ type: "pickup", entityId: 1 }]) }),
  new Ping({ sentAtMs: Option.some(100) }),
  new Pong({ sentAtMs: Option.some(100) }),
  new Chat({ text: "hello", playerId: Option.some("player-1") }),
  new MatchEnd({ winner: Option.some("player-1"), results: Option.some([{ playerId: "player-1", rank: 1 }]) }),
  new ServerNotice({ message: "Server restart in 60 s" }),
  new PlayerLoadouts({ skinIds: ["skin-a", "skin-b"] }),
];

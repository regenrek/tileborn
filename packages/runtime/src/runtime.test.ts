import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DeterministicClock } from "./clock/deterministic-clock.js";
import {
  defineComponent,
  HealthComponent,
  PositionComponent,
  VelocityComponent,
  type ComponentDefinition,
} from "./ecs/components.js";
import { SystemScheduler, type System } from "./ecs/systems.js";
import { EntityHandleStaleError, World } from "./ecs/world.js";
import { Button, InputBuffer, KeyInputEvent, MouseButtonInputEvent, MouseMoveInputEvent } from "./input/input.js";
import { GameLoop } from "./loop/game-loop.js";
import { GameRuntime, makeGameRuntime } from "./runtime/game-runtime.js";

const components = (...items: readonly ComponentDefinition<object>[]) => items;
const componentValue = <T>(value: Option.Option<T>): T => Option.getOrThrow(value);
const slotIndexOf = (entity: number): number => entity & 0xffff;
const generationOf = (entity: number): number => entity >>> 16;

describe("DeterministicClock", () => {
  it("advances virtual time", () => {
    const clock = new DeterministicClock({ startMs: 10 });
    expect(clock.now()).toBe(10);
    expect(clock.advance(5)).toBe(15);
    expect(clock.now()).toBe(15);
  });

  it("resets virtual time", () => {
    const clock = new DeterministicClock({ startMs: 10 });
    clock.advance(20);
    clock.reset();
    expect(clock.now()).toBe(10);
  });

  it("keeps system time monotonic", () => {
    const values = [5, 3, 8];
    const clock = new DeterministicClock({ mode: "system", now: () => values.shift() ?? 8 });
    expect([clock.now(), clock.now(), clock.now()]).toEqual([5, 5, 8]);
  });

  it("replays seeded random values after reset", () => {
    const clock = new DeterministicClock({ seed: 123 });
    const first = [clock.random(), clock.random()];
    clock.reset();
    expect([clock.random(), clock.random()]).toEqual(first);
  });

  it("produces deterministic RNG streams from matching seeds", () => {
    const first = new DeterministicClock({ seed: 123 });
    const second = new DeterministicClock({ seed: 123 });
    const different = new DeterministicClock({ seed: 456 });
    const firstValues = Array.from({ length: 100 }, () => first.random());
    const secondValues = Array.from({ length: 100 }, () => second.random());
    expect(secondValues).toEqual(firstValues);
    expect(different.random()).not.toBe(firstValues[0]);
  });
});

describe("InputBuffer", () => {
  it("records and consumes events", () => {
    const buffer = new InputBuffer();
    buffer.record(new KeyInputEvent({ tick: 1, code: "KeyW", pressed: true }));
    expect(buffer.consumeEvents()).toHaveLength(1);
  });

  it("clears consumed events between ticks", () => {
    const buffer = new InputBuffer();
    buffer.record(new MouseMoveInputEvent({ tick: 1, x: 10, y: 20 }));
    buffer.consumeEvents();
    expect(buffer.consumeEvents()).toEqual([]);
  });

  it("creates a command from current state", () => {
    const buffer = new InputBuffer();
    buffer.record(new KeyInputEvent({ tick: 1, code: "KeyD", pressed: true }));
    buffer.record(new MouseButtonInputEvent({ tick: 1, button: 0, pressed: true }));
    const command = buffer.commandForTick(2);
    expect(command.moveX).toBe(1);
    expect((command.buttons & Button.Fire) !== 0).toBe(true);
  });
});

describe("GameLoop", () => {
  it("converges fixed steps over 100 ms at 60 Hz", () => {
    let updates = 0;
    const clock = new DeterministicClock();
    const loop = new GameLoop({ clock, update: () => updates++ });
    loop.start();
    clock.advance(100);
    loop.runFrame();
    expect(updates).toBe(5);
    clock.advance(1);
    loop.runFrame();
    expect(updates).toBe(6);
  });

  it("pauses and resumes", () => {
    let updates = 0;
    const clock = new DeterministicClock();
    const loop = new GameLoop({ clock, update: () => updates++ });
    loop.start();
    loop.pause();
    clock.advance(100);
    loop.runFrame();
    expect(updates).toBe(0);
    loop.resume();
    clock.advance(17);
    loop.runFrame();
    expect(updates).toBe(1);
  });

  it("manual step advances one tick", () => {
    const ticks: number[] = [];
    const loop = new GameLoop({ update: (_dt, tick) => ticks.push(tick) });
    expect(loop.step(1)).toBe(1);
    expect(ticks).toEqual([1]);
  });

  it("caps catch-up work after a large frame", () => {
    let updates = 0;
    const clock = new DeterministicClock();
    const loop = new GameLoop({ clock, maxCatchupTicks: 5, update: () => updates++ });
    loop.start();
    clock.advance(loop.stepMs * 100);
    const result = loop.runFrame();
    expect(result.updates).toBe(5);
    expect(updates).toBe(5);
    expect(result.alpha).toBeLessThanOrEqual(loop.maxCatchupTicks);
  });

  it("renders the partial tick alpha", () => {
    const alphas: number[] = [];
    const clock = new DeterministicClock();
    const loop = new GameLoop({ clock, update: () => undefined, render: (alpha) => alphas.push(alpha) });
    loop.start();
    clock.advance(loop.stepMs * 0.7);
    loop.runFrame();
    expect(alphas.at(-1)).toBeCloseTo(0.7);
  });

  it("keeps 60 Hz ticks deterministic over 10000 milliseconds", () => {
    let updates = 0;
    const clock = new DeterministicClock();
    const loop = new GameLoop({ clock, update: () => updates++ });
    loop.start();
    for (let index = 0; index < 10_000; index += 1) {
      clock.advance(1);
      loop.runFrame();
    }
    expect(updates).toBe(600);
    expect(loop.tick).toBe(600);
    expect(loop.runFrame().alpha).toBeCloseTo(0);
  });
});

describe("World", () => {
  it("creates and destroys entities", () => {
    const world = new World();
    const entity = world.createEntity();
    expect(world.hasEntity(entity)).toBe(true);
    world.destroyEntity(entity);
    expect(world.hasEntity(entity)).toBe(false);
  });

  it("adds and removes components", () => {
    const world = new World();
    const entity = world.createEntity();
    world.addComponent(entity, PositionComponent, { x: 3 });
    expect(componentValue(world.getComponent(entity, PositionComponent)).x).toBe(3);
    expect(world.hasComponent(entity, PositionComponent)).toBe(true);
    world.removeComponent(entity, PositionComponent);
    expect(Option.isNone(world.getComponent(entity, PositionComponent))).toBe(true);
  });

  it("queries expected entities", () => {
    const world = new World();
    const moving = world.createEntity();
    const staticEntity = world.createEntity();
    world.addComponent(moving, PositionComponent);
    world.addComponent(moving, VelocityComponent);
    world.addComponent(staticEntity, PositionComponent);
    const queried: unknown[] = [];
    world.query(components(PositionComponent, VelocityComponent), (entity) => queried.push(entity));
    expect(queried).toEqual([moving]);
  });

  it("keeps query results stable across ticks", () => {
    const world = new World();
    const first = world.createEntity();
    const second = world.createEntity();
    world.addComponent(second, PositionComponent);
    world.addComponent(first, PositionComponent);
    const query = () => {
      const queried: unknown[] = [];
      world.query(components(PositionComponent), (entity) => queried.push(entity));
      return queried;
    };
    expect(query()).toEqual([first, second]);
    expect(query()).toEqual([first, second]);
  });

  it("rejects stale handles when a slot is reused", () => {
    const world = new World();
    const original = world.createEntity();
    world.addComponent(original, PositionComponent, { x: 1 });
    world.destroyEntity(original);
    const replacement = world.createEntity();
    expect(replacement).not.toBe(original);
    expect((replacement as number) & 0xffff).toBe((original as number) & 0xffff);
    expect(Option.isNone(world.getComponent(original, PositionComponent))).toBe(true);
    expect(() => world.addComponent(original, PositionComponent)).toThrow(
      new EntityHandleStaleError({
        slotIndex: (original as number) & 0xffff,
        expectedGeneration: (replacement as number) >>> 16,
        actualGeneration: (original as number) >>> 16,
      }),
    );
  });

  it("retires a slot when its 16-bit generation is exhausted", () => {
    const world = new World(1);
    const original = world.createEntity();
    let entity = original;
    for (let index = 0; index < 0xffff; index += 1) {
      world.destroyEntity(entity);
      entity = world.createEntity();
    }
    expect((entity as number) & 0xffff).toBe(1);
    expect(Option.isNone(world.getComponent(original, PositionComponent))).toBe(true);
  });

  it("queries component masks beyond 32 registered component types", () => {
    const world = new World();
    const definitions = Array.from({ length: 40 }, (_, index) =>
      defineComponent(
        `Dummy${index}`,
        Schema.Struct({ value: Schema.Number }),
        { value: "i32" },
        () => ({ value: 0 }),
      ),
    );
    const entity = world.createEntity();
    for (const [index, definition] of definitions.entries()) {
      world.addComponent(entity, definition, { value: index });
    }
    let matches = 0;
    world.query([definitions[0], definitions[39]], (_entity, first, last) => {
      matches += 1;
      expect(first.value).toBe(0);
      expect(last.value).toBe(39);
    });
    expect(matches).toBe(1);
  });

  it("continues query iteration while current entities are destroyed", () => {
    const world = new World();
    for (let index = 0; index < 100; index += 1) {
      const entity = world.createEntity();
      world.addComponent(entity, PositionComponent, { x: index });
    }
    let visited = 0;
    world.query(components(PositionComponent), (entity) => {
      if (visited % 3 === 0) {
        world.destroyEntity(entity);
      }
      visited += 1;
    });
    let remaining = 0;
    world.query(components(PositionComponent), () => {
      remaining += 1;
    });
    expect(visited).toBe(100);
    expect(remaining).toBe(66);
  });

  it("rejects stale query view mutation after the entity is destroyed outside the callback", () => {
    const world = new World();
    const entity = world.createEntity();
    world.addComponent(entity, PositionComponent, { x: 1, y: 2 });
    let captured: { x: number; y: number } | undefined;

    world.query(components(PositionComponent), (_entity, position) => {
      captured = position;
    });

    world.destroyEntity(entity);
    expect(() => {
      captured!.x = 5;
    }).toThrow(
      new EntityHandleStaleError({
        slotIndex: slotIndexOf(entity as number),
        expectedGeneration: generationOf(entity as number) + 1,
        actualGeneration: generationOf(entity as number),
      }),
    );
  });

  it("rejects stale query view mutation after destroying the current entity inside the callback", () => {
    const world = new World();
    const entity = world.createEntity();
    world.addComponent(entity, PositionComponent, { x: 1, y: 2 });

    world.query(components(PositionComponent), (current, position) => {
      world.destroyEntity(current);
      expect(() => {
        position.x = 1;
      }).toThrow(
        new EntityHandleStaleError({
          slotIndex: slotIndexOf(entity as number),
          expectedGeneration: generationOf(entity as number) + 1,
          actualGeneration: generationOf(entity as number),
        }),
      );
    });
  });

  it("rejects stale query view mutation after slot recycling", () => {
    const world = new World();
    const original = world.createEntity();
    world.addComponent(original, PositionComponent, { x: 1, y: 2 });
    let captured: { x: number; y: number } | undefined;
    world.query(components(PositionComponent), (_entity, position) => {
      captured = position;
    });

    world.destroyEntity(original);
    const replacement = world.createEntity();
    world.addComponent(replacement, PositionComponent, { x: 99, y: 100 });

    expect(slotIndexOf(replacement as number)).toBe(slotIndexOf(original as number));
    expect(() => {
      captured!.x = 7;
    }).toThrow(
      new EntityHandleStaleError({
        slotIndex: slotIndexOf(original as number),
        expectedGeneration: generationOf(replacement as number),
        actualGeneration: generationOf(original as number),
      }),
    );
    expect(componentValue(world.getComponent(replacement, PositionComponent)).x).toBe(99);
  });

  it("reuses query component view identities while reading each entity's current values", () => {
    const world = new World();
    for (let index = 0; index < 100; index += 1) {
      const entity = world.createEntity();
      world.addComponent(entity, PositionComponent, { x: index, y: index + 1 });
      world.addComponent(entity, VelocityComponent, { x: index * 10, y: index * 10 + 1 });
    }

    let firstPosition: { x: number; y: number } | undefined;
    let firstVelocity: { x: number; y: number } | undefined;
    let visited = 0;
    world.query(components(PositionComponent, VelocityComponent), (_entity, position, velocity) => {
      firstPosition ??= position;
      firstVelocity ??= velocity;
      expect(position).toBe(firstPosition);
      expect(velocity).toBe(firstVelocity);
      expect(position.x).toBe(visited);
      expect(position.y).toBe(visited + 1);
      expect(velocity.x).toBe(visited * 10);
      expect(velocity.y).toBe(visited * 10 + 1);
      visited += 1;
    });

    expect(visited).toBe(100);
  });

  it("grows capacity while keeping entity ids and component columns intact", () => {
    const world = new World();
    const entities = Array.from({ length: 1500 }, (_, index) => {
      const entity = world.createEntity();
      world.addComponent(entity, PositionComponent, { x: index, y: index * 2 });
      return entity;
    });
    for (const [index, entity] of entities.entries()) {
      expect(world.hasEntity(entity)).toBe(true);
      const position = componentValue(world.getComponent(entity, PositionComponent));
      expect(position.x).toBe(index);
      expect(position.y).toBe(index * 2);
    }
  });
});

describe("SystemScheduler", () => {
  it("orders dependencies before dependents", () => {
    const scheduler = new SystemScheduler();
    scheduler.add(system("render", ["move"]));
    scheduler.add(system("move"));
    expect(scheduler.ordered().map((entry) => entry.name)).toEqual(["move", "render"]);
  });

  it("keeps insertion order without dependencies", () => {
    const scheduler = new SystemScheduler();
    scheduler.add(system("a"));
    scheduler.add(system("b"));
    expect(scheduler.ordered().map((entry) => entry.name)).toEqual(["a", "b"]);
  });
});

describe("GameRuntime", () => {
  it("updates position by velocity end-to-end", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const runtime = yield* GameRuntime;
        const state = yield* runtime.init();
        const entity = state.world.createEntity();
        state.world.addComponent(entity, PositionComponent);
        state.world.addComponent(entity, VelocityComponent, { x: 60, y: 0 });
        yield* runtime.registerSystem({
          name: "movement",
          query: components(PositionComponent, VelocityComponent),
          update: (world, dt) => {
            world.query(components(PositionComponent, VelocityComponent), (_moving, position, velocity) => {
              position.x += velocity.x * dt;
              position.y += velocity.y * dt;
            });
          },
        });
        yield* runtime.step(10);
        expect(componentValue(state.world.getComponent(entity, PositionComponent)).x).toBeCloseTo(10);
      }).pipe(Effect.provide(GameRuntime.layer)),
    );
  });

  it("factory exposes lifecycle without a layer", async () => {
    const runtime = makeGameRuntime();
    const state = await Effect.runPromise(runtime.init({ tickRate: 30 }));
    await Effect.runPromise(runtime.start());
    state.clock.advance(34);
    expect(state.loop.runFrame().updates).toBe(1);
  });
});

const system = (name: string, dependsOn?: readonly string[]): System => ({
  name,
  dependsOn,
  query: components(HealthComponent),
  update: () => undefined,
});

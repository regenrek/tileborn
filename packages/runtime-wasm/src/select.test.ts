import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createTsBroadphaseBackend,
  createTsPathfindingBackend,
  createTsProcgenBackend,
  createTsSimulationBackend,
} from "./backends.js";
import { WasmBackendUnavailableError } from "./errors.js";
import { readBackendImplFromEnv, selectBackend } from "./select.js";

describe("runtime backend factories", () => {
  it("exposes deterministic metadata on TS backends", () => {
    const backend = createTsPathfindingBackend(5);
    expect(backend.metadata).toEqual({
      kind: "pathfinding",
      impl: "ts",
      version: "0.1.0-ts",
      seed: 5n,
    });
    backend.dispose();
  });

  it("creates independent procgen streams per seed", () => {
    const first = createTsProcgenBackend(1);
    const second = createTsProcgenBackend(2);
    expect(first.rng.nextUint32()).not.toBe(second.rng.nextUint32());
    first.dispose();
    second.dispose();
  });

  it("simulation backend delegates to runSimulationTick", async () => {
    const backend = createTsSimulationBackend();
    const events = await Effect.runPromise(backend.tick({ tick: 1, deltaSeconds: 0.5 }));
    expect(events[0]?.kind).toBe("tick");
    backend.dispose();
  });

  it("broadphase backend returns stable pair ordering", async () => {
    const backend = createTsBroadphaseBackend();
    const pairs = await Effect.runPromise(
      backend.findPairs([
        { id: { value: 2 }, minX: 0, minY: 0, maxX: 2, maxY: 2 },
        { id: { value: 1 }, minX: 1, minY: 1, maxX: 3, maxY: 3 },
      ]),
    );
    expect(pairs).toEqual([{ a: { value: 1 }, b: { value: 2 } }]);
    backend.dispose();
  });
});

describe("selectBackend", () => {
  it("defaults to TS implementations", async () => {
    const backend = await Effect.runPromise(selectBackend("pathfinding"));
    expect(backend.metadata.impl).toBe("ts");
    backend.dispose();
  });

  it("throws WasmBackendUnavailableError when wasm is requested", async () => {
    await expect(
      Effect.runPromise(selectBackend("procgen", { impl: "wasm", seed: 1 })),
    ).rejects.toBeInstanceOf(WasmBackendUnavailableError);
  });

  it("reads TILEBORNE_RT_BACKEND from env", () => {
    expect(readBackendImplFromEnv({ TILEBORNE_RT_BACKEND: "wasm" })).toBe("wasm");
    expect(readBackendImplFromEnv({})).toBe("ts");
  });
});

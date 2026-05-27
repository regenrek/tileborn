import { Effect } from "effect";

import { findBroadphasePairs, type Aabb, type BroadphasePair } from "./broadphase/sweep-prune.js";
import { WasmBackendUnavailableError } from "./errors.js";
import { findPathOnGrid, type GridPoint, type HeuristicMode, type PathfindingGrid, type PathfindingRequest } from "./pathfinding/astar.js";
import { createProcgenRng, type ProcgenRng } from "./procgen/rng.js";
import { runSimulationTick, type SimulationEvent, type SimulationTickRequest } from "./simulation/sim.js";

export type BackendKind = "pathfinding" | "broadphase" | "procgen" | "simulation";
export type BackendImpl = "ts" | "wasm";

export interface BackendMetadata {
  readonly kind: BackendKind;
  readonly impl: BackendImpl;
  readonly version: string;
  readonly seed: bigint;
}

export interface DisposableBackend {
  readonly metadata: BackendMetadata;
  dispose(): void;
}

export interface PathfindingBackend extends DisposableBackend {
  readonly findPath: (
    request: PathfindingRequest,
  ) => Effect.Effect<readonly GridPoint[], import("./errors.js").PathfindingError>;
}

export interface BroadphaseBackend extends DisposableBackend {
  readonly findPairs: (
    boxes: readonly Aabb[],
  ) => Effect.Effect<readonly BroadphasePair[], import("./errors.js").BroadphaseError>;
}

export interface ProcgenBackend extends DisposableBackend {
  readonly rng: ProcgenRng;
}

export interface SimulationBackend extends DisposableBackend {
  readonly tick: (
    request: SimulationTickRequest,
  ) => Effect.Effect<readonly SimulationEvent[], import("./errors.js").SimulationError>;
}

export type RuntimeBackend = PathfindingBackend | BroadphaseBackend | ProcgenBackend | SimulationBackend;

const BACKEND_VERSION = "0.1.0-ts";

const makeMetadata = (kind: BackendKind, seed: bigint): BackendMetadata => ({
  kind,
  impl: "ts",
  version: BACKEND_VERSION,
  seed,
});

export const createTsPathfindingBackend = (seed: bigint | number = 0n): PathfindingBackend => {
  const metadata = makeMetadata("pathfinding", typeof seed === "number" ? BigInt(seed) : seed);
  return {
    metadata,
    findPath: (request) => findPathOnGrid(request),
    dispose: () => undefined,
  };
};

export const createTsBroadphaseBackend = (seed: bigint | number = 0n): BroadphaseBackend => {
  const metadata = makeMetadata("broadphase", typeof seed === "number" ? BigInt(seed) : seed);
  return {
    metadata,
    findPairs: (boxes) => findBroadphasePairs(boxes),
    dispose: () => undefined,
  };
};

export const createTsProcgenBackend = (seed: bigint | number): ProcgenBackend => {
  const normalizedSeed = typeof seed === "number" ? BigInt(seed) : seed;
  const metadata = makeMetadata("procgen", normalizedSeed);
  const rng = createProcgenRng(normalizedSeed);
  return {
    metadata,
    rng,
    dispose: () => undefined,
  };
};

export const createTsSimulationBackend = (seed: bigint | number = 0n): SimulationBackend => {
  const metadata = makeMetadata("simulation", typeof seed === "number" ? BigInt(seed) : seed);
  return {
    metadata,
    tick: (request) => runSimulationTick(request),
    dispose: () => undefined,
  };
};

export const wasmBindingsAvailable = (): boolean => false;

export const wasmBackendUnavailable = (backend: BackendKind): Effect.Effect<never, WasmBackendUnavailableError> =>
  Effect.fail(
    new WasmBackendUnavailableError({
      backend,
      message:
        `TILEBORNE_RT_BACKEND=wasm was requested for ${backend}, but wasm bindings are not built. ` +
        "Implement the Rust crates under packages/runtime-wasm/crates/ and wire wasm-bindgen exports.",
    }),
  );

export type {
  Aabb,
  BroadphasePair,
  GridPoint,
  HeuristicMode,
  PathfindingGrid,
  PathfindingRequest,
  ProcgenRng,
  SimulationEvent,
  SimulationTickRequest,
};

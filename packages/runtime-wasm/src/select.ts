import { Effect } from "effect";

import {
  createTsBroadphaseBackend,
  createTsPathfindingBackend,
  createTsProcgenBackend,
  createTsSimulationBackend,
  type BackendImpl,
  type BackendKind,
  type BroadphaseBackend,
  type PathfindingBackend,
  type ProcgenBackend,
  type RuntimeBackend,
  type SimulationBackend,
  wasmBackendUnavailable,
  wasmBindingsAvailable,
} from "./backends.js";

export interface BackendSelectionConfig {
  readonly impl?: BackendImpl;
  readonly seed?: bigint | number;
}

export const readBackendImplFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): BackendImpl => (env.TILEBORNE_RT_BACKEND === "wasm" ? "wasm" : "ts");

const resolveImpl = (config: BackendSelectionConfig | undefined): BackendImpl =>
  config?.impl ?? readBackendImplFromEnv();

const resolveSeed = (config: BackendSelectionConfig | undefined): bigint | number => config?.seed ?? 0n;

const ensureAvailable = (kind: BackendKind, impl: BackendImpl): Effect.Effect<void, import("./errors.js").WasmBackendUnavailableError> =>
  impl === "wasm" && !wasmBindingsAvailable() ? wasmBackendUnavailable(kind) : Effect.succeed(void 0);

export const selectPathfindingBackend = (
  config?: BackendSelectionConfig,
): Effect.Effect<PathfindingBackend, import("./errors.js").WasmBackendUnavailableError> =>
  Effect.gen(function* () {
    const impl = resolveImpl(config);
    yield* ensureAvailable("pathfinding", impl);
    return createTsPathfindingBackend(resolveSeed(config));
  });

export const selectBroadphaseBackend = (
  config?: BackendSelectionConfig,
): Effect.Effect<BroadphaseBackend, import("./errors.js").WasmBackendUnavailableError> =>
  Effect.gen(function* () {
    const impl = resolveImpl(config);
    yield* ensureAvailable("broadphase", impl);
    return createTsBroadphaseBackend(resolveSeed(config));
  });

export const selectProcgenBackend = (
  config?: BackendSelectionConfig,
): Effect.Effect<ProcgenBackend, import("./errors.js").WasmBackendUnavailableError> =>
  Effect.gen(function* () {
    const impl = resolveImpl(config);
    yield* ensureAvailable("procgen", impl);
    return createTsProcgenBackend(resolveSeed(config));
  });

export const selectSimulationBackend = (
  config?: BackendSelectionConfig,
): Effect.Effect<SimulationBackend, import("./errors.js").WasmBackendUnavailableError> =>
  Effect.gen(function* () {
    const impl = resolveImpl(config);
    yield* ensureAvailable("simulation", impl);
    return createTsSimulationBackend(resolveSeed(config));
  });

export const selectBackend = (
  kind: BackendKind,
  config?: BackendSelectionConfig,
): Effect.Effect<RuntimeBackend, import("./errors.js").WasmBackendUnavailableError> => {
  switch (kind) {
    case "pathfinding":
      return selectPathfindingBackend(config);
    case "broadphase":
      return selectBroadphaseBackend(config);
    case "procgen":
      return selectProcgenBackend(config);
    case "simulation":
      return selectSimulationBackend(config);
  }
};

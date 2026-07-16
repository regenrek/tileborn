import { Schema } from 'effect';

/** Raised when a grid coordinate is out of bounds or blocked. */
export class PathfindingInputError extends Schema.TaggedErrorClass<PathfindingInputError>()(
  'PathfindingInputError',
  {
    message: Schema.String,
  },
) {}

/** Raised when no route exists between start and goal. */
export class PathNotFoundError extends Schema.TaggedErrorClass<PathNotFoundError>()(
  'PathNotFoundError',
  {
    message: Schema.String,
  },
) {}

/** Raised when broadphase input is invalid. */
export class BroadphaseInputError extends Schema.TaggedErrorClass<BroadphaseInputError>()(
  'BroadphaseInputError',
  {
    message: Schema.String,
  },
) {}

/** Raised when procgen RNG receives invalid parameters. */
export class ProcgenInputError extends Schema.TaggedErrorClass<ProcgenInputError>()(
  'ProcgenInputError',
  {
    message: Schema.String,
  },
) {}

/** Raised when simulation tick input is invalid. */
export class SimulationInputError extends Schema.TaggedErrorClass<SimulationInputError>()(
  'SimulationInputError',
  {
    message: Schema.String,
  },
) {}

/** Raised when TILEBORNE_RT_BACKEND=wasm but Rust/wasm bindings are not built. */
export class WasmBackendUnavailableError extends Schema.TaggedErrorClass<WasmBackendUnavailableError>()(
  'WasmBackendUnavailableError',
  {
    backend: Schema.String,
    message: Schema.String,
  },
) {}

export type PathfindingError = PathfindingInputError | PathNotFoundError;
export type BroadphaseError = BroadphaseInputError;
export type ProcgenError = ProcgenInputError;
export type SimulationError = SimulationInputError;
export type RuntimeWasmError =
  | PathfindingError
  | BroadphaseError
  | ProcgenError
  | SimulationError
  | WasmBackendUnavailableError;

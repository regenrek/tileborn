import { Effect, ManagedRuntime } from "effect";

import { AppLayer } from "./app-layer.js";

export const appRuntime = ManagedRuntime.make(AppLayer);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const runEffect = <A, E>(effect: Effect.Effect<A, E, any>) => appRuntime.runPromise(effect);

/**
 * Dispose the managed runtime via its Promise API.
 *
 * `ManagedRuntime.dispose()` runs the layer finalizers on a fiber that is NOT
 * registered in the runtime's own scope, so closing that scope does not
 * interrupt the disposing fiber itself. Disposing from inside an effect run via
 * `runEffect`/`appRuntime.runPromise` (the previous `yield* appRuntime.disposeEffect`
 * approach) made the runtime interrupt its own shutdown fiber, which surfaced as
 * `Error: All fibers interrupted without error` and failed every quit (t-wk7b).
 */
export const disposeRuntime = (): Promise<void> => appRuntime.dispose();

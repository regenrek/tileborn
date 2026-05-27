import { Effect, ManagedRuntime } from "effect";

import { AppLayer } from "./app-layer.js";

export const appRuntime = ManagedRuntime.make(AppLayer);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const runEffect = <A, E>(effect: Effect.Effect<A, E, any>) => appRuntime.runPromise(effect);

export const disposeRuntime = appRuntime.disposeEffect;

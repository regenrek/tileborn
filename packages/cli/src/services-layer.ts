import { AppServicesLayer } from "@tileborne/services-app";
import { ServicesBuildLayer } from "@tileborne/services-build";
import { PluginInstallerLayer } from "@tileborne/services-plugin";
import { Effect, Fiber, Layer, ManagedRuntime } from "effect";

const CliServicesLayer = Layer.mergeAll(
  AppServicesLayer,
  ServicesBuildLayer,
  PluginInstallerLayer,
);

const makeRuntime = () => ManagedRuntime.make(CliServicesLayer);

let runtime: ReturnType<typeof makeRuntime> | undefined;
let activeFiber: Fiber.Fiber<unknown, unknown> | undefined;

export const getCliRuntime = () => {
  runtime ??= makeRuntime();
  return runtime;
};

export const runCliEffect = async <A, E>(
  effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<ReturnType<typeof getCliRuntime>>>,
): Promise<A> => {
  const rt = getCliRuntime();
  const fiber = rt.runFork(effect);
  activeFiber = fiber;
  try {
    return await rt.runPromise(Fiber.join(fiber));
  } finally {
    activeFiber = undefined;
  }
};

export const cancelActiveCliWork = (): void => {
  if (activeFiber) {
    Effect.runFork(Fiber.interrupt(activeFiber));
    activeFiber = undefined;
  }
};

export const disposeCliRuntime = async (): Promise<void> => {
  cancelActiveCliWork();
  if (runtime) {
    await runtime.dispose();
    runtime = undefined;
  }
};

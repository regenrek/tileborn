import { Cause, Context, Effect, Layer } from "effect";

import type { World } from "../ecs/world.js";
import type { RuntimeMessage } from "../net/protocol.js";
import type {
  RuntimePlugin,
  RuntimePluginContext,
  RuntimePluginExecutable,
  RuntimePluginLoader,
} from "./runtime-plugin.js";

export interface RuntimePluginLogger {
  readonly error: (message: string, fields?: Readonly<Record<string, unknown>>) => Effect.Effect<void>;
}

export interface PluginHostOptions {
  readonly logger?: RuntimePluginLogger;
  readonly loader?: RuntimePluginLoader;
}

export interface PluginHostApi {
  readonly register: (plugin: RuntimePlugin) => Effect.Effect<void>;
  readonly loadAndRegister: (pluginId: string) => Effect.Effect<RuntimePlugin, unknown>;
  readonly plugins: () => Effect.Effect<readonly RuntimePlugin[]>;
  readonly dispatchInit: () => Effect.Effect<void>;
  readonly dispatchTick: (world: World, dt: number, tick: number) => Effect.Effect<void>;
  readonly dispatchMessage: (message: RuntimeMessage) => Effect.Effect<void>;
  readonly dispatchShutdown: () => Effect.Effect<void>;
}

export class PluginHost extends Context.Service<PluginHost, PluginHostApi>()("@tileborne/runtime/PluginHost") {
  static readonly layer = Layer.sync(PluginHost, () => makePluginHost());
}

const defaultLogger: RuntimePluginLogger = {
  error: (message, fields) => Effect.logError(message, fields ?? {}),
};

const normalizeExecutablePlugin = (
  pluginId: string,
  executable: RuntimePlugin | RuntimePluginExecutable,
): RuntimePlugin => {
  if ("id" in executable) {
    return executable;
  }
  const plugin = executable.plugin ?? executable.default;
  if (!plugin) {
    throw new Error(`executable plugin ${pluginId} did not export a runtime plugin`);
  }
  return plugin;
};

export const makePluginHost = (options: PluginHostOptions = {}): PluginHostApi => {
  const plugins: RuntimePlugin[] = [];
  const logger = options.logger ?? defaultLogger;

  const runHook = (
    plugin: RuntimePlugin,
    hookName: keyof Pick<RuntimePlugin, "onInit" | "onTick" | "onMessage" | "onShutdown">,
    effect: Effect.Effect<void, unknown> | undefined,
  ): Effect.Effect<void> => {
    if (!effect) {
      return Effect.succeed(void 0);
    }
    return effect.pipe(
      Effect.catchCause((cause) =>
        logger.error("runtime plugin hook failed", {
          pluginId: plugin.id,
          hook: hookName,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  };

  const dispatch = (
    hookName: keyof Pick<RuntimePlugin, "onInit" | "onTick" | "onMessage" | "onShutdown">,
    run: (plugin: RuntimePlugin) => Effect.Effect<void, unknown> | undefined,
  ): Effect.Effect<void> =>
    Effect.forEach(
      plugins,
      (plugin) => runHook(plugin, hookName, run(plugin)),
      { discard: true },
    );

  return {
    register: (plugin) =>
      Effect.sync(() => {
        plugins.push(plugin);
      }),
    loadAndRegister: (pluginId) =>
      Effect.gen(function* () {
        if (!options.loader) {
          throw new Error("runtime plugin loader is not configured");
        }
        const executable = yield* options.loader.loadExecutable(pluginId);
        const plugin = normalizeExecutablePlugin(pluginId, executable);
        plugins.push(plugin);
        return plugin;
      }),
    plugins: () => Effect.sync(() => [...plugins]),
    dispatchInit: () =>
      dispatch("onInit", (plugin) => {
        const ctx: RuntimePluginContext = { pluginId: plugin.id };
        return plugin.onInit?.(ctx);
      }),
    dispatchTick: (world, dt, tick) => dispatch("onTick", (plugin) => plugin.onTick?.(world, dt, tick)),
    dispatchMessage: (message) => dispatch("onMessage", (plugin) => plugin.onMessage?.(message)),
    dispatchShutdown: () => dispatch("onShutdown", (plugin) => plugin.onShutdown?.()),
  };
};

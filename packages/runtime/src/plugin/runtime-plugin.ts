import type { Effect } from 'effect';

import type { World } from '../ecs/world.js';
import type { RuntimeMessage } from '../net/protocol.js';

export interface RuntimePluginContext {
  readonly pluginId: string;
}

export interface RuntimePlugin {
  readonly id: string;
  readonly onInit?: (ctx: RuntimePluginContext) => Effect.Effect<void, unknown>;
  readonly onTick?: (world: World, dt: number, tick: number) => Effect.Effect<void, unknown>;
  readonly onMessage?: (message: RuntimeMessage) => Effect.Effect<void, unknown>;
  readonly onShutdown?: () => Effect.Effect<void, unknown>;
}

export interface RuntimePluginExecutable {
  readonly default?: RuntimePlugin;
  readonly plugin?: RuntimePlugin;
}

export interface RuntimePluginLoader {
  readonly loadExecutable: (
    pluginId: string,
  ) => Effect.Effect<RuntimePlugin | RuntimePluginExecutable, unknown>;
}

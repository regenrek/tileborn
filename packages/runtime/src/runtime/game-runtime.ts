import { Context, Effect, Layer, Stream } from 'effect';

import { DeterministicClock } from '../clock/deterministic-clock.js';
import { World } from '../ecs/world.js';
import { InputBuffer } from '../input/input.js';
import { GameLoop, type GameLoopOptions } from '../loop/game-loop.js';
import { SystemScheduler, type System, type SystemContext } from '../ecs/systems.js';
import type { RuntimeAssetManifest } from '../assets/runtime-asset-loader.js';
import type { NetClient } from '../net/client.js';
import type { RuntimeTransportError } from '../net/transport.js';
import type { TransportError } from '../net/protocol.js';
import type { PluginHostApi } from '../plugin/plugin-host.js';
import {
  capturePreviousPositions,
  rendererAssetError,
  rendererInitError,
  type RendererAdapter,
  type RendererError,
} from '../renderer/renderer-adapter.js';

export interface GameRuntimeConfig {
  readonly tickRate?: number;
  readonly maxCatchupTicks?: number;
  readonly clock?: DeterministicClock;
  readonly renderer?: RendererAdapter;
  readonly rendererContainer?: unknown;
  readonly assetManifest?: RuntimeAssetManifest;
  readonly netClient?: NetClient;
  readonly netUrl?: string;
  readonly pluginHost?: PluginHostApi;
}

export interface GameRuntimeState {
  readonly clock: DeterministicClock;
  readonly input: InputBuffer;
  readonly loop: GameLoop;
  readonly renderer?: RendererAdapter;
  readonly world: World;
  readonly systems: SystemScheduler;
  readonly netClient?: NetClient;
  readonly pluginHost?: PluginHostApi;
}

export interface GameRuntimeApi {
  readonly init: (
    config?: GameRuntimeConfig,
  ) => Effect.Effect<GameRuntimeState, RendererError | RuntimeTransportError>;
  readonly registerSystem: (system: System) => Effect.Effect<void>;
  readonly start: () => Effect.Effect<void>;
  readonly pause: () => Effect.Effect<void>;
  readonly step: (ticks?: number) => Effect.Effect<number>;
  readonly restoreTick: (tick: number) => Effect.Effect<number>;
  readonly resume: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void, RendererError | TransportError>;
  readonly state: () => Effect.Effect<GameRuntimeState>;
}

export class GameRuntime extends Context.Service<GameRuntime, GameRuntimeApi>()(
  '@tileborne/runtime/GameRuntime',
) {
  static readonly layer = Layer.sync(GameRuntime, () => makeGameRuntime());
}

export const makeGameRuntime = (): GameRuntimeApi => {
  let runtimeState: GameRuntimeState | undefined;

  const ensureState = (): GameRuntimeState => {
    if (!runtimeState) {
      throw new Error('runtime is not initialized');
    }
    return runtimeState;
  };

  const init = (config: GameRuntimeConfig = {}) =>
    Effect.gen(function* () {
      const clock = config.clock ?? new DeterministicClock();
      const world = new World();
      const input = new InputBuffer();
      const systems = new SystemScheduler();
      const renderer = config.renderer;
      const netClient = config.netClient;
      const pluginHost = config.pluginHost;

      if (renderer && config.rendererContainer === undefined) {
        yield* rendererInitError('rendererContainer is required when renderer is configured');
      }
      if (renderer && config.assetManifest === undefined) {
        yield* rendererAssetError(
          '<missing>',
          'assetManifest is required when renderer is configured',
        );
      }

      const loopOptions: GameLoopOptions = {
        clock,
        update: (dt, tick) => {
          if (renderer) {
            capturePreviousPositions(world);
          }
          const context: SystemContext = { tick, input: input.commandForTick(tick) };
          systems.update(world, dt, context);
          if (pluginHost) {
            Effect.runSync(pluginHost.dispatchTick(world, dt, tick));
          }
        },
        ...(renderer === undefined
          ? {}
          : {
              render: (alpha: number) => {
                Effect.runSync(renderer.renderFrame(world, alpha));
              },
            }),
        ...(config.tickRate === undefined ? {} : { tickRate: config.tickRate }),
        ...(config.maxCatchupTicks === undefined
          ? {}
          : { maxCatchupTicks: config.maxCatchupTicks }),
      };
      const loop = new GameLoop(loopOptions);
      runtimeState = {
        clock,
        input,
        loop,
        world,
        systems,
        ...(renderer === undefined ? {} : { renderer }),
        ...(netClient === undefined ? {} : { netClient }),
        ...(pluginHost === undefined ? {} : { pluginHost }),
      };

      if (renderer) {
        yield* renderer.mount(config.rendererContainer);
        yield* renderer.loadAssets(config.assetManifest as RuntimeAssetManifest);
      }
      if (pluginHost) {
        yield* pluginHost.dispatchInit();
      }
      if (netClient && config.netUrl !== undefined) {
        yield* netClient.connect(config.netUrl);
        Effect.runFork(
          netClient
            .receive()
            .pipe(
              Stream.runForEach((message) =>
                pluginHost ? pluginHost.dispatchMessage(message) : Effect.succeed(void 0),
              ),
            ),
        );
      }

      return runtimeState;
    });

  return {
    init,
    registerSystem: (system: System) =>
      Effect.sync(() => {
        ensureState().systems.add(system);
      }),
    start: () =>
      Effect.sync(() => {
        ensureState().loop.start();
      }),
    pause: () =>
      Effect.sync(() => {
        ensureState().loop.pause();
      }),
    step: (ticks = 1) =>
      Effect.sync(() => {
        return ensureState().loop.step(ticks);
      }),
    restoreTick: (tick) =>
      Effect.sync(() => {
        return ensureState().loop.restoreTick(tick);
      }),
    resume: () =>
      Effect.sync(() => {
        ensureState().loop.resume();
      }),
    stop: () =>
      Effect.gen(function* () {
        const state = ensureState();
        state.loop.stop();
        if (state.pluginHost) {
          yield* state.pluginHost.dispatchShutdown();
        }
        if (state.netClient) {
          yield* state.netClient.close();
        }
        if (state.renderer) {
          yield* state.renderer.dispose();
        }
      }),
    state: () =>
      Effect.sync(() => {
        return ensureState();
      }),
  };
};

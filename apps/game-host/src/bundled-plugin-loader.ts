import { Effect } from "effect";

import type { RuntimePlugin, RuntimePluginLoader } from "@tileborne/runtime/worker";

import { bundledPlugin } from "./.generated/bundled-plugin.js";
import {
  createRuntimeAdapter,
  decodeClientFrame,
  decodeServerLifecycleFrame,
  encodeInvalidClientFrame,
  type RuntimeClientFrameDecodeResult,
  type RuntimeClientFrameView,
  type RuntimeClientInputFrame,
} from "./.generated/plugin-runtime.js";
import { bundledMapPackages } from "./.generated/bundled-map-packages.js";

interface BundledComponentStore<T extends object> {
  readonly get: (entity: number) => T | undefined;
  readonly set: (entity: number, value: T) => void;
  readonly has: (entity: number) => boolean;
  readonly delete: (entity: number) => void;
  readonly entries: () => Iterable<[number, T]> & { readonly length: number };
}

interface BundledPluginWorld {
  readonly createEntity: () => number;
  readonly destroyEntity: (entity: number) => void;
  readonly registerComponent: <T extends object>(name: string) => BundledComponentStore<T>;
  readonly getComponent: <T extends object>(name: string) => BundledComponentStore<T>;
}

export type BundledRuntimeInput = RuntimeClientInputFrame;

export type BundledClientFrameView = RuntimeClientFrameView;

export type BundledClientFrameDecodeResult = RuntimeClientFrameDecodeResult;

export interface BundledPluginProtocolBridge {
  readonly decodeClientFrame: (bytes: Uint8Array) => BundledClientFrameDecodeResult;
  readonly decodeServerLifecycleFrame: (
    bytes: Uint8Array,
  ) => { readonly kind: "game-over"; readonly winnerPlayerId: string } | undefined;
  readonly encodeInvalidClientFrame: () => Uint8Array;
}

interface BundledRuntimeAdapter {
  readonly id: string;
  readonly onInit?: (ctx: { readonly pluginId: string }, world: BundledPluginWorld) => void;
  readonly onTick?: (world: BundledPluginWorld, dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

export interface BundledPlayerModelSelection {
  readonly playerId: string;
  readonly modelId: string;
}

interface BundledPluginLoaderOptions {
  readonly getPlayerIds?: () => readonly string[];
  readonly getInput?: (playerId: string) => BundledRuntimeInput | undefined;
  readonly emitFrame?: (frame: Uint8Array) => void;
  readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  readonly seed?: string | number;
  /** Encoded `RuntimeMapPackage` wire JSON the room boots from (ADR-0030). */
  readonly mapPackage?: unknown;
  /** Per-session player→model selections (never part of the package). */
  readonly getPlayerModelSelections?: () => readonly BundledPlayerModelSelection[];
}

class InMemoryBundledPluginWorld implements BundledPluginWorld {
  private nextEntity = 1;
  private readonly stores = new Map<string, Map<number, object>>();

  createEntity(): number {
    const entity = this.nextEntity;
    this.nextEntity += 1;
    return entity;
  }

  destroyEntity(entity: number): void {
    for (const store of this.stores.values()) {
      store.delete(entity);
    }
  }

  registerComponent<T extends object>(name: string): BundledComponentStore<T> {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return this.componentStore<T>(name);
  }

  getComponent<T extends object>(name: string): BundledComponentStore<T> {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`component not registered: ${name}`);
    }
    return this.componentStore<T>(name);
  }

  private componentStore<T extends object>(name: string): BundledComponentStore<T> {
    const values = this.stores.get(name) ?? new Map<number, object>();
    this.stores.set(name, values);
    return {
      get: (entity) => {
        const value = values.get(entity);
        return value === undefined ? undefined : (value as T);
      },
      set: (entity, value) => {
        values.set(entity, value);
      },
      has: (entity) => values.has(entity),
      delete: (entity) => {
        values.delete(entity);
      },
      entries: () => {
        const pairs = [...values.entries()].map(([entity, value]) => [entity, value as T] as [number, T]);
        return Object.assign(pairs[Symbol.iterator](), { length: pairs.length });
      },
    };
  }
}

const toRuntimePlugin = (adapter: BundledRuntimeAdapter): RuntimePlugin => {
  const world = new InMemoryBundledPluginWorld();

  return {
    id: adapter.id,
    onInit: (ctx) =>
      Effect.sync(() => {
        adapter.onInit?.(ctx, world);
      }),
    onTick: (_world, dt, tick) =>
      Effect.sync(() => {
        adapter.onTick?.(world, dt, tick);
      }),
    onShutdown: () =>
      Effect.sync(() => {
        adapter.onShutdown?.();
      }),
  };
};

export const createBundledPluginLoader = (options: BundledPluginLoaderOptions = {}): RuntimePluginLoader => ({
  loadExecutable: (pluginId) =>
    Effect.sync(() => {
      if (pluginId !== bundledPlugin.id) {
        throw new Error(`no bundled runtime plugin for ${pluginId}`);
      }
      // Worker-created rooms always carry a resolved package (M5 S1); the
      // first bundled package only covers DO-direct dev/test rooms.
      const mapPackage = options.mapPackage ?? bundledMapPackages[0]?.mapPackage;
      const adapter = createRuntimeAdapter({
        getMapPackage: () => mapPackage,
        ...(options.getPlayerModelSelections === undefined
          ? {}
          : { getPlayerModelSelections: options.getPlayerModelSelections }),
        ...(options.getPlayerIds === undefined ? {} : { getPlayerIds: options.getPlayerIds }),
        ...(options.getInput === undefined ? {} : { getPlayerInput: options.getInput }),
        ...(options.emitFrame === undefined ? {} : { msgOut: { push: options.emitFrame } }),
        ...(options.setReplayFrames === undefined ? {} : { setReplayFrames: options.setReplayFrames }),
        ...(options.seed === undefined ? {} : { seed: options.seed }),
      }) as BundledRuntimeAdapter;
      return { default: toRuntimePlugin(adapter) };
    }),
});

export const createBundledPluginProtocolBridge = (): BundledPluginProtocolBridge => ({
  decodeClientFrame,
  decodeServerLifecycleFrame,
  encodeInvalidClientFrame,
});

export { bundledPlugin };

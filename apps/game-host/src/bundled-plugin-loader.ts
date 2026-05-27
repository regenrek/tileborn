import { Effect } from "effect";

import type { RuntimePlugin, RuntimePluginLoader } from "@tileborne/runtime/worker";

import { bundledPlugin } from "./.generated/bundled-plugin.js";
import {
  createRuntimeAdapter,
  decodeClientFrame,
  encodeInvalidClientFrame,
  type RuntimeClientFrameDecodeResult,
  type RuntimeClientFrameView,
  type RuntimeClientInputFrame,
} from "./.generated/plugin-runtime.js";

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
  readonly encodeInvalidClientFrame: () => Uint8Array;
}

interface BundledRuntimeAdapter {
  readonly id: string;
  readonly onInit?: (ctx: { readonly pluginId: string }, world: BundledPluginWorld) => void;
  readonly onTick?: (world: BundledPluginWorld, dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

interface BundledPluginLoaderOptions {
  readonly getInput?: (playerId: string) => BundledRuntimeInput | undefined;
  readonly emitFrame?: (frame: Uint8Array) => void;
  readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  readonly seed?: string | number;
}

const DEFAULT_ARTIFACT = {
  schemaVersion: 1 as const,
  maxPlayers: 32,
  spawnPoints: [
    { x: 16, y: 32, team: "solo", weight: 1 },
    { x: 48, y: 32, team: "solo", weight: 1 },
  ],
  spawnAnchors: [
    { x: 16, y: 32, team: "solo", weight: 1 },
    { x: 48, y: 32, team: "solo", weight: 1 },
  ],
  shrinkSchedule: {
    centerX: 32,
    centerY: 32,
    startRadiusTiles: 24,
    endRadiusTiles: 4,
    shrinkIntervalMs: 30_000,
    damagePerSecond: 5,
  },
  lootTables: [{ itemKind: "health-pack", tier: "common", weight: 1 }],
  objectPlacements: [] as readonly {
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly properties: Record<string, unknown>;
  }[],
};

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
      const adapter = createRuntimeAdapter({
        getArtifact: () => DEFAULT_ARTIFACT,
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
  encodeInvalidClientFrame,
});

export { bundledPlugin };

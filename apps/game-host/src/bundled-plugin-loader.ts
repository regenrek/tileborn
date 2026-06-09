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
  readonly getPlayerIds?: () => readonly string[];
  readonly getInput?: (playerId: string) => BundledRuntimeInput | undefined;
  readonly emitFrame?: (frame: Uint8Array) => void;
  readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  readonly seed?: string | number;
  readonly runtimeArtifact?: unknown;
}

const DEFAULT_PLAYER_MODEL_ID = "model:bundled-player";
const DEFAULT_PLAYER_MODEL_PACK_ID = "pack:00000000-0000-4000-8000-000000000101";
const DEFAULT_PLAYER_MODEL_PLACEABLE_ID = "placeable:00000000-0000-4000-8000-000000000102";
const DEFAULT_PLAYER_MODEL_CLIPS = {
  idle: "clip:00000000-0000-4000-8000-000000000201",
  walk: "clip:00000000-0000-4000-8000-000000000202",
  run: "clip:00000000-0000-4000-8000-000000000203",
  shoot: "clip:00000000-0000-4000-8000-000000000204",
  reload: "clip:00000000-0000-4000-8000-000000000205",
  hit: "clip:00000000-0000-4000-8000-000000000206",
  death: "clip:00000000-0000-4000-8000-000000000207",
  dash: "clip:00000000-0000-4000-8000-000000000208",
  pickup: "clip:00000000-0000-4000-8000-000000000209",
} as const;

const DEFAULT_PLAYER_MODEL = {
  id: DEFAULT_PLAYER_MODEL_ID,
  label: "Bundled Player",
  ref: {
    packId: DEFAULT_PLAYER_MODEL_PACK_ID,
    kind: "sprite",
    refId: DEFAULT_PLAYER_MODEL_PLACEABLE_ID,
    clipId: DEFAULT_PLAYER_MODEL_CLIPS.idle,
  },
  defaultClipId: DEFAULT_PLAYER_MODEL_CLIPS.idle,
  clips: DEFAULT_PLAYER_MODEL_CLIPS,
  anchor: { x: 0.5, y: 0.5 },
  hitbox: { x: 0.25, y: 0.2, width: 0.5, height: 0.65 },
  muzzle: { x: 0.85, y: 0.5 },
} as const;

const DEFAULT_SPAWN_ANCHORS = Array.from({ length: 32 }, (_, index) => ({
  x: 16 + (index % 8) * 16,
  y: 32 + Math.floor(index / 8) * 16,
  team: "solo",
  weight: 1,
}));

const DEFAULT_ARTIFACT = {
  schemaVersion: 1 as const,
  maxPlayers: 32,
  spawnPoints: DEFAULT_SPAWN_ANCHORS,
  spawnAnchors: DEFAULT_SPAWN_ANCHORS,
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
  playerModels: [DEFAULT_PLAYER_MODEL],
  defaultPlayerModelId: DEFAULT_PLAYER_MODEL_ID,
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
      const artifact = options.runtimeArtifact ?? DEFAULT_ARTIFACT;
      const adapter = createRuntimeAdapter({
        getArtifact: () => artifact,
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
  encodeInvalidClientFrame,
});

export { bundledPlugin };

import { Effect } from 'effect';

import type { JsonValue } from '@tileborne/core';
import type { RuntimePlugin, RuntimePluginLoader } from '@tileborne/runtime/worker';

import { bundledPlugin } from './.generated/bundled-plugin.js';
import {
  createRuntimeAdapter,
  decodeClientFrame,
  decodeServerLifecycleFrame,
  encodeTransportErrorFrame,
  encodeInvalidClientFrame,
  playtestHeldBooleanInputFields,
  playtestInputEdgeFields,
  snapshotTickFromServerFrame,
  type RuntimeClientInputFrame,
} from './.generated/plugin-runtime.js';
import { bundledMapPackages } from './.generated/bundled-map-packages.js';

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
  readonly createCheckpoint: () => { readonly nextEntity: number };
  readonly restoreCheckpoint: (checkpoint: { readonly nextEntity: number }) => void;
}

export type BundledRuntimeInput = object;

export type BundledClientFrameView =
  | { readonly kind: 'heartbeat'; readonly tick: number }
  | { readonly kind: 'ack'; readonly tick: number; readonly receivedAtMs: number }
  | {
      readonly kind: 'input';
      readonly input: BundledRuntimeInput;
      readonly sortKey: {
        readonly tick: number;
        readonly seq: number;
      };
    };

export type BundledClientFrameDecodeResult =
  | { readonly kind: 'accepted'; readonly frame: BundledClientFrameView }
  | {
      readonly kind: 'rejected';
      readonly frame: Uint8Array;
      readonly closeCode: number;
      readonly closeReason: string;
    };

export interface BundledPluginProtocolBridge {
  readonly decodeClientFrame: (bytes: Uint8Array) => BundledClientFrameDecodeResult;
  readonly decodeSnapshotAckFrame: (
    bytes: Uint8Array,
  ) => { readonly tick: number; readonly receivedAtMs: number } | undefined;
  readonly decodeServerLifecycleFrame: (
    bytes: Uint8Array,
  ) => { readonly kind: 'game-over'; readonly winnerPlayerId: string } | undefined;
  readonly snapshotTickFromServerFrame: (bytes: Uint8Array) => number | undefined;
  readonly encodeTransportErrorFrame: (code: string, message: string) => Uint8Array;
  readonly encodeInvalidClientFrame: () => Uint8Array;
}

interface BundledRuntimeAdapter {
  readonly id: string;
  readonly onInit?: (ctx: { readonly pluginId: string }, world: BundledPluginWorld) => void;
  readonly onTick?: (world: BundledPluginWorld, dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

export interface BundledPluginRuntimeRegistration {
  readonly id: string;
  readonly playtestInputEdgeFields?: readonly string[];
  readonly playtestHeldBooleanInputFields?: readonly string[];
  readonly protocolBridge: BundledPluginProtocolBridge;
  readonly createRuntimeAdapter: (host: {
    readonly getMapPackage: () => unknown;
    readonly getPlayerModelSelections?: () => readonly BundledPlayerModelSelection[];
    readonly getPlayerIds?: () => readonly string[];
    readonly getPlayerInput?: (playerId: string) => BundledRuntimeInput | undefined;
    readonly msgOut?: { readonly push: (frame: Uint8Array) => void };
    readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
    readonly getPluginCheckpoint?: (pluginId: string) => JsonValue | undefined;
    readonly seed?: string | number;
    readonly setPluginCheckpoint?: (pluginId: string, checkpoint: JsonValue | undefined) => void;
  }) => BundledRuntimeAdapter;
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
  readonly getPluginCheckpoint?: (pluginId: string) => JsonValue | undefined;
  readonly setPluginCheckpoint?: (pluginId: string, checkpoint: JsonValue | undefined) => void;
  readonly seed?: string | number;
  /** Encoded `RuntimeMapPackage` wire JSON the room boots from (ADR-0030). */
  readonly mapPackage?: unknown;
  /** Per-session player→model selections (never part of the package). */
  readonly getPlayerModelSelections?: () => readonly BundledPlayerModelSelection[];
  readonly pluginRegistrations?: readonly BundledPluginRuntimeRegistration[];
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

  createCheckpoint(): { readonly nextEntity: number } {
    return { nextEntity: this.nextEntity };
  }

  restoreCheckpoint(checkpoint: { readonly nextEntity: number }): void {
    this.nextEntity = Math.max(1, Math.floor(checkpoint.nextEntity));
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
        const pairs = [...values.entries()].map(
          ([entity, value]) => [entity, value as T] as [number, T],
        );
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

const isDirection8 = (value: unknown): value is 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 =>
  value === 0 ||
  value === 1 ||
  value === 2 ||
  value === 3 ||
  value === 4 ||
  value === 5 ||
  value === 6 ||
  value === 7;

const isDefaultRuntimeInput = (value: BundledRuntimeInput): value is RuntimeClientInputFrame => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Partial<RuntimeClientInputFrame>;
  return (
    Number.isSafeInteger(input.tick) &&
    Number.isSafeInteger(input.seq) &&
    (input.dir === undefined || isDirection8(input.dir)) &&
    typeof input.shoot === 'boolean' &&
    typeof input.reload === 'boolean' &&
    typeof input.interact === 'boolean' &&
    typeof input.drop === 'boolean' &&
    Array.isArray(input.abilities) &&
    input.abilities.every((ability) => typeof ability === 'string') &&
    (input.aimDeg === undefined || typeof input.aimDeg === 'number') &&
    (input.swapSlot === undefined || typeof input.swapSlot === 'number')
  );
};

export const createDefaultBundledPluginProtocolBridge = (): BundledPluginProtocolBridge => ({
  decodeClientFrame: (bytes) => {
    const decoded = decodeClientFrame(bytes);
    if (decoded.kind === 'rejected') {
      return decoded;
    }
    if (decoded.frame.kind === 'input') {
      return {
        kind: 'accepted',
        frame: {
          kind: 'input',
          input: decoded.frame.input,
          sortKey: decoded.frame.sortKey,
        },
      };
    }
    return decoded;
  },
  decodeSnapshotAckFrame: (bytes) => {
    const decoded = decodeClientFrame(bytes);
    return decoded.kind === 'accepted' && decoded.frame.kind === 'ack'
      ? { tick: decoded.frame.tick, receivedAtMs: decoded.frame.receivedAtMs }
      : undefined;
  },
  decodeServerLifecycleFrame,
  snapshotTickFromServerFrame,
  encodeTransportErrorFrame,
  encodeInvalidClientFrame,
});

export const defaultBundledPluginRuntimeRegistration: BundledPluginRuntimeRegistration = {
  id: bundledPlugin.id,
  playtestInputEdgeFields,
  playtestHeldBooleanInputFields,
  protocolBridge: createDefaultBundledPluginProtocolBridge(),
  createRuntimeAdapter: (host) =>
    createRuntimeAdapter({
      ...host,
      getPlayerInput: (playerId) => {
        const input = host.getPlayerInput?.(playerId);
        return input === undefined || !isDefaultRuntimeInput(input) ? undefined : input;
      },
    }) as BundledRuntimeAdapter,
};

const runtimePluginIdFromPackage = (mapPackage: unknown): string | undefined => {
  if (typeof mapPackage !== 'object' || mapPackage === null || Array.isArray(mapPackage)) {
    return undefined;
  }
  const manifest = (mapPackage as { readonly manifest?: unknown }).manifest;
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return undefined;
  }
  const pluginId = (manifest as { readonly pluginId?: unknown }).pluginId;
  return typeof pluginId === 'string' && pluginId.length > 0 ? pluginId : undefined;
};

export const createBundledPluginLoader = (
  options: BundledPluginLoaderOptions = {},
): RuntimePluginLoader => {
  const registrations = options.pluginRegistrations ?? [defaultBundledPluginRuntimeRegistration];
  return {
    loadExecutable: (pluginId) =>
      Effect.sync(() => {
        const registration = registrations.find((candidate) => candidate.id === pluginId);
        if (registration === undefined) {
          throw new Error(`no bundled runtime plugin for ${pluginId}`);
        }
        // Worker-created rooms always carry a resolved package (M5 S1); the
        // first bundled package only covers DO-direct dev/test rooms.
        const mapPackage = options.mapPackage ?? bundledMapPackages[0]?.mapPackage;
        const adapter = registration.createRuntimeAdapter({
          getMapPackage: () => mapPackage,
          ...(options.getPlayerModelSelections === undefined
            ? {}
            : { getPlayerModelSelections: options.getPlayerModelSelections }),
          ...(options.getPlayerIds === undefined ? {} : { getPlayerIds: options.getPlayerIds }),
          ...(options.getInput === undefined ? {} : { getPlayerInput: options.getInput }),
          ...(options.emitFrame === undefined ? {} : { msgOut: { push: options.emitFrame } }),
          ...(options.setReplayFrames === undefined
            ? {}
            : { setReplayFrames: options.setReplayFrames }),
          ...(options.getPluginCheckpoint === undefined
            ? {}
            : { getPluginCheckpoint: options.getPluginCheckpoint }),
          ...(options.setPluginCheckpoint === undefined
            ? {}
            : { setPluginCheckpoint: options.setPluginCheckpoint }),
          ...(options.seed === undefined ? {} : { seed: options.seed }),
        });
        return { default: toRuntimePlugin(adapter) };
      }),
  };
};

export const resolveBundledRuntimePluginId = (mapPackage: unknown): string =>
  runtimePluginIdFromPackage(mapPackage) ?? bundledPlugin.id;

export { bundledPlugin };

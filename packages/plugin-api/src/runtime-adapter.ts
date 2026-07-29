/** Generic component storage exposed to authoritative runtime adapters. */
export interface RuntimeAdapterComponentStore<T extends object> {
  readonly get: (entity: number) => T | undefined;
  readonly set: (entity: number, value: T) => void;
  readonly has: (entity: number) => boolean;
  readonly delete: (entity: number) => void;
  readonly entries: () => Iterable<[number, T]>;
}

export interface RuntimeAdapterWorldCheckpoint {
  readonly nextEntity: number;
}

/** Minimal worker-safe world contract. Plugins may extend it with typed helpers. */
export interface RuntimeAdapterWorld {
  readonly createEntity: () => number;
  readonly destroyEntity: (entity: number) => void;
  readonly registerComponent: <T extends object>(name: string) => RuntimeAdapterComponentStore<T>;
  readonly getComponent: <T extends object>(name: string) => RuntimeAdapterComponentStore<T>;
  readonly createCheckpoint?: () => RuntimeAdapterWorldCheckpoint;
  readonly restoreCheckpoint?: (checkpoint: RuntimeAdapterWorldCheckpoint) => void;
}

/** Host capabilities shared by every bundled runtime adapter. */
export interface RuntimeAdapterHost {
  readonly getMapPackage: () => unknown;
  readonly seed?: string | number;
}

export interface RuntimeAdapterContext {
  readonly pluginId: string;
}

/** Structural contract consumed by the statically bundled authoritative host. */
export interface RuntimeAdapter {
  readonly id: string;
  readonly onInit?: (context: RuntimeAdapterContext, world: RuntimeAdapterWorld) => void;
  readonly onTick?: (world: RuntimeAdapterWorld, deltaSeconds: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

/** Runtime entrypoints export this factory by the exact name `createRuntimeAdapter`. */
export type CreateRuntimeAdapter<Host extends RuntimeAdapterHost = RuntimeAdapterHost> = (
  host: Host,
) => RuntimeAdapter;

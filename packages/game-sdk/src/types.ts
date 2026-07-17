import type { JsonValue } from '@tileborne/core';

export type SerializableState = Readonly<Record<string, JsonValue>>;

type Widen<Value> = Value extends string
  ? string
  : Value extends number
    ? number
    : Value extends boolean
      ? boolean
      : Value extends ReadonlyArray<infer Item>
        ? ReadonlyArray<Widen<Item>>
        : Value extends Readonly<Record<string, unknown>>
          ? { readonly [Key in keyof Value]: Widen<Value[Key]> }
          : Value;

export type InferredState<State extends SerializableState> = {
  readonly [Key in keyof State]: Widen<State[Key]>;
};

declare const referenceKind: unique symbol;

export interface EntityReference<Kind extends string = string> {
  readonly _tag: 'entity';
  readonly objectId: string;
  readonly [referenceKind]?: Kind;
}

export interface AssetReference<Kind extends string = string> {
  readonly _tag: 'asset';
  readonly assetId: string;
  readonly [referenceKind]?: Kind;
}

export interface CatalogReference<Kind extends string = string> {
  readonly _tag: 'catalog';
  readonly objectTypeId: string;
  readonly [referenceKind]?: Kind;
}

export interface BehaviorReference {
  readonly _tag: 'behavior';
  readonly behaviorId: string;
}

export type GameReference = EntityReference | AssetReference | CatalogReference | BehaviorReference;
export type ReferenceMap = Readonly<Record<string, GameReference>>;

export interface BehaviorCommand<
  Kind extends string = string,
  Payload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly kind: Kind;
  readonly payload: Payload;
}

export type BehaviorResult =
  | void
  | BehaviorCommand
  | ReadonlyArray<BehaviorCommand>
  | Promise<void | BehaviorCommand | ReadonlyArray<BehaviorCommand>>;

export interface GameEventRegistry {
  'runtime.tick': { readonly tick: number };
  'lifecycle.started': { readonly reason: 'initial' | 'hot-reload' };
  'lifecycle.stopped': { readonly reason: 'project-stop' | 'replacement' | 'error' };
  'lifecycle.reloaded': { readonly previousSourceHash: string };
  'timer.fired': { readonly timerId: string; readonly scheduledTick: number };
}

/** Extend through declaration merging. Every entry is a normal callable TypeScript function. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentionally open registry
export interface GameActionRegistry {}

/** Extend through declaration merging. Queries must be deterministic and side-effect free. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentionally open registry
export interface GameQueryRegistry {}

/** Extend through declaration merging to make project and plugin capabilities discoverable. */
export interface GameCapabilityRegistry {
  'lifecycle.core': true;
  'state.core': true;
  'time.deterministic': true;
}

export type ActionApi = Readonly<{
  [Key in keyof GameActionRegistry]: GameActionRegistry[Key] extends (
    ...args: infer Args
  ) => unknown
    ? (...args: Args) => BehaviorCommand<Key & string, { readonly arguments: Args }>
    : never;
}>;

export type QueryApi = Readonly<{ [Key in keyof GameQueryRegistry]: GameQueryRegistry[Key] }>;

export interface BehaviorClock {
  readonly tick: number;
  readonly elapsedTicks: number;
  readonly ticksPerSecond: number;
}

export interface BehaviorRandom {
  readonly seed: string;
  nextFloat(): number;
  integer(minInclusive: number, maxInclusive: number): number;
  pick<const Value>(values: readonly Value[]): Value;
}

export interface BehaviorTimers {
  after(
    ticks: number,
    timerId: string,
  ): BehaviorCommand<'timer.after', { ticks: number; timerId: string }>;
  every(
    ticks: number,
    timerId: string,
  ): BehaviorCommand<'timer.every', { ticks: number; timerId: string }>;
  cancel(timerId: string): BehaviorCommand<'timer.cancel', { timerId: string }>;
}

export interface BehaviorCapabilities {
  has<Id extends keyof GameCapabilityRegistry & string>(id: Id): boolean;
  require<Id extends keyof GameCapabilityRegistry & string>(id: Id): void;
  list(): ReadonlyArray<keyof GameCapabilityRegistry & string>;
}

export interface BehaviorStateStore<State extends SerializableState> {
  readonly value: Readonly<State>;
  get<Key extends keyof State>(key: Key): State[Key];
  set<Key extends keyof State>(
    key: Key,
    value: State[Key],
  ): BehaviorCommand<'state.set', { readonly key: Key & string; readonly value: State[Key] }>;
}

export interface BehaviorContext<
  State extends SerializableState,
  Refs extends ReferenceMap,
  EventId extends keyof GameEventRegistry,
> {
  readonly event: Readonly<GameEventRegistry[EventId]>;
  readonly eventId: EventId;
  readonly state: BehaviorStateStore<State>;
  readonly refs: Readonly<Refs>;
  readonly query: QueryApi;
  readonly actions: ActionApi;
  readonly clock: BehaviorClock;
  readonly rng: BehaviorRandom;
  readonly timers: BehaviorTimers;
  readonly capabilities: BehaviorCapabilities;
}

export type BehaviorLifecycleContext<
  State extends SerializableState,
  Refs extends ReferenceMap,
> = Omit<BehaviorContext<State, Refs, 'lifecycle.started'>, 'event' | 'eventId'>;

export interface BehaviorErrorContext<
  State extends SerializableState,
  Refs extends ReferenceMap,
> extends BehaviorLifecycleContext<State, Refs> {
  readonly diagnostic: { readonly code: string; readonly message: string };
}

export type BehaviorHandlers<State extends SerializableState, Refs extends ReferenceMap> = {
  readonly [EventId in keyof GameEventRegistry]?: (
    context: BehaviorContext<State, Refs, EventId>,
  ) => BehaviorResult;
};

export interface BehaviorDefinition<
  Id extends string,
  State extends SerializableState,
  Refs extends ReferenceMap,
> {
  readonly id: Id;
  readonly state: State;
  readonly refs?: Refs;
  readonly requiredCapabilities?: ReadonlyArray<keyof GameCapabilityRegistry & string>;
  readonly on?: BehaviorHandlers<InferredState<State>, Refs>;
  readonly onStart?: (
    context: BehaviorLifecycleContext<InferredState<State>, Refs>,
  ) => BehaviorResult;
  readonly onStop?: (
    context: BehaviorLifecycleContext<InferredState<State>, Refs>,
  ) => BehaviorResult;
  readonly onReload?: (
    context: BehaviorLifecycleContext<InferredState<State>, Refs>,
  ) => BehaviorResult;
  readonly onError?: (context: BehaviorErrorContext<InferredState<State>, Refs>) => BehaviorResult;
}

export interface BehaviorModule<
  Id extends string = string,
  State extends SerializableState = SerializableState,
  Refs extends ReferenceMap = ReferenceMap,
> extends BehaviorDefinition<Id, State, Refs> {
  readonly sourceKind: 'typescript';
}

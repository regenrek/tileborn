import type { BehaviorId, BehaviorSourceKind, ContentHash, JsonValue } from '@tileborne/core';

export type RuntimeBehaviorState = Record<string, JsonValue>;

export interface RuntimeBehaviorCommand {
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type RuntimeBehaviorResult =
  | void
  | RuntimeBehaviorCommand
  | ReadonlyArray<RuntimeBehaviorCommand>
  | Promise<void | RuntimeBehaviorCommand | ReadonlyArray<RuntimeBehaviorCommand>>;

export interface RuntimeBehaviorContext {
  readonly eventId: string;
  readonly event: Readonly<Record<string, unknown>>;
  readonly state: {
    readonly value: Readonly<RuntimeBehaviorState>;
    get(key: string): JsonValue | undefined;
    set(key: string, value: JsonValue): RuntimeBehaviorCommand;
  };
  readonly refs: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, (...arguments_: ReadonlyArray<unknown>) => unknown>>;
  readonly actions: Readonly<
    Record<string, (...arguments_: ReadonlyArray<unknown>) => RuntimeBehaviorCommand>
  >;
  readonly clock: {
    readonly tick: number;
    readonly elapsedTicks: number;
    readonly ticksPerSecond: number;
  };
  readonly rng: {
    readonly seed: string;
    nextFloat(): number;
    integer(minInclusive: number, maxInclusive: number): number;
    pick<Value>(values: readonly Value[]): Value;
  };
  readonly timers: {
    after(ticks: number, timerId: string): RuntimeBehaviorCommand;
    every(ticks: number, timerId: string): RuntimeBehaviorCommand;
    cancel(timerId: string): RuntimeBehaviorCommand;
  };
  readonly capabilities: {
    has(id: string): boolean;
    require(id: string): void;
    list(): ReadonlyArray<string>;
  };
}

type LifecycleContext = Omit<RuntimeBehaviorContext, 'event' | 'eventId'>;

export interface RuntimeBehaviorModule {
  readonly id: string;
  readonly sourceKind: BehaviorSourceKind;
  readonly state: Readonly<RuntimeBehaviorState>;
  readonly refs?: Readonly<Record<string, unknown>>;
  readonly requiredCapabilities?: ReadonlyArray<string>;
  readonly on?: Readonly<
    Record<string, (context: RuntimeBehaviorContext) => RuntimeBehaviorResult>
  >;
  readonly onStart?: (context: LifecycleContext) => RuntimeBehaviorResult;
  readonly onStop?: (context: LifecycleContext) => RuntimeBehaviorResult;
  readonly onReload?: (context: LifecycleContext) => RuntimeBehaviorResult;
  readonly onError?: (
    context: LifecycleContext & {
      readonly diagnostic: { readonly code: string; readonly message: string };
    },
  ) => RuntimeBehaviorResult;
}

export interface RuntimeBehaviorArtifactIdentity {
  readonly behaviorId: BehaviorId;
  readonly sourceKind: BehaviorSourceKind;
  readonly modulePath: string;
  readonly hash: ContentHash;
}

export interface LoadedBehaviorModule {
  readonly artifact: RuntimeBehaviorArtifactIdentity;
  readonly module: RuntimeBehaviorModule;
}

export interface BehaviorRuntimeDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly behaviorId?: BehaviorId;
  readonly eventId?: string;
  readonly suggestion: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export interface BehaviorExecutionTrace {
  readonly sequence: number;
  readonly tick: number;
  readonly behaviorId: BehaviorId;
  readonly sourceKind: BehaviorSourceKind;
  readonly eventId: string;
  readonly event: Readonly<Record<string, unknown>>;
  /** Stable runtime instance identity. A future entity-scoped scheduler can widen this. */
  readonly instanceId: string;
  /** State at handler entry, before any validated command is committed. */
  readonly stateBefore: Readonly<RuntimeBehaviorState>;
  readonly commands: ReadonlyArray<RuntimeBehaviorCommand>;
  readonly state: Readonly<RuntimeBehaviorState>;
  /** Semantic visual execution steps. TypeScript traces remain handler/source-map scoped. */
  readonly steps: ReadonlyArray<BehaviorExecutionStep>;
}

export type BehaviorExecutionStep =
  | {
      readonly kind: 'branch';
      readonly nodeId: string;
      readonly branch: 'then' | 'else';
    }
  | {
      readonly kind: 'action';
      readonly nodeId: string;
      readonly actionId: string;
    };

export interface BehaviorSchedulerSnapshot {
  readonly tick: number;
  readonly states: ReadonlyArray<{
    readonly behaviorId: BehaviorId;
    readonly state: Readonly<RuntimeBehaviorState>;
  }>;
}

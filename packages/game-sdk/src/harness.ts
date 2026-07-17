import type {
  ActionApi,
  BehaviorCapabilities,
  BehaviorClock,
  BehaviorCommand,
  BehaviorContext,
  BehaviorModule,
  BehaviorRandom,
  BehaviorResult,
  BehaviorStateStore,
  BehaviorTimers,
  GameCapabilityRegistry,
  GameEventRegistry,
  GameQueryRegistry,
  QueryApi,
  ReferenceMap,
  SerializableState,
} from './types.js';

export interface BehaviorTestHarnessOptions {
  readonly seed?: string;
  readonly tick?: number;
  readonly ticksPerSecond?: number;
  readonly capabilities?: ReadonlyArray<keyof GameCapabilityRegistry & string>;
  readonly queries?: Partial<GameQueryRegistry>;
}

export interface BehaviorDispatchResult<State extends SerializableState> {
  readonly state: Readonly<State>;
  readonly commands: ReadonlyArray<BehaviorCommand>;
}

const normalizeCommands = async (
  result: BehaviorResult,
): Promise<ReadonlyArray<BehaviorCommand>> => {
  const awaited = await result;
  if (awaited === undefined) return [];
  return Array.isArray(awaited) ? awaited : [awaited as BehaviorCommand];
};

const hashSeed = (value: string): number => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createRandom = (seed: string): BehaviorRandom => {
  let state = hashSeed(seed) || 0x6d2b79f5;
  const nextFloat = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    seed,
    nextFloat,
    integer: (minInclusive, maxInclusive) =>
      Math.floor(nextFloat() * (maxInclusive - minInclusive + 1)) + minInclusive,
    pick: <const Value>(values: readonly Value[]): Value => {
      if (values.length === 0)
        throw new TypeError('TBSDK2001: rng.pick requires a non-empty array');
      return values[Math.floor(nextFloat() * values.length)] as Value;
    },
  };
};

export const createBehaviorTestHarness = <
  Id extends string,
  State extends SerializableState,
  Refs extends ReferenceMap,
>(
  module: BehaviorModule<Id, State, Refs>,
  options: BehaviorTestHarnessOptions = {},
) => {
  const state = { ...module.state } as State;
  const capabilities = new Set(options.capabilities ?? module.requiredCapabilities ?? []);
  const clock: BehaviorClock = Object.freeze({
    tick: options.tick ?? 0,
    elapsedTicks: options.tick ?? 0,
    ticksPerSecond: options.ticksPerSecond ?? 60,
  });
  const rng = createRandom(options.seed ?? `${module.id}:test`);
  const timers: BehaviorTimers = Object.freeze({
    after: (ticks: number, timerId: string) => ({
      kind: 'timer.after' as const,
      payload: { ticks, timerId },
    }),
    every: (ticks: number, timerId: string) => ({
      kind: 'timer.every' as const,
      payload: { ticks, timerId },
    }),
    cancel: (timerId: string) => ({ kind: 'timer.cancel' as const, payload: { timerId } }),
  });
  const capabilityApi: BehaviorCapabilities = Object.freeze({
    has: (id: keyof GameCapabilityRegistry & string) => capabilities.has(id),
    require: (id: keyof GameCapabilityRegistry & string) => {
      if (!capabilities.has(id)) {
        throw new TypeError(`TBSDK2002: required capability "${id}" is unavailable`);
      }
    },
    list: () => [...capabilities].sort(),
  });
  const stateStore: BehaviorStateStore<State> = {
    get value() {
      return state;
    },
    get: (key) => state[key],
    set: <Key extends keyof State>(key: Key, value: State[Key]) => ({
      kind: 'state.set' as const,
      payload: { key: key as Key & string, value },
    }),
  };

  const actionProxy = new Proxy(
    {},
    {
      get:
        (_target, property) =>
        (...args: ReadonlyArray<unknown>) => ({
          kind: String(property),
          payload: { arguments: args },
        }),
    },
  ) as ActionApi;

  const createContext = <EventId extends keyof GameEventRegistry>(
    eventId: EventId,
    event: GameEventRegistry[EventId],
  ): BehaviorContext<State, Refs, EventId> => ({
    event,
    eventId,
    state: stateStore,
    refs: (module.refs ?? {}) as Refs,
    query: (options.queries ?? {}) as QueryApi,
    actions: actionProxy,
    clock,
    rng,
    timers,
    capabilities: capabilityApi,
  });

  const applyStateCommands = (commands: ReadonlyArray<BehaviorCommand>): void => {
    for (const command of commands) {
      if (command.kind !== 'state.set') continue;
      const payload = command.payload as {
        readonly key: keyof State;
        readonly value: State[keyof State];
      };
      state[payload.key] = payload.value;
    }
  };

  return Object.freeze({
    module,
    dispatch: async <EventId extends keyof GameEventRegistry>(
      eventId: EventId,
      event: GameEventRegistry[EventId],
    ): Promise<BehaviorDispatchResult<State>> => {
      const handler = module.on?.[eventId];
      const commands = handler
        ? await normalizeCommands(handler(createContext(eventId, event) as never))
        : [];
      applyStateCommands(commands);
      return { state: { ...state }, commands };
    },
  });
};

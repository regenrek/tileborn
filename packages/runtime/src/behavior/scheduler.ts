import type { BehaviorId, JsonValue } from '@tileborne/core';

import type {
  BehaviorExecutionTrace,
  BehaviorExecutionStep,
  BehaviorRuntimeDiagnostic,
  BehaviorSchedulerSnapshot,
  LoadedBehaviorModule,
  RuntimeBehaviorCommand,
  RuntimeBehaviorContext,
  RuntimeBehaviorModule,
  RuntimeBehaviorResult,
  RuntimeBehaviorState,
} from './types.js';

export interface BehaviorRuntimeBudgets {
  readonly maxHandlerMs: number;
  readonly maxStateBytes: number;
  readonly maxMemoryBytes: number;
  readonly maxQueueDepth: number;
  readonly maxRecursionDepth: number;
  readonly maxActionsPerDispatch: number;
  readonly maxActionsPerTick: number;
  readonly maxTraceEntries: number;
  readonly maxDiagnosticEntries: number;
}

export const DEFAULT_BEHAVIOR_RUNTIME_BUDGETS: BehaviorRuntimeBudgets = Object.freeze({
  maxHandlerMs: 8,
  maxStateBytes: 64 * 1024,
  maxMemoryBytes: 2 * 1024 * 1024,
  maxQueueDepth: 512,
  maxRecursionDepth: 16,
  maxActionsPerDispatch: 128,
  maxActionsPerTick: 2_048,
  maxTraceEntries: 256,
  maxDiagnosticEntries: 256,
});

interface QueuedEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly event: Readonly<Record<string, unknown>>;
  readonly targetBehaviorId?: BehaviorId;
  readonly depth: number;
}

interface ScheduledTimer {
  readonly behaviorId: BehaviorId;
  readonly timerId: string;
  readonly dueTick: number;
  readonly interval?: number;
  readonly sequence: number;
}

interface BehaviorInstance {
  loaded: LoadedBehaviorModule;
  state: RuntimeBehaviorState;
  rng: ReturnType<typeof createRandom>;
}

export interface BehaviorSchedulerOptions {
  readonly seed?: string;
  readonly ticksPerSecond?: number;
  readonly capabilities?: ReadonlyArray<string>;
  readonly queries?: Readonly<Record<string, (...arguments_: ReadonlyArray<unknown>) => unknown>>;
  readonly budgets?: Partial<BehaviorRuntimeBudgets>;
  readonly now?: () => number;
  readonly onDiagnostic?: (diagnostic: BehaviorRuntimeDiagnostic) => void;
  readonly onCommand?: (
    command: RuntimeBehaviorCommand,
    trace: Omit<BehaviorExecutionTrace, 'commands'>,
  ) => void;
}

const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const isSerializable = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isSerializable(item, seen))
    : Object.prototype.toString.call(value) === '[object Object]' &&
      Object.values(value as Record<string, unknown>).every((item) => isSerializable(item, seen));
  seen.delete(value);
  return valid;
};

const hashSeed = (value: string): number => {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const createRandom = (seed: string) => {
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
    integer: (minimum: number, maximum: number) =>
      Math.floor(nextFloat() * (maximum - minimum + 1)) + minimum,
    pick: <Value>(values: readonly Value[]): Value => {
      if (values.length === 0) throw new TypeError('TBRUNTIME3003: rng.pick requires values');
      return values[Math.floor(nextFloat() * values.length)] as Value;
    },
  };
};

const normalizeCommands = async (
  result: RuntimeBehaviorResult,
): Promise<ReadonlyArray<RuntimeBehaviorCommand>> => {
  const resolved = await result;
  if (resolved === undefined) return [];
  return Array.isArray(resolved) ? resolved : [resolved as RuntimeBehaviorCommand];
};

const isCommand = (value: unknown): value is RuntimeBehaviorCommand =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  typeof value.kind === 'string' &&
  'payload' in value &&
  typeof value.payload === 'object' &&
  value.payload !== null &&
  !Array.isArray(value.payload);

const DEBUG_COMMAND_PREFIX = '__tileborne.debug.';

const partitionExecutionCommands = (
  sourceKind: LoadedBehaviorModule['artifact']['sourceKind'],
  commands: ReadonlyArray<RuntimeBehaviorCommand>,
): { readonly commands: ReadonlyArray<RuntimeBehaviorCommand>; readonly steps: ReadonlyArray<BehaviorExecutionStep> } => {
  const executable: RuntimeBehaviorCommand[] = [];
  const steps: BehaviorExecutionStep[] = [];
  for (const command of commands) {
    if (!command.kind.startsWith(DEBUG_COMMAND_PREFIX)) {
      executable.push(command);
      continue;
    }
    if (sourceKind !== 'visual') {
      throw new TypeError(`reserved runtime command ${command.kind} is only emitted by the visual compiler`);
    }
    const nodeId = command.payload.nodeId;
    if (typeof nodeId !== 'string' || nodeId.length === 0) {
      throw new TypeError(`visual debug command ${command.kind} requires a nodeId`);
    }
    if (command.kind === '__tileborne.debug.branch') {
      const branch = command.payload.branch;
      if (branch !== 'then' && branch !== 'else') {
        throw new TypeError('visual branch trace requires then or else');
      }
      steps.push({ kind: 'branch', nodeId, branch });
    } else if (command.kind === '__tileborne.debug.action') {
      const actionId = command.payload.actionId;
      if (typeof actionId !== 'string' || actionId.length === 0) {
        throw new TypeError('visual action trace requires an actionId');
      }
      steps.push({ kind: 'action', nodeId, actionId });
    } else {
      throw new TypeError(`unknown visual debug command ${command.kind}`);
    }
  }
  return { commands: executable, steps };
};

export class DeterministicBehaviorScheduler {
  readonly #instances = new Map<BehaviorId, BehaviorInstance>();
  readonly #queue: QueuedEvent[] = [];
  readonly #timers: ScheduledTimer[] = [];
  readonly #diagnostics: BehaviorRuntimeDiagnostic[] = [];
  readonly #traces: BehaviorExecutionTrace[] = [];
  readonly #capabilities: ReadonlySet<string>;
  readonly #queries: Readonly<Record<string, (...arguments_: ReadonlyArray<unknown>) => unknown>>;
  readonly #budgets: BehaviorRuntimeBudgets;
  readonly #seed: string;
  readonly #ticksPerSecond: number;
  readonly #now: () => number;
  readonly #onDiagnostic: ((diagnostic: BehaviorRuntimeDiagnostic) => void) | undefined;
  readonly #onCommand: BehaviorSchedulerOptions['onCommand'] | undefined;
  #tick = 0;
  #sequence = 0;
  #actionsThisTick = 0;
  #draining = false;

  constructor(options: BehaviorSchedulerOptions = {}) {
    this.#seed = options.seed ?? 'tileborne-behavior-runtime';
    this.#ticksPerSecond = options.ticksPerSecond ?? 60;
    this.#capabilities = new Set(options.capabilities ?? []);
    this.#queries = Object.freeze({ ...(options.queries ?? {}) });
    this.#budgets = Object.freeze({ ...DEFAULT_BEHAVIOR_RUNTIME_BUDGETS, ...options.budgets });
    this.#now = options.now ?? (() => performance.now());
    this.#onDiagnostic = options.onDiagnostic;
    this.#onCommand = options.onCommand;
  }

  get tick(): number {
    return this.#tick;
  }

  get diagnostics(): ReadonlyArray<BehaviorRuntimeDiagnostic> {
    return [...this.#diagnostics];
  }

  get traces(): ReadonlyArray<BehaviorExecutionTrace> {
    return [...this.#traces];
  }

  stateOf(behaviorId: BehaviorId): Readonly<RuntimeBehaviorState> | undefined {
    const state = this.#instances.get(behaviorId)?.state;
    return state ? structuredClone(state) : undefined;
  }

  snapshot(): BehaviorSchedulerSnapshot {
    return {
      tick: this.#tick,
      states: [...this.#instances.entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([behaviorId, instance]) => ({
          behaviorId,
          state: structuredClone(instance.state),
        })),
    };
  }

  restore(snapshot: BehaviorSchedulerSnapshot): boolean {
    if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0) return false;
    const replacements = new Map<BehaviorId, RuntimeBehaviorState>();
    for (const entry of snapshot.states) {
      if (!this.#instances.has(entry.behaviorId) || !isSerializable(entry.state)) return false;
      const state = structuredClone(entry.state);
      if (!this.#fitsStateBudget(entry.behaviorId, state)) return false;
      replacements.set(entry.behaviorId, state);
    }
    for (const [behaviorId, state] of replacements) {
      const instance = this.#instances.get(behaviorId);
      if (instance) instance.state = state;
    }
    this.#tick = snapshot.tick;
    this.#actionsThisTick = 0;
    this.#queue.length = 0;
    this.#timers.length = 0;
    return true;
  }

  register(loaded: LoadedBehaviorModule): boolean {
    const missing = (loaded.module.requiredCapabilities ?? []).filter(
      (capability) => !this.#capabilities.has(capability),
    );
    if (missing.length > 0) {
      this.#report({
        code: 'TBRUNTIME3004',
        severity: 'error',
        behaviorId: loaded.artifact.behaviorId,
        message: `Behavior requires unavailable capabilities: ${missing.join(', ')}.`,
        suggestion: 'Enable the owning plugins/capabilities before loading this behavior.',
        details: { missing },
      });
      return false;
    }
    const state = structuredClone(loaded.module.state);
    if (!this.#fitsStateBudget(loaded.artifact.behaviorId, state)) return false;
    this.#instances.set(loaded.artifact.behaviorId, {
      loaded,
      state,
      rng: createRandom(`${this.#seed}:${loaded.artifact.behaviorId}`),
    });
    return true;
  }

  /** Transactional hot reload: invalid candidates never replace the active verified module. */
  async hotReload(loaded: LoadedBehaviorModule): Promise<boolean> {
    const previous = this.#instances.get(loaded.artifact.behaviorId);
    const state = { ...structuredClone(loaded.module.state), ...(previous?.state ?? {}) };
    if (!this.#fitsStateBudget(loaded.artifact.behaviorId, state)) return false;
    const candidate: BehaviorInstance = {
      loaded,
      state,
      rng: previous?.rng ?? createRandom(`${this.#seed}:${loaded.artifact.behaviorId}`),
    };
    this.#instances.set(loaded.artifact.behaviorId, candidate);
    if (loaded.module.onReload) {
      const accepted = await this.#invokeLifecycle(candidate, loaded.module.onReload, 'reload');
      if (!accepted) {
        if (previous) this.#instances.set(loaded.artifact.behaviorId, previous);
        else this.#instances.delete(loaded.artifact.behaviorId);
        return false;
      }
    }
    return true;
  }

  cancelBehavior(behaviorId: BehaviorId): void {
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      if (this.#queue[index]?.targetBehaviorId === behaviorId) this.#queue.splice(index, 1);
    }
    for (let index = this.#timers.length - 1; index >= 0; index -= 1) {
      if (this.#timers[index]?.behaviorId === behaviorId) this.#timers.splice(index, 1);
    }
  }

  enqueue(
    eventId: string,
    event: Readonly<Record<string, unknown>>,
    options: { readonly targetBehaviorId?: BehaviorId; readonly depth?: number } = {},
  ): boolean {
    const depth = options.depth ?? 0;
    if (!isSerializable(event)) {
      this.#report({
        code: 'TBRUNTIME3009',
        severity: 'error',
        ...(options.targetBehaviorId ? { behaviorId: options.targetBehaviorId } : {}),
        eventId,
        message: 'Behavior event payload is not finite JSON data.',
        suggestion:
          'Emit only serializable values; move host objects and binary data behind capabilities.',
      });
      return false;
    }
    if (depth > this.#budgets.maxRecursionDepth) {
      this.#report({
        code: 'TBRUNTIME3005',
        severity: 'error',
        ...(options.targetBehaviorId ? { behaviorId: options.targetBehaviorId } : {}),
        eventId,
        message: `Behavior event recursion depth ${depth} exceeds ${this.#budgets.maxRecursionDepth}.`,
        suggestion: 'Break the event cycle with a timer or reduce nested event emissions.',
      });
      return false;
    }
    if (this.#queue.length >= this.#budgets.maxQueueDepth) {
      this.#report({
        code: 'TBRUNTIME3006',
        severity: 'error',
        ...(options.targetBehaviorId ? { behaviorId: options.targetBehaviorId } : {}),
        eventId,
        message: `Behavior event queue reached ${this.#budgets.maxQueueDepth} entries.`,
        suggestion: 'Coalesce repeated events or raise the explicit project budget.',
      });
      return false;
    }
    const candidate: QueuedEvent = {
      sequence: this.#sequence++,
      eventId,
      event: structuredClone(event),
      ...(options.targetBehaviorId ? { targetBehaviorId: options.targetBehaviorId } : {}),
      depth,
    };
    if (this.#memoryBytes(candidate) > this.#budgets.maxMemoryBytes) {
      this.#report({
        code: 'TBRUNTIME3007',
        severity: 'error',
        ...(options.targetBehaviorId ? { behaviorId: options.targetBehaviorId } : {}),
        eventId,
        message: `Behavior runtime memory budget ${this.#budgets.maxMemoryBytes} bytes would be exceeded.`,
        suggestion: 'Reduce event payload/state size or raise the explicit project budget.',
      });
      return false;
    }
    this.#queue.push(candidate);
    return true;
  }

  async dispatch(
    eventId: string,
    event: Readonly<Record<string, unknown>>,
    options: { readonly targetBehaviorId?: BehaviorId; readonly signal?: AbortSignal } = {},
  ): Promise<ReadonlyArray<BehaviorExecutionTrace>> {
    const sequenceStart = this.#sequence;
    if (!this.enqueue(eventId, event, options)) return [];
    await this.drain(options.signal);
    return this.#traces.filter((trace) => trace.sequence >= sequenceStart);
  }

  async advanceTo(
    tick: number,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<BehaviorExecutionTrace>> {
    if (!Number.isSafeInteger(tick) || tick < this.#tick) {
      throw new RangeError('behavior scheduler tick must move forward as a safe integer');
    }
    const sequenceStart = this.#sequence;
    if (tick !== this.#tick) this.#actionsThisTick = 0;
    this.#tick = tick;
    const due = this.#timers
      .filter((timer) => timer.dueTick <= tick)
      .sort((left, right) => left.dueTick - right.dueTick || left.sequence - right.sequence);
    for (const timer of due) {
      const index = this.#timers.indexOf(timer);
      if (index >= 0) this.#timers.splice(index, 1);
      this.enqueue(
        'timer.fired',
        { timerId: timer.timerId, scheduledTick: timer.dueTick },
        { targetBehaviorId: timer.behaviorId },
      );
      if (timer.interval !== undefined) {
        this.#timers.push({
          ...timer,
          dueTick: timer.dueTick + timer.interval,
          sequence: this.#sequence++,
        });
      }
    }
    await this.drain(signal);
    return this.#traces.filter((trace) => trace.sequence >= sequenceStart);
  }

  async drain(signal?: AbortSignal): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#queue.length > 0) {
        if (signal?.aborted) {
          this.#queue.length = 0;
          this.#report({
            code: 'TBRUNTIME3010',
            severity: 'warning',
            message: 'Behavior dispatch was cancelled before the queue completed.',
            suggestion: 'Retry the playtest action if cancellation was unintended.',
          });
          break;
        }
        const queued = this.#queue.shift();
        if (!queued) break;
        const instances = queued.targetBehaviorId
          ? [this.#instances.get(queued.targetBehaviorId)].filter(
              (instance): instance is BehaviorInstance => instance !== undefined,
            )
          : [...this.#instances.entries()]
              .sort(([left], [right]) => String(left).localeCompare(String(right)))
              .map(([, instance]) => instance);
        for (const instance of instances) await this.#execute(instance, queued, signal);
      }
    } finally {
      this.#draining = false;
    }
  }

  #context(
    instance: BehaviorInstance,
    eventId: string,
    event: Readonly<Record<string, unknown>>,
  ): RuntimeBehaviorContext {
    const state = instance.state;
    const actionProxy = new Proxy(
      {},
      {
        get:
          (_target, property) =>
          (...arguments_: ReadonlyArray<unknown>): RuntimeBehaviorCommand => ({
            kind: String(property),
            payload: { arguments: arguments_ },
          }),
      },
    ) as RuntimeBehaviorContext['actions'];
    return {
      eventId,
      event,
      state: {
        get value() {
          return state;
        },
        get: (key) => state[key],
        set: (key, value) => ({ kind: 'state.set', payload: { key, value } }),
      },
      refs: instance.loaded.module.refs ?? {},
      query: this.#queries,
      actions: actionProxy,
      clock: { tick: this.#tick, elapsedTicks: this.#tick, ticksPerSecond: this.#ticksPerSecond },
      rng: instance.rng,
      timers: {
        after: (ticks, timerId) => ({ kind: 'timer.after', payload: { ticks, timerId } }),
        every: (ticks, timerId) => ({ kind: 'timer.every', payload: { ticks, timerId } }),
        cancel: (timerId) => ({ kind: 'timer.cancel', payload: { timerId } }),
      },
      capabilities: {
        has: (id) => this.#capabilities.has(id),
        require: (id) => {
          if (!this.#capabilities.has(id)) {
            throw new TypeError(`TBRUNTIME3004: capability ${JSON.stringify(id)} is unavailable`);
          }
        },
        list: () => [...this.#capabilities].sort(),
      },
    };
  }

  async #execute(
    instance: BehaviorInstance,
    queued: QueuedEvent,
    signal?: AbortSignal,
  ): Promise<void> {
    const handler = instance.loaded.module.on?.[queued.eventId];
    if (!handler || signal?.aborted) return;
    const behaviorId = instance.loaded.artifact.behaviorId;
    const context = this.#context(instance, queued.eventId, queued.event);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timersBefore = [...this.#timers];
    const queueBefore = [...this.#queue];
    const rollbackEffects = (): void => {
      this.#timers.splice(0, this.#timers.length, ...timersBefore);
      this.#queue.splice(0, this.#queue.length, ...queueBefore);
    };
    const started = this.#now();
    try {
      const rawCommands = await Promise.race([
        normalizeCommands(handler(context)),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`handler exceeded ${this.#budgets.maxHandlerMs}ms`)),
            this.#budgets.maxHandlerMs,
          );
        }),
      ]);
      const elapsed = this.#now() - started;
      if (elapsed > this.#budgets.maxHandlerMs) {
        throw new Error(`handler exceeded ${this.#budgets.maxHandlerMs}ms`);
      }
      if (!rawCommands.every(isCommand)) throw new TypeError('handler returned a malformed command');
      if (!rawCommands.every((command) => isSerializable(command.payload))) {
        throw new TypeError('handler returned a command with a non-serializable payload');
      }
      const { commands, steps } = partitionExecutionCommands(
        instance.loaded.artifact.sourceKind,
        rawCommands,
      );
      if (commands.length > this.#budgets.maxActionsPerDispatch) {
        throw new RangeError(
          `handler returned ${commands.length} commands; limit is ${this.#budgets.maxActionsPerDispatch}`,
        );
      }
      if (this.#actionsThisTick + commands.length > this.#budgets.maxActionsPerTick) {
        throw new RangeError(`tick action budget ${this.#budgets.maxActionsPerTick} exceeded`);
      }
      const stateBefore = structuredClone(instance.state);
      const nextState = structuredClone(instance.state);
      this.#validateAndApplyCommands(instance, queued, commands, nextState);
      if (!this.#fitsStateBudget(behaviorId, nextState)) {
        rollbackEffects();
        return;
      }
      if (this.#memoryBytes(undefined, behaviorId, nextState) > this.#budgets.maxMemoryBytes) {
        throw new RangeError(`runtime memory budget ${this.#budgets.maxMemoryBytes} exceeded`);
      }
      instance.state = nextState;
      this.#actionsThisTick += commands.length;
      const trace: BehaviorExecutionTrace = {
        sequence: queued.sequence,
        tick: this.#tick,
        behaviorId,
        sourceKind: instance.loaded.artifact.sourceKind,
        eventId: queued.eventId,
        event: queued.event,
        instanceId: String(behaviorId),
        stateBefore,
        commands: structuredClone(commands),
        state: structuredClone(instance.state),
        steps: structuredClone(steps),
      };
      this.#traces.push(trace);
      if (this.#traces.length > this.#budgets.maxTraceEntries) {
        this.#traces.splice(0, this.#traces.length - this.#budgets.maxTraceEntries);
      }
      for (const command of commands) this.#onCommand?.(command, trace);
    } catch (error) {
      rollbackEffects();
      const message = error instanceof Error ? error.message : String(error);
      this.#report({
        code: message.includes('exceeded') ? 'TBRUNTIME3011' : 'TBRUNTIME3012',
        severity: 'error',
        behaviorId,
        eventId: queued.eventId,
        message: `Behavior ${instance.loaded.module.id} failed: ${message}.`,
        suggestion:
          'Inspect the mapped source location; the host and other behaviors remain active.',
      });
      await this.#notifyError(instance, message);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  #validateAndApplyCommands(
    instance: BehaviorInstance,
    queued: QueuedEvent,
    commands: ReadonlyArray<RuntimeBehaviorCommand>,
    nextState: RuntimeBehaviorState,
  ): void {
    for (const command of commands) {
      if (command.kind === 'state.set') {
        const key = command.payload.key;
        if (typeof key !== 'string' || !('value' in command.payload)) {
          throw new TypeError('state.set requires key and value');
        }
        nextState[key] = command.payload.value as JsonValue;
      } else if (command.kind === 'timer.after' || command.kind === 'timer.every') {
        const ticks = command.payload.ticks;
        const timerId = command.payload.timerId;
        if (!Number.isSafeInteger(ticks) || (ticks as number) <= 0 || typeof timerId !== 'string') {
          throw new TypeError(`${command.kind} requires positive integer ticks and a timerId`);
        }
        this.#timers.push({
          behaviorId: instance.loaded.artifact.behaviorId,
          timerId,
          dueTick: this.#tick + (ticks as number),
          ...(command.kind === 'timer.every' ? { interval: ticks as number } : {}),
          sequence: this.#sequence++,
        });
      } else if (command.kind === 'timer.cancel') {
        const timerId = command.payload.timerId;
        for (let index = this.#timers.length - 1; index >= 0; index -= 1) {
          const timer = this.#timers[index];
          if (
            timer?.behaviorId === instance.loaded.artifact.behaviorId &&
            timer.timerId === timerId
          ) {
            this.#timers.splice(index, 1);
          }
        }
      } else if (command.kind === 'event.emit') {
        const eventId = command.payload.eventId;
        const event = command.payload.event;
        if (
          typeof eventId !== 'string' ||
          typeof event !== 'object' ||
          event === null ||
          Array.isArray(event)
        ) {
          throw new TypeError('event.emit requires eventId and an object event payload');
        }
        const admitted = this.enqueue(eventId, event as Readonly<Record<string, unknown>>, {
          depth: queued.depth + 1,
        });
        if (!admitted) {
          throw new RangeError(`event ${JSON.stringify(eventId)} failed deterministic admission`);
        }
      }
    }
  }

  async #invokeLifecycle(
    instance: BehaviorInstance,
    handler: NonNullable<RuntimeBehaviorModule['onReload']>,
    operation: string,
  ): Promise<boolean> {
    const timersBefore = [...this.#timers];
    const queueBefore = [...this.#queue];
    try {
      const context = this.#context(instance, 'lifecycle.reloaded', {});
      const commands = await normalizeCommands(handler(context));
      if (commands.length > this.#budgets.maxActionsPerDispatch || !commands.every(isCommand)) {
        throw new RangeError('lifecycle action budget exceeded');
      }
      const nextState = structuredClone(instance.state);
      this.#validateAndApplyCommands(
        instance,
        { sequence: this.#sequence++, eventId: 'lifecycle.reloaded', event: {}, depth: 0 },
        commands,
        nextState,
      );
      if (!this.#fitsStateBudget(instance.loaded.artifact.behaviorId, nextState)) {
        this.#timers.splice(0, this.#timers.length, ...timersBefore);
        this.#queue.splice(0, this.#queue.length, ...queueBefore);
        return false;
      }
      if (
        this.#memoryBytes(undefined, instance.loaded.artifact.behaviorId, nextState) >
        this.#budgets.maxMemoryBytes
      ) {
        throw new RangeError(`runtime memory budget ${this.#budgets.maxMemoryBytes} exceeded`);
      }
      instance.state = nextState;
      return true;
    } catch (error) {
      this.#timers.splice(0, this.#timers.length, ...timersBefore);
      this.#queue.splice(0, this.#queue.length, ...queueBefore);
      this.#report({
        code: 'TBRUNTIME3013',
        severity: 'error',
        behaviorId: instance.loaded.artifact.behaviorId,
        message: `Behavior ${operation} rejected: ${error instanceof Error ? error.message : String(error)}.`,
        suggestion: 'Fix the replacement module; the last-known-good module remains active.',
      });
      return false;
    }
  }

  async #notifyError(instance: BehaviorInstance, message: string): Promise<void> {
    if (!instance.loaded.module.onError) return;
    try {
      const context = this.#context(instance, 'lifecycle.error', {});
      await normalizeCommands(
        instance.loaded.module.onError({
          ...context,
          diagnostic: { code: 'TBRUNTIME3012', message },
        }),
      );
    } catch {
      // Error hooks are diagnostics only and never recurse into another hook.
    }
  }

  #fitsStateBudget(behaviorId: BehaviorId, state: RuntimeBehaviorState): boolean {
    const bytes = jsonBytes(state);
    if (bytes <= this.#budgets.maxStateBytes) return true;
    this.#report({
      code: 'TBRUNTIME3014',
      severity: 'error',
      behaviorId,
      message: `Behavior state uses ${bytes} bytes; limit is ${this.#budgets.maxStateBytes}.`,
      suggestion: 'Store compact durable state and move large immutable data into assets/catalogs.',
      details: { bytes, limit: this.#budgets.maxStateBytes },
    });
    return false;
  }

  #memoryBytes(
    candidate?: QueuedEvent,
    stateOverrideId?: BehaviorId,
    stateOverride?: RuntimeBehaviorState,
  ): number {
    const stateBytes = [...this.#instances.values()].reduce(
      (total, instance) =>
        total +
        jsonBytes(
          stateOverrideId === instance.loaded.artifact.behaviorId && stateOverride
            ? stateOverride
            : instance.state,
        ),
      0,
    );
    return (
      stateBytes +
      jsonBytes(candidate ? [...this.#queue, candidate] : this.#queue) +
      jsonBytes(this.#timers)
    );
  }

  #report(diagnostic: BehaviorRuntimeDiagnostic): void {
    this.#diagnostics.push(diagnostic);
    if (this.#diagnostics.length > this.#budgets.maxDiagnosticEntries) {
      this.#diagnostics.splice(0, this.#diagnostics.length - this.#budgets.maxDiagnosticEntries);
    }
    this.#onDiagnostic?.(diagnostic);
  }
}

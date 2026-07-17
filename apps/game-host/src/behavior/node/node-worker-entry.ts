import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

import type { BehaviorId } from '@tileborne/core';
import {
  DeterministicBehaviorScheduler,
  loadBehaviorModuleNamespace,
  type BehaviorRuntimeBudgets,
  type BehaviorRuntimeDiagnostic,
  type BehaviorSchedulerSnapshot,
  type BehaviorWorkerRequest,
  type BehaviorWorkerResponse,
  type RuntimeBehaviorArtifactIdentity,
  type RuntimeBehaviorContext,
  type RuntimeBehaviorModule,
} from '@tileborne/runtime/behavior';

interface WorkerBootstrapData {
  readonly budgets?: Partial<BehaviorRuntimeBudgets>;
  readonly capabilities?: ReadonlyArray<string>;
  readonly seed?: string;
  readonly ticksPerSecond?: number;
}

interface CompiledModulePayload {
  readonly artifact: RuntimeBehaviorArtifactIdentity;
  readonly code: string;
}

const port = parentPort;
if (!port) throw new Error('behavior worker requires a parentPort');

const bootstrap = (workerData ?? {}) as WorkerBootstrapData;
const scheduler = new DeterministicBehaviorScheduler({
  ...(bootstrap.budgets ? { budgets: bootstrap.budgets } : {}),
  ...(bootstrap.capabilities ? { capabilities: bootstrap.capabilities } : {}),
  ...(bootstrap.seed ? { seed: bootstrap.seed } : {}),
  ...(bootstrap.ticksPerSecond ? { ticksPerSecond: bootstrap.ticksPerSecond } : {}),
});

const diagnostic = (code: string, message: string): BehaviorRuntimeDiagnostic => ({
  code,
  severity: 'error',
  message,
  suggestion: 'Inspect the mapped behavior source; the isolated worker rejected the operation.',
});

const REALM_ADAPTER_SOURCE = `(() => {
  const rngStates = new Map();
  const hashSeed = (value) => {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  return async (module, eventId, inputJson) => {
    const input = JSON.parse(inputJson);
    const state = input.state;
    const capabilities = new Set(input.capabilities);
    let rngState = rngStates.get(module.id) ?? (hashSeed(input.seed + ':' + module.id) || 0x6d2b79f5);
    const nextFloat = () => {
      rngState += 0x6d2b79f5;
      let value = rngState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      rngStates.set(module.id, rngState);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const context = {
      eventId: input.eventId,
      event: input.event,
      state: {
        value: state,
        get: (key) => state[key],
        set: (key, value) => ({ kind: 'state.set', payload: { key, value } }),
      },
      refs: module.refs ?? {},
      query: new Proxy({}, { get: (_target, key) => () => { throw new TypeError('TBRUNTIME3203: query ' + String(key) + ' is unavailable in this isolated host'); } }),
      actions: new Proxy({}, { get: (_target, key) => (...args) => ({ kind: String(key), payload: { arguments: args } }) }),
      clock: input.clock,
      rng: {
        seed: input.seed + ':' + module.id,
        nextFloat,
        integer: (minimum, maximum) => Math.floor(nextFloat() * (maximum - minimum + 1)) + minimum,
        pick: (values) => {
          if (values.length === 0) throw new TypeError('TBRUNTIME3003: rng.pick requires values');
          return values[Math.floor(nextFloat() * values.length)];
        },
      },
      timers: {
        after: (ticks, timerId) => ({ kind: 'timer.after', payload: { ticks, timerId } }),
        every: (ticks, timerId) => ({ kind: 'timer.every', payload: { ticks, timerId } }),
        cancel: (timerId) => ({ kind: 'timer.cancel', payload: { timerId } }),
      },
      capabilities: {
        has: (id) => capabilities.has(id),
        require: (id) => { if (!capabilities.has(id)) throw new TypeError('TBRUNTIME3004: capability ' + JSON.stringify(id) + ' is unavailable'); },
        list: () => [...capabilities].sort(),
      },
      diagnostic: input.diagnostic,
    };
    const handler = eventId === '__start' ? module.onStart
      : eventId === '__stop' ? module.onStop
      : eventId === '__reload' ? module.onReload
      : eventId === '__error' ? module.onError
      : module.on?.[eventId];
    return handler ? await handler(context) : undefined;
  };
})()`;

const wrapCapabilitySafeModule = (
  module: RuntimeBehaviorModule,
  context: vm.Context,
): RuntimeBehaviorModule => {
  const invokeInRealm = new vm.Script(REALM_ADAPTER_SOURCE, {
    filename: 'tileborne-capability-adapter.js',
  }).runInContext(context) as (
    module: RuntimeBehaviorModule,
    eventId: string,
    inputJson: string,
  ) => Promise<unknown>;
  const invoke = (
    eventId: string,
    behaviorContext: RuntimeBehaviorContext,
    diagnosticValue?: { readonly code: string; readonly message: string },
  ) =>
    invokeInRealm(
      module,
      eventId,
      JSON.stringify({
        eventId: behaviorContext.eventId,
        event: behaviorContext.event,
        state: behaviorContext.state.value,
        clock: behaviorContext.clock,
        capabilities: behaviorContext.capabilities.list(),
        seed: bootstrap.seed ?? 'tileborne-behavior-runtime',
        ...(diagnosticValue ? { diagnostic: diagnosticValue } : {}),
      }),
    ) as ReturnType<NonNullable<RuntimeBehaviorModule['onStart']>>;
  const on = Object.fromEntries(
    Object.keys(module.on ?? {}).map((eventId) => [
      eventId,
      (behaviorContext: RuntimeBehaviorContext) => invoke(eventId, behaviorContext),
    ]),
  );
  return {
    id: module.id,
    sourceKind: module.sourceKind,
    state: structuredClone(module.state),
    ...(module.refs ? { refs: structuredClone(module.refs) } : {}),
    ...(module.requiredCapabilities
      ? { requiredCapabilities: structuredClone(module.requiredCapabilities) }
      : {}),
    on,
    ...(module.onStart
      ? {
          onStart: (behaviorContext) =>
            invoke('__start', { ...behaviorContext, eventId: '__start', event: {} }),
        }
      : {}),
    ...(module.onStop
      ? {
          onStop: (behaviorContext) =>
            invoke('__stop', { ...behaviorContext, eventId: '__stop', event: {} }),
        }
      : {}),
    ...(module.onReload
      ? {
          onReload: (behaviorContext) =>
            invoke('__reload', { ...behaviorContext, eventId: '__reload', event: {} }),
        }
      : {}),
    ...(module.onError
      ? {
          onError: (behaviorContext) =>
            invoke(
              '__error',
              { ...behaviorContext, eventId: '__error', event: {} },
              behaviorContext.diagnostic,
            ),
        }
      : {}),
  };
};

const loadModule = async (payload: CompiledModulePayload) => {
  const context = vm.createContext(Object.create(null), {
    name: `tileborne:${payload.artifact.behaviorId}`,
    codeGeneration: { strings: false, wasm: false },
  });
  const sourceModule = new vm.SourceTextModule(payload.code, {
    context,
    identifier: payload.artifact.modulePath,
  });
  await sourceModule.link(async (specifier) => {
    throw new TypeError(
      `TBRUNTIME3201: bundled behavior attempted import ${JSON.stringify(specifier)}`,
    );
  });
  await sourceModule.evaluate({ timeout: 100 });
  const namespace = sourceModule.namespace as unknown as Readonly<Record<string, unknown>>;
  const result = loadBehaviorModuleNamespace({
    artifact: payload.artifact,
    code: payload.code,
    namespace,
  });
  if (!result.ok) throw new TypeError(`${result.diagnostic.code}: ${result.diagnostic.message}`);
  return {
    ...result.loaded,
    module: wrapCapabilitySafeModule(result.loaded.module, context),
  };
};

const responseValue = (value: Readonly<Record<string, unknown>> = {}) => ({
  ...value,
  snapshot: scheduler.snapshot(),
});

const handle = async (request: BehaviorWorkerRequest): Promise<BehaviorWorkerResponse> => {
  const diagnosticStart = scheduler.diagnostics.length;
  try {
    switch (request.operation) {
      case 'load': {
        const loaded = await loadModule(request.payload as CompiledModulePayload);
        if (!scheduler.register(loaded)) throw new TypeError('behavior registration was rejected');
        return { requestId: request.requestId, ok: true, value: responseValue() };
      }
      case 'hot-reload': {
        const loaded = await loadModule(request.payload as CompiledModulePayload);
        if (!(await scheduler.hotReload(loaded)))
          throw new TypeError('behavior hot reload was rejected');
        return { requestId: request.requestId, ok: true, value: responseValue() };
      }
      case 'dispatch': {
        const payload = request.payload as {
          readonly eventId: string;
          readonly event: Readonly<Record<string, unknown>>;
          readonly targetBehaviorId?: BehaviorId;
        };
        const traces = await scheduler.dispatch(payload.eventId, payload.event, {
          ...(payload.targetBehaviorId ? { targetBehaviorId: payload.targetBehaviorId } : {}),
        });
        return {
          requestId: request.requestId,
          ok: true,
          value: responseValue({
            traces,
            diagnostics: scheduler.diagnostics.slice(diagnosticStart),
          }),
        };
      }
      case 'advance': {
        const traces = await scheduler.advanceTo(
          (request.payload as { readonly tick: number }).tick,
        );
        return {
          requestId: request.requestId,
          ok: true,
          value: responseValue({
            traces,
            diagnostics: scheduler.diagnostics.slice(diagnosticStart),
          }),
        };
      }
      case 'cancel': {
        scheduler.cancelBehavior(
          (request.payload as { readonly behaviorId: BehaviorId }).behaviorId,
        );
        return { requestId: request.requestId, ok: true, value: responseValue() };
      }
      case 'snapshot':
        return { requestId: request.requestId, ok: true, value: responseValue() };
      case 'restore-state': {
        if (!scheduler.restore(request.payload as BehaviorSchedulerSnapshot)) {
          throw new TypeError('scheduler snapshot was rejected');
        }
        return { requestId: request.requestId, ok: true, value: responseValue() };
      }
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      ok: false,
      diagnostic: diagnostic(
        'TBRUNTIME3202',
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
};

let requests = Promise.resolve();
port.on('message', (request: BehaviorWorkerRequest) => {
  requests = requests.then(async () => {
    port.postMessage(await handle(request));
  });
});

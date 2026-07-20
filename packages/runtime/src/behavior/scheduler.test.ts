import { hashBytes, type BehaviorId } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import { loadBehaviorModuleNamespace } from './loader.js';
import { DeterministicBehaviorScheduler } from './scheduler.js';
import { AuthoritativeBehaviorRuntimeHost } from './authoritative-host.js';
import type {
  LoadedBehaviorModule,
  RuntimeBehaviorContext,
  RuntimeBehaviorArtifactIdentity,
  RuntimeBehaviorModule,
} from './types.js';
import { BehaviorWorkerSupervisor, type BehaviorWorkerLike } from './worker-supervisor.js';
import {
  buildRuntimeGameShellProjection,
  defaultProjectGameShellState,
} from '../shell/authoring.js';

const A = 'behavior:11111111-1111-4111-8111-111111111111' as BehaviorId;
const B = 'behavior:22222222-2222-4222-8222-222222222222' as BehaviorId;
const encoder = new TextEncoder();

const loaded = (
  behaviorId: BehaviorId,
  module: RuntimeBehaviorModule,
  sourceKind: 'visual' | 'typescript' = 'typescript',
): LoadedBehaviorModule => ({
  artifact: {
    behaviorId,
    sourceKind,
    modulePath: `behaviors/modules/${behaviorId}.mjs`,
    hash: hashBytes(encoder.encode(module.id)),
  },
  module: { ...module, sourceKind },
});

describe('behavior module loader', () => {
  it('accepts hash-matched worker imports and rejects tampered or malformed modules', () => {
    const code = 'export default {}';
    const artifact: RuntimeBehaviorArtifactIdentity = {
      behaviorId: A,
      sourceKind: 'typescript',
      modulePath: 'behaviors/modules/a.mjs',
      hash: hashBytes(encoder.encode(code)),
    };
    expect(
      loadBehaviorModuleNamespace({
        artifact,
        code,
        namespace: {
          default: { id: 'example.a', sourceKind: 'typescript', state: {}, on: {} },
        },
      }).ok,
    ).toBe(true);
    expect(
      loadBehaviorModuleNamespace({
        artifact,
        code: `${code} // tampered`,
        namespace: {
          default: { id: 'example.a', sourceKind: 'typescript', state: {}, on: {} },
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: 'TBRUNTIME3001' } });
  });
});

describe('deterministic behavior scheduler', () => {
  it('orders behaviors, applies state atomically, and produces repeatable random traces', async () => {
    const makeScheduler = () => {
      const scheduler = new DeterministicBehaviorScheduler({
        seed: 'golden',
        budgets: { maxHandlerMs: 1_000 },
      });
      scheduler.register(
        loaded(B, {
          id: 'example.b',
          sourceKind: 'typescript',
          state: { count: 0 },
          on: {
            test: ({ rng, state }) => [
              state.set('count', 1),
              { kind: 'random', payload: { value: rng.integer(1, 100) } },
            ],
          },
        }),
      );
      scheduler.register(
        loaded(A, {
          id: 'example.a',
          sourceKind: 'typescript',
          state: { count: 0 },
          on: {
            test: ({ rng, state }) => [
              state.set('count', 1),
              { kind: 'random', payload: { value: rng.integer(1, 100) } },
            ],
          },
        }),
      );
      return scheduler;
    };
    const first = makeScheduler();
    const second = makeScheduler();
    const firstTrace = await first.dispatch('test', {});
    const secondTrace = await second.dispatch('test', {});
    expect(firstTrace.map((trace) => trace.behaviorId)).toEqual([A, B]);
    expect(firstTrace).toEqual(secondTrace);
    expect(first.stateOf(A)).toEqual({ count: 1 });
  });

  it('schedules and cancels deterministic timers and dispatch queues', async () => {
    const scheduler = new DeterministicBehaviorScheduler({ budgets: { maxHandlerMs: 1_000 } });
    scheduler.register(
      loaded(A, {
        id: 'example.timer',
        sourceKind: 'typescript',
        state: {},
        on: {
          start: ({ timers }) => timers.after(3, 'open'),
          'timer.fired': ({ event }) => ({ kind: 'opened', payload: { timer: event.timerId } }),
        },
      }),
    );
    await scheduler.dispatch('start', {});
    expect(await scheduler.advanceTo(2)).toEqual([]);
    expect((await scheduler.advanceTo(3))[0]?.commands).toEqual([
      { kind: 'opened', payload: { timer: 'open' } },
    ]);

    const controller = new AbortController();
    controller.abort();
    expect(await scheduler.dispatch('start', {}, { signal: controller.signal })).toEqual([]);
    expect(scheduler.diagnostics.at(-1)?.code).toBe('TBRUNTIME3010');
  });

  it('records bounded semantic visual steps without exposing debug commands as actions', async () => {
    const scheduler = new DeterministicBehaviorScheduler({
      budgets: {
        maxHandlerMs: 1_000,
        maxTraceEntries: 2,
        maxDiagnosticEntries: 2,
        maxQueueDepth: 1,
      },
    });
    scheduler.register(
      loaded(
        A,
        {
          id: 'example.visual-debug',
          sourceKind: 'visual',
          state: { count: 0 },
          on: {
            test: ({ state }) => [
              {
                kind: '__tileborne.debug.branch',
                payload: { nodeId: 'node:branch', branch: 'then' },
              },
              {
                kind: '__tileborne.debug.action',
                payload: { nodeId: 'node:action', actionId: 'state.set' },
              },
              state.set('count', 1),
            ],
          },
        },
        'visual',
      ),
    );

    await scheduler.dispatch('test', { run: 1 });
    await scheduler.dispatch('test', { run: 2 });
    const thirdDispatch = await scheduler.dispatch('test', { run: 3 });

    expect(scheduler.traces).toHaveLength(2);
    expect(thirdDispatch).toHaveLength(1);
    expect(scheduler.traces[0]).toMatchObject({
      instanceId: A,
      event: { run: 2 },
      stateBefore: { count: 1 },
      state: { count: 1 },
      commands: [{ kind: 'state.set', payload: { key: 'count', value: 1 } }],
      steps: [
        { kind: 'branch', nodeId: 'node:branch', branch: 'then' },
        { kind: 'action', nodeId: 'node:action', actionId: 'state.set' },
      ],
    });

    scheduler.enqueue('one', {});
    scheduler.enqueue('two', {});
    scheduler.enqueue('three', {});
    scheduler.enqueue('four', {});
    expect(scheduler.diagnostics.length).toBeLessThanOrEqual(2);
  });

  it('rejects TypeScript attempts to spoof reserved visual trace commands', async () => {
    const scheduler = new DeterministicBehaviorScheduler({ budgets: { maxHandlerMs: 1_000 } });
    scheduler.register(
      loaded(A, {
        id: 'example.reserved',
        sourceKind: 'typescript',
        state: {},
        on: {
          test: () => ({
            kind: '__tileborne.debug.action',
            payload: { nodeId: 'spoofed', actionId: 'unsafe' },
          }),
        },
      }),
    );

    expect(await scheduler.dispatch('test', {})).toEqual([]);
    expect(scheduler.diagnostics.at(-1)).toMatchObject({ code: 'TBRUNTIME3012', behaviorId: A });
  });

  it('enforces queue, recursion, action, state, memory, and handler-time budgets', async () => {
    const scheduler = new DeterministicBehaviorScheduler({
      budgets: {
        maxHandlerMs: 5,
        maxQueueDepth: 1,
        maxRecursionDepth: 1,
        maxActionsPerDispatch: 1,
        maxActionsPerTick: 100,
        maxStateBytes: 32,
        maxMemoryBytes: 200,
      },
    });
    scheduler.register(
      loaded(A, {
        id: 'example.budgets',
        sourceKind: 'typescript',
        state: { safe: true },
        on: {
          actions: () => [
            { kind: 'first', payload: {} },
            { kind: 'second', payload: {} },
          ],
          state: ({ state }) => state.set('large', 'x'.repeat(100)),
          recurse: () => ({ kind: 'event.emit', payload: { eventId: 'recurse', event: {} } }),
          slow: async () => await new Promise(() => undefined),
        },
      }),
    );

    expect(scheduler.enqueue('queued', {})).toBe(true);
    expect(scheduler.enqueue('queued', {})).toBe(false);
    await scheduler.drain();
    await scheduler.dispatch('actions', {});
    await scheduler.dispatch('state', {});
    await scheduler.dispatch('recurse', {});
    await scheduler.dispatch('slow', {});
    expect(scheduler.stateOf(A)).toEqual({ safe: true });
    expect(scheduler.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['TBRUNTIME3006', 'TBRUNTIME3005', 'TBRUNTIME3011', 'TBRUNTIME3014']),
    );

    expect(
      scheduler.enqueue('large', { payload: 'x'.repeat(1_000) }, { targetBehaviorId: A }),
    ).toBe(false);
    expect(scheduler.diagnostics.at(-1)?.code).toBe('TBRUNTIME3007');
  });

  it('rolls back a failed hot reload and keeps state plus the last-known-good handler', async () => {
    const scheduler = new DeterministicBehaviorScheduler({ budgets: { maxHandlerMs: 1_000 } });
    scheduler.register(
      loaded(A, {
        id: 'example.stable',
        sourceKind: 'typescript',
        state: { version: 1 },
        on: { read: () => ({ kind: 'version', payload: { value: 1 } }) },
      }),
    );
    const accepted = await scheduler.hotReload(
      loaded(A, {
        id: 'example.broken',
        sourceKind: 'typescript',
        state: { version: 2 },
        on: { read: () => ({ kind: 'version', payload: { value: 2 } }) },
        onReload: () => {
          throw new Error('broken replacement');
        },
      }),
    );
    expect(accepted).toBe(false);
    expect(scheduler.stateOf(A)).toEqual({ version: 1 });
    expect((await scheduler.dispatch('read', {}))[0]?.commands).toEqual([
      { kind: 'version', payload: { value: 1 } },
    ]);
    expect(scheduler.diagnostics.at(-1)?.code).toBe('TBRUNTIME3013');
  });

  it('rolls back state, timers, actions, traces, and callbacks when emitted-event admission fails', async () => {
    const callbacks: Array<string> = [];
    const scheduler = new DeterministicBehaviorScheduler({
      budgets: { maxHandlerMs: 1_000, maxRecursionDepth: 0 },
      onCommand: (command) => callbacks.push(command.kind),
    });
    scheduler.register(
      loaded(A, {
        id: 'example.transaction',
        sourceKind: 'typescript',
        state: { committed: false },
        on: {
          trigger: ({ state, timers }) => [
            state.set('committed', true),
            timers.after(1, 'must-not-fire'),
            { kind: 'visible.action', payload: {} },
            { kind: 'event.emit', payload: { eventId: 'nested', event: {} } },
          ],
          'timer.fired': () => ({ kind: 'timer.leaked', payload: {} }),
          nested: () => ({ kind: 'nested.leaked', payload: {} }),
        },
      }),
    );

    expect(await scheduler.dispatch('trigger', {})).toEqual([]);
    expect(scheduler.stateOf(A)).toEqual({ committed: false });
    expect(scheduler.traces).toEqual([]);
    expect(callbacks).toEqual([]);
    expect(scheduler.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['TBRUNTIME3005', 'TBRUNTIME3012']),
    );
    expect(await scheduler.advanceTo(1)).toEqual([]);
  });

  it('enqueues shell.event from TypeScript shell.emit-event commands and drains shell consumers', async () => {
    const scheduler = new DeterministicBehaviorScheduler({
      capabilities: ['shell.navigation'],
      budgets: { maxHandlerMs: 1_000 },
    });
    scheduler.register(
      loaded(A, {
        id: 'example.shell-emitter',
        sourceKind: 'typescript',
        state: {},
        requiredCapabilities: ['shell.navigation'],
        on: {
          start: ({ actions }) =>
            actions['shell.emit-event']({
              event: 'shell.action.invoked',
              screenId: 'title',
              actionId: 'title.start',
            }),
        },
      }),
    );
    scheduler.register(
      loaded(B, {
        id: 'example.shell-listener',
        sourceKind: 'typescript',
        state: { seen: '' },
        requiredCapabilities: ['shell.navigation'],
        on: {
          'shell.event': ({ event, state }) => state.set('seen', String(event.event)),
        },
      }),
    );

    const traces = await scheduler.dispatch('start', {});

    expect(traces.map((trace) => trace.eventId)).toEqual(['start', 'shell.event']);
    expect(scheduler.stateOf(B)).toEqual({ seen: 'shell.action.invoked' });
  });

  it('rejects shell.emit-event commands with events outside the canonical registry', async () => {
    const scheduler = new DeterministicBehaviorScheduler({
      capabilities: ['shell.navigation'],
      budgets: { maxHandlerMs: 1_000 },
    });
    scheduler.register(
      loaded(A, {
        id: 'example.shell-bad-event',
        sourceKind: 'typescript',
        state: { handled: false },
        requiredCapabilities: ['shell.navigation'],
        on: {
          start: () => ({
            kind: 'shell.emit-event',
            payload: {
              event: 'shell.not-registered',
              screenId: 'title',
            },
          }),
        },
      }),
    );

    expect(await scheduler.dispatch('start', {})).toEqual([]);
    expect(scheduler.diagnostics.at(-1)).toMatchObject({
      code: 'TBRUNTIME3012',
      eventId: 'start',
      message: expect.stringContaining('unknown registered shell event'),
    });
  });

  it('lets visual behaviors consume shell.event emitted by shell action metadata', async () => {
    const scheduler = new DeterministicBehaviorScheduler({
      capabilities: ['shell.navigation'],
      budgets: { maxHandlerMs: 1_000 },
    });
    scheduler.register(
      loaded(
        A,
        {
          id: 'example.visual-shell',
          sourceKind: 'visual',
          state: { route: '' },
          requiredCapabilities: ['shell.navigation'],
          on: {
            'shell.event': ({ event, state }) => [
              {
                kind: '__tileborne.debug.action',
                payload: { nodeId: 'node:shell-event', actionId: 'state.set' },
              },
              state.set('route', String(event.targetScreenId ?? event.screenId)),
            ],
          },
        },
        'visual',
      ),
    );

    const traces = await scheduler.dispatch('shell.event', {
      event: 'shell.navigation.requested',
      screenId: 'title',
      actionId: 'title.start',
      targetScreenId: 'main-menu',
    });

    expect(traces[0]?.steps).toEqual([
      { kind: 'action', nodeId: 'node:shell-event', actionId: 'state.set' },
    ]);
    expect(scheduler.stateOf(A)).toEqual({ route: 'main-menu' });
  });

  it('bridges host shell.invoke-action commands into shell events while navigation stays shell-owned', async () => {
    const navigation: unknown[] = [];
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());
    const host = new AuthoritativeBehaviorRuntimeHost({
      capabilities: ['shell.navigation'],
      budgets: { maxHandlerMs: 1_000 },
      shell: {
        projection,
        onNavigation: (request) => navigation.push(request),
      },
    });
    const code = 'export default {}';
    expect(
      host.load({
        artifact: {
          behaviorId: A,
          sourceKind: 'typescript',
          modulePath: 'behaviors/modules/shell-host.mjs',
          hash: hashBytes(encoder.encode(code)),
        },
        code,
        namespace: {
          default: {
            id: 'example.shell-host',
            sourceKind: 'typescript',
            state: { navigated: false },
            requiredCapabilities: ['shell.navigation'],
            on: {
              start: ({ actions }: RuntimeBehaviorContext) =>
                actions['shell.invoke-action']({ actionId: 'title.start' }),
              'shell.event': ({ state }: RuntimeBehaviorContext) => state.set('navigated', true),
            },
          },
        },
      }),
    ).toBe(true);

    const traces = await host.dispatch('start', {});

    expect(navigation).toEqual([{ type: 'navigate', targetScreenId: 'main-menu' }]);
    expect(traces.map((trace) => trace.eventId)).toEqual(['start', 'shell.event', 'shell.event']);
    expect(traces.slice(1).map((trace) => trace.event.event)).toEqual([
      'shell.action.invoked',
      'shell.navigation.requested',
    ]);
    expect(host.snapshot.states[0]?.state).toEqual({ navigated: true });
  });

  it('diagnoses malformed and unknown shell.invoke-action commands without navigating', async () => {
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());
    const host = new AuthoritativeBehaviorRuntimeHost({
      capabilities: ['shell.navigation'],
      budgets: { maxHandlerMs: 1_000 },
      shell: { projection },
    });
    const code = 'export default {}';
    expect(
      host.load({
        artifact: {
          behaviorId: A,
          sourceKind: 'typescript',
          modulePath: 'behaviors/modules/shell-host-invalid.mjs',
          hash: hashBytes(encoder.encode(code)),
        },
        code,
        namespace: {
          default: {
            id: 'example.shell-host-invalid',
            sourceKind: 'typescript',
            state: {},
            requiredCapabilities: ['shell.navigation'],
            on: {
              start: () => [
                { kind: 'shell.invoke-action', payload: {} },
                { kind: 'shell.invoke-action', payload: { actionId: 'missing.action' } },
              ],
            },
          },
        },
      }),
    ).toBe(true);

    await host.dispatch('start', {});

    expect(host.shellNavigationRequests).toEqual([]);
    expect(host.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TBRUNTIME3020', eventId: 'start' }),
        expect.objectContaining({ code: 'TBRUNTIME3021', eventId: 'start' }),
      ]),
    );
  });
});

class SilentWorker implements BehaviorWorkerLike {
  terminated = false;
  readonly listeners = new Map<string, Set<(event: MessageEvent | ErrorEvent) => void>>();

  postMessage(): void {}

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(
    type: 'message' | 'error',
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: 'message' | 'error',
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }
}

describe('behavior worker supervisor', () => {
  it('terminates unresponsive gameplay workers and creates a responsive replacement boundary', async () => {
    const workers: SilentWorker[] = [];
    const supervisor = new BehaviorWorkerSupervisor(() => {
      const worker = new SilentWorker();
      workers.push(worker);
      return worker;
    }, 2);
    const response = await supervisor.request({
      requestId: 'request-1',
      operation: 'dispatch',
      payload: {},
    });
    expect(response).toMatchObject({ ok: false, diagnostic: { code: 'TBRUNTIME3101' } });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    await supervisor.dispose();
  });
});

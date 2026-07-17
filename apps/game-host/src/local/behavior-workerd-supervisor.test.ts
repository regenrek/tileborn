import { describe, expect, it } from 'vitest';

import {
  LocalBehaviorWorkerdSupervisor,
  type LocalBehaviorRuntimeInstance,
} from './behavior-workerd-supervisor.js';

const never = new Promise<never>(() => undefined);

const withDeadline = async <T>(operation: Promise<T>, durationMs: number): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`operation exceeded outer ${durationMs}ms test deadline`)),
          durationMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

class NeverDisposingRuntime implements LocalBehaviorRuntimeInstance {
  readonly ready = Promise.resolve();
  readonly exited: Promise<void>;
  readonly #response: Promise<Response>;
  #resolveExited: () => void = () => undefined;
  forceKillCount = 0;

  constructor(response: Promise<Response>) {
    this.#response = response;
    this.exited = new Promise<void>((resolve) => {
      this.#resolveExited = resolve;
    });
  }

  dispatch(): Promise<Response> {
    return this.#response;
  }

  dispose(): Promise<void> {
    return never;
  }

  async forceKill(): Promise<void> {
    this.forceKillCount += 1;
    this.#resolveExited();
  }
}

describe('LocalBehaviorWorkerdSupervisor deadlines', () => {
  it('replaces and shuts down runtimes whose dispose promise never resolves', async () => {
    const runtimes: NeverDisposingRuntime[] = [];
    const supervisor = new LocalBehaviorWorkerdSupervisor({
      workerPath: '/unused/behavior-worker.js',
      maxWallTimeMs: 10,
      maxDisposeTimeMs: 10,
      createRuntime: () => {
        const runtime = new NeverDisposingRuntime(
          runtimes.length === 0
            ? never
            : Promise.resolve(
                new Response(
                  JSON.stringify({
                    ok: true,
                    snapshot: {
                      tick: 1,
                      states: [
                        {
                          behaviorId: 'behavior:11111111-1111-4111-8111-111111111111',
                          state: { ticks: 1 },
                        },
                      ],
                    },
                    traces: [],
                    diagnostics: [],
                  }),
                  { status: 200 },
                ),
              ),
        );
        runtimes.push(runtime);
        return runtime;
      },
    });

    const timedOut = await withDeadline(
      supervisor.fetch(new Request('http://behavior.test/execute', { method: 'POST' })),
      250,
    );
    expect(timedOut.status).toBe(503);
    expect(await timedOut.json()).toMatchObject({ code: 'TBRUNTIME3204' });

    const recovered = await withDeadline(
      supervisor.fetch(new Request('http://behavior.test/execute', { method: 'POST' })),
      250,
    );
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ ok: true, snapshot: { tick: 1 } });

    await withDeadline(supervisor.dispose(), 250);
    expect(runtimes).toHaveLength(2);
    expect(runtimes.map((runtime) => runtime.forceKillCount)).toEqual([1, 1]);

    const afterShutdown = await withDeadline(
      supervisor.fetch(new Request('http://behavior.test/execute')),
      250,
    );
    expect(afterShutdown.status).toBe(503);
  });

  it('bounds a force-kill adapter that never settles and surfaces shutdown failure', async () => {
    const runtime: LocalBehaviorRuntimeInstance = {
      ready: Promise.resolve(),
      exited: never,
      dispatch: async () => successResponseForTest(),
      dispose: () => never,
      forceKill: () => never,
    };
    const supervisor = new LocalBehaviorWorkerdSupervisor({
      workerPath: '/unused/behavior-worker.js',
      maxDisposeTimeMs: 10,
      createRuntime: () => runtime,
    });
    await supervisor.warmup();

    await expect(withDeadline(supervisor.dispose(), 1_500)).rejects.toThrow(
      'one or more behavior sidecar process groups failed bounded shutdown',
    );
  });

  it('bounds the fallback force-kill when exit observation and the retry never settle', async () => {
    let forceKillCalls = 0;
    const runtime: LocalBehaviorRuntimeInstance = {
      ready: Promise.resolve(),
      exited: never,
      dispatch: async () => successResponseForTest(),
      dispose: () => never,
      forceKill: () => {
        forceKillCalls += 1;
        return forceKillCalls === 1 ? Promise.resolve() : never;
      },
    };
    const supervisor = new LocalBehaviorWorkerdSupervisor({
      workerPath: '/unused/behavior-worker.js',
      maxDisposeTimeMs: 10,
      createRuntime: () => runtime,
    });
    await supervisor.warmup();

    const disposal = supervisor.dispose();
    expect(supervisor.dispose()).toBe(disposal);
    await expect(withDeadline(disposal, 2_500)).rejects.toMatchObject({
      message: 'one or more behavior sidecar process groups failed bounded shutdown',
      errors: [
        expect.objectContaining({
          message: expect.stringContaining('process tree may still be alive'),
        }),
      ],
    });
    expect(forceKillCalls).toBe(2);
  });
});

const successResponseForTest = (): Response =>
  new Response(
    JSON.stringify({
      ok: true,
      snapshot: {
        tick: 1,
        states: [
          {
            behaviorId: 'behavior:11111111-1111-4111-8111-111111111111',
            state: { ticks: 1 },
          },
        ],
      },
      traces: [],
      diagnostics: [],
    }),
    { status: 200 },
  );

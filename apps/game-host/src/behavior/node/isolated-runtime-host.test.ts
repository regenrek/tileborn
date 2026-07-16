import { hashBytes, type BehaviorId } from '@tileborne/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  NodeIsolatedBehaviorRuntimeHost,
  type IsolatedBehaviorArtifact,
} from './isolated-runtime-host.js';

const TYPESCRIPT_ID = 'behavior:33333333-3333-4333-8333-333333333333' as BehaviorId;
const VISUAL_ID = 'behavior:44444444-4444-4444-8444-444444444444' as BehaviorId;
const SLOW_ID = 'behavior:55555555-5555-4555-8555-555555555555' as BehaviorId;
const MEMORY_ID = 'behavior:66666666-6666-4666-8666-666666666666' as BehaviorId;
const encoder = new TextEncoder();

const hosts: NodeIsolatedBehaviorRuntimeHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(async (host) => await host.dispose()));
});

const responseValue = (
  response: Awaited<ReturnType<NodeIsolatedBehaviorRuntimeHost['dispatch']>>,
) => {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.diagnostic.message);
  return response.value as {
    readonly traces: ReadonlyArray<{
      readonly state: Readonly<Record<string, unknown>>;
      readonly commands: ReadonlyArray<{ readonly kind: string }>;
    }>;
    readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  };
};

const manualModule = (
  behaviorId: BehaviorId,
  id: string,
  handler: string,
  eventId = 'run',
  state = '{}',
): IsolatedBehaviorArtifact => {
  const code = `export default {id:${JSON.stringify(id)},sourceKind:'typescript',state:${state},on:{${JSON.stringify(eventId)}:(context)=>{${handler}}}};`;
  return {
    behaviorId,
    sourceKind: 'typescript',
    modulePath: `behaviors/modules/${id}.mjs`,
    code,
    hash: hashBytes(encoder.encode(code)),
  };
};

const counterModule = (): IsolatedBehaviorArtifact =>
  manualModule(
    TYPESCRIPT_ID,
    'test.isolated-counter',
    `return context.state.set('count', context.state.get('count') + 1);`,
    'increment',
    '{count:0}',
  );

describe('game-host Node isolated behavior runtime host', () => {
  it('executes packaged TypeScript and visual artifacts through the real worker scheduler', async () => {
    const host = new NodeIsolatedBehaviorRuntimeHost({ maxWallTimeMs: 1_000 });
    hosts.push(host);
    const loadedCounter = await host.load(counterModule());
    if (!loadedCounter.ok) throw new Error(JSON.stringify(loadedCounter.diagnostic));
    expect(
      (
        await host.load(
          manualModule(
            VISUAL_ID,
            'test.visual-marker',
            `return context.state.set('seen', true);`,
            'test.mark',
            '{seen:false}',
          ),
        )
      ).ok,
    ).toBe(true);
    expect(
      responseValue(
        await host.dispatch({ eventId: 'increment', event: {}, targetBehaviorId: TYPESCRIPT_ID }),
      ).traces[0]?.state,
    ).toEqual({ count: 1 });
    expect(
      responseValue(
        await host.dispatch({ eventId: 'test.mark', event: {}, targetBehaviorId: VISUAL_ID }),
      ).traces[0]?.state,
    ).toEqual({ seen: true });
  });

  it('disables string code generation even when a precompiled artifact bypasses validation', async () => {
    const host = new NodeIsolatedBehaviorRuntimeHost({ maxWallTimeMs: 1_000 });
    hosts.push(host);
    const escape = manualModule(
      SLOW_ID,
      'test.escape',
      `return {kind:'probe',payload:{value:context.state.get.constructor('return typeof process')()}};`,
    );
    expect((await host.load(escape)).ok).toBe(true);
    const value = responseValue(
      await host.dispatch({ eventId: 'run', event: {}, targetBehaviorId: SLOW_ID }),
    );
    expect(value.traces).toEqual([]);
    expect(value.diagnostics[0]).toMatchObject({ code: 'TBRUNTIME3012' });
    expect(value.diagnostics[0]?.message).toContain('Code generation from strings disallowed');
  });

  it('hard-terminates runaway workers and restores last-known-good modules and state', async () => {
    const host = new NodeIsolatedBehaviorRuntimeHost({ maxWallTimeMs: 200 });
    hosts.push(host);
    expect((await host.load(counterModule())).ok).toBe(true);
    expect(
      responseValue(
        await host.dispatch({ eventId: 'increment', event: {}, targetBehaviorId: TYPESCRIPT_ID }),
      ).traces[0]?.state,
    ).toEqual({ count: 1 });

    expect((await host.load(manualModule(SLOW_ID, 'test.runaway', 'while(true){}'))).ok).toBe(true);
    const timedOut = await host.dispatch({ eventId: 'run', event: {}, targetBehaviorId: SLOW_ID });
    expect(timedOut).toMatchObject({ ok: false, diagnostic: { code: 'TBRUNTIME3101' } });

    const restored = responseValue(
      await host.dispatch({ eventId: 'increment', event: {}, targetBehaviorId: TYPESCRIPT_ID }),
    );
    expect(restored.traces[0]?.state).toEqual({ count: 2 });
  });

  it('contains arbitrary heap growth with the worker resource limit', async () => {
    const host = new NodeIsolatedBehaviorRuntimeHost({
      maxWallTimeMs: 2_000,
      maxOldGenerationSizeMb: 32,
      maxYoungGenerationSizeMb: 8,
    });
    hosts.push(host);
    const memoryBomb = manualModule(
      MEMORY_ID,
      'test.memory-bomb',
      `const values=[]; while(true){ values.push(new Array(100000).fill('xxxxxxxxxxxxxxxx')); }`,
    );
    expect((await host.load(memoryBomb)).ok).toBe(true);
    const response = await host.dispatch({
      eventId: 'run',
      event: {},
      targetBehaviorId: MEMORY_ID,
    });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(['TBRUNTIME3101', 'TBRUNTIME3102']).toContain(response.diagnostic.code);
  });
});

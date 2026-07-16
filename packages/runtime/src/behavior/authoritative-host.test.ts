import { hashBytes, type BehaviorId } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import { AuthoritativeBehaviorRuntimeHost } from './authoritative-host.js';

const encoder = new TextEncoder();
const behaviorId = 'behavior:77777777-7777-4777-8777-777777777777' as BehaviorId;

describe('AuthoritativeBehaviorRuntimeHost', () => {
  it('loads a statically imported packaged module and advances the canonical scheduler', async () => {
    const code = `export default { id: 'test.authoritative', sourceKind: 'typescript', state: { ticks: 0 } };`;
    const host = new AuthoritativeBehaviorRuntimeHost();
    expect(
      host.load({
        artifact: {
          behaviorId,
          sourceKind: 'typescript',
          modulePath: 'behaviors/modules/authoritative.mjs',
          hash: hashBytes(encoder.encode(code)),
        },
        code,
        namespace: {
          default: {
            id: 'test.authoritative',
            sourceKind: 'typescript',
            state: { ticks: 0 },
            on: {
              'runtime.tick': (context: {
                readonly event: Readonly<Record<string, unknown>>;
                readonly state: { set(key: string, value: number): unknown };
              }) => context.state.set('ticks', context.event.tick as number),
            },
          },
        },
      }),
    ).toBe(true);

    expect((await host.step(3))[0]?.state).toEqual({ ticks: 3 });
    expect(host.snapshot).toEqual({ tick: 3, states: [{ behaviorId, state: { ticks: 3 } }] });
    expect(host.restore({ tick: 1, states: [{ behaviorId, state: { ticks: 1 } }] })).toBe(true);
    expect(host.snapshot).toEqual({ tick: 1, states: [{ behaviorId, state: { ticks: 1 } }] });
  });
});

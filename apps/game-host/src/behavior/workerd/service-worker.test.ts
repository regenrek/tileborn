import { type BehaviorId } from '@tileborne/core';
import {
  buildRuntimeGameShellProjection,
  defaultProjectGameShellState,
  type RuntimeBehaviorContext,
} from '@tileborne/runtime';
import { describe, expect, it, vi } from 'vitest';

import { WORKERD_BEHAVIOR_PROTOCOL_VERSION } from './protocol.js';

const behaviorId = 'behavior:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as BehaviorId;
const code = 'export default {}';
const codeHash = 'sha256:9aeb8d59b4d483ca6298e9a450fbf37dfd2b4c63990135ab1d040d76314087ec';

vi.mock('../../.generated/bundled-behaviors.js', () => ({
  bundledBehaviorModules: [
    {
      packageId: 'mappkg:shell-worker',
      artifact: {
        behaviorId,
        sourceKind: 'typescript',
        modulePath: 'behaviors/modules/shell-worker.mjs',
        hash: codeHash,
      },
      code,
      createNamespace: () => ({
        default: {
          id: 'test.shell-worker',
          sourceKind: 'typescript',
          state: { last: '' },
          requiredCapabilities: ['shell.navigation'],
          on: {
            'shell.event': ({ event, state }: RuntimeBehaviorContext) =>
              state.set('last', String(event.event)),
            'runtime.tick': ({ actions }: RuntimeBehaviorContext) =>
              actions['shell.invoke-action']({ actionId: 'title.start' }),
          },
        },
      }),
    },
  ],
}));

describe('workerd behavior service shell bridge', () => {
  it('constructs the real host with shell projection, dispatches queued events, and returns navigation requests', async () => {
    const worker = (await import('./service-worker.js')).default;
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    const response = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection,
            events: [{ event: 'shell.menu.entered', screenId: 'main-menu' }],
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly ok: boolean;
      readonly traces: readonly {
        readonly eventId: string;
        readonly event: Record<string, unknown>;
      }[];
      readonly snapshot: {
        readonly states: readonly { readonly state: Record<string, unknown> }[];
      };
      readonly shellNavigationRequests?: readonly unknown[];
    };
    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(body.shellNavigationRequests).toEqual([
      { type: 'navigate', targetScreenId: 'main-menu' },
    ]);
    expect(body.traces.map((trace) => trace.eventId)).toEqual([
      'shell.event',
      'runtime.tick',
      'shell.event',
      'shell.event',
    ]);
    expect(body.traces.map((trace) => trace.event.event).filter(Boolean)).toEqual([
      'shell.menu.entered',
      'shell.action.invoked',
      'shell.navigation.requested',
    ]);
    expect(body.snapshot.states[0]?.state).toEqual({ last: 'shell.navigation.requested' });
  });

  it('rejects unregistered shell events at ingress', async () => {
    const worker = (await import('./service-worker.js')).default;

    const response = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            events: [{ event: 'shell.unregistered', screenId: 'main-menu' }],
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell event queue',
    });
  });

  it('rejects shell projections with unregistered events or action types at ingress', async () => {
    const worker = (await import('./service-worker.js')).default;
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    const unregisteredEventResponse = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: {
              ...projection,
              registeredEvents: [...projection.registeredEvents, 'shell.unregistered'],
            },
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(unregisteredEventResponse.status).toBe(400);
    await expect(unregisteredEventResponse.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });

    const invalidActionTypeResponse = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: {
              ...projection,
              screens: [
                {
                  ...projection.screens[0]!,
                  actions: [
                    {
                      ...projection.screens[0]!.actions[0]!,
                      type: 'unsupported-action',
                    },
                  ],
                },
                ...projection.screens.slice(1),
              ],
            },
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(invalidActionTypeResponse.status).toBe(400);
    await expect(invalidActionTypeResponse.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });
  });

  it('rejects shell projections with duplicate registered events or ordered screens masking missing required entries', async () => {
    const worker = (await import('./service-worker.js')).default;
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    const duplicateRegisteredEventResponse = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: {
              ...projection,
              registeredEvents: projection.registeredEvents.map((event) =>
                event === 'shell.navigation.requested' ? 'shell.title.entered' : event,
              ),
            },
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(duplicateRegisteredEventResponse.status).toBe(400);
    await expect(duplicateRegisteredEventResponse.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });

    const duplicateScreenOrderResponse = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: {
              ...projection,
              screenOrder: projection.screenOrder.map((screenId) =>
                screenId === 'results' ? 'title' : screenId,
              ),
            },
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(duplicateScreenOrderResponse.status).toBe(400);
    await expect(duplicateScreenOrderResponse.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });
  });

  it('rejects shell projections with duplicate asset ids masking conflicting asset refs at ingress', async () => {
    const worker = (await import('./service-worker.js')).default;
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    const response = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: {
              ...projection,
              assets: [
                {
                  assetId: 'asset:dup',
                  packId: 'pack:ui',
                  packVersion: '1.0.0',
                  path: 'assets/backgrounds/title.png',
                  mime: 'image/png',
                  kind: 'background',
                },
                {
                  assetId: 'asset:dup',
                  packId: 'pack:ui',
                  packVersion: '1.0.0',
                  path: 'assets/backgrounds/alternate.png',
                  mime: 'image/png',
                  kind: 'background',
                },
              ],
            },
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });
  });

  it('rejects shell projections with the wrong schema version at ingress', async () => {
    const worker = (await import('./service-worker.js')).default;
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    const response = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: { ...projection, schemaVersion: 2 },
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });
  });

  it('rejects shell projections missing canonical required fields at ingress', async () => {
    const worker = (await import('./service-worker.js')).default;
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    const missingTokensResponse = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: Object.fromEntries(
              Object.entries(projection).filter(([key]) => key !== 'tokens'),
            ),
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(missingTokensResponse.status).toBe(400);
    await expect(missingTokensResponse.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });

    const missingRequiredScreenResponse = await worker.fetch(
      new Request('https://behavior-runtime.internal/execute', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
          packageId: 'mappkg:shell-worker',
          shell: {
            projection: {
              ...projection,
              screens: projection.screens.filter((screen) => screen.stableId !== 'settings'),
              screenOrder: projection.screenOrder.filter((screenId) => screenId !== 'settings'),
            },
          },
          operation: { kind: 'step', tick: 1, targetBehaviorId: behaviorId },
        }),
      }),
    );

    expect(missingRequiredScreenResponse.status).toBe(400);
    await expect(missingRequiredScreenResponse.json()).resolves.toMatchObject({
      ok: false,
      code: 'TBRUNTIME3201',
      message: 'invalid behavior shell projection',
    });
  });
});

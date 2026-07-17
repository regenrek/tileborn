import { describe, expect, it, vi } from 'vitest';

import { type BehaviorId, type JsonObject } from '@tileborne/core';

import { WorkerdBehaviorRuntimeClient } from './behavior-runtime.js';

const BEHAVIOR_ID = 'behavior:11111111-1111-4111-8111-111111111111' as BehaviorId;
const MAP_PACKAGE = {
  manifest: { packageId: 'package:behavior-runtime-test' },
  behaviors: { modules: [{ behaviorId: BEHAVIOR_ID }] },
} as unknown as JsonObject;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const successResponse = (tick: number): Response =>
  jsonResponse({
    ok: true,
    snapshot: { tick, states: [{ behaviorId: BEHAVIOR_ID, state: { ticks: tick } }] },
    traces: [],
    diagnostics: [],
  });

describe('WorkerdBehaviorRuntimeClient response boundary', () => {
  it('retries a structured cold-start failure and only succeeds with a validated target snapshot', async () => {
    const fetch = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            code: 'TBRUNTIME3204',
            message: 'cold sidecar is still starting',
            retryable: true,
            stage: 'startup',
          },
          503,
        ),
      )
      .mockResolvedValueOnce(successResponse(1));
    const client = new WorkerdBehaviorRuntimeClient({
      binding: { fetch },
      mapPackage: MAP_PACKAGE,
      seed: 'retry-proof',
    });

    const result = await client.step(1);

    expect(result.status).toBe('advanced');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(client.snapshot).toEqual({
      tick: 1,
      states: [{ behaviorId: BEHAVIOR_ID, state: { ticks: 1 } }],
    });
    expect(client.quarantinedBehaviorIds).toEqual(new Set());
  });

  it('never reports success or commits malformed and mismatched snapshots', async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>().mockResolvedValue(
      jsonResponse({
        ok: true,
        snapshot: { tick: 99, states: [] },
        traces: [],
        diagnostics: [],
      }),
    );
    const client = new WorkerdBehaviorRuntimeClient({
      binding: { fetch },
      mapPackage: MAP_PACKAGE,
    });

    const result = await client.step(1);

    expect(result).toMatchObject({
      status: 'failed',
      failures: [{ code: 'TBRUNTIME3205', retryable: true, attempts: 2 }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(client.snapshot).toBeUndefined();
    expect(client.quarantinedBehaviorIds).toEqual(new Set());
    expect(client.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'TBRUNTIME3205', behaviorId: BEHAVIOR_ID }),
    );
  });

  it('does not retry deterministic dispatch failures and quarantines the target', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(
        {
          ok: false,
          code: 'TBRUNTIME3204',
          message: 'behavior exceeded its wall-time budget',
          retryable: false,
          stage: 'dispatch',
        },
        503,
      ),
    );
    const client = new WorkerdBehaviorRuntimeClient({
      binding: { fetch },
      mapPackage: MAP_PACKAGE,
    });

    const result = await client.step(1);

    expect(result).toMatchObject({
      status: 'failed',
      failures: [{ code: 'TBRUNTIME3204', retryable: false, attempts: 1 }],
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(client.snapshot).toBeUndefined();
    expect(client.quarantinedBehaviorIds).toEqual(new Set([BEHAVIOR_ID]));
  });
});

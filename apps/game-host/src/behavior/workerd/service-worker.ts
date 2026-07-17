import type { BehaviorId } from '@tileborne/core';
import {
  AuthoritativeBehaviorRuntimeHost,
  type BehaviorSchedulerSnapshot,
} from '@tileborne/runtime/behavior';

import { bundledBehaviorModules } from '../../.generated/bundled-behaviors.js';
import {
  WORKERD_BEHAVIOR_PROTOCOL_VERSION,
  type WorkerdBehaviorResponse,
  type WorkerdBehaviorStepRequest,
} from './protocol.js';

const json = (body: WorkerdBehaviorResponse, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRequest = (value: unknown): WorkerdBehaviorStepRequest => {
  if (!isRecord(value) || value.protocolVersion !== WORKERD_BEHAVIOR_PROTOCOL_VERSION) {
    throw new TypeError('unsupported behavior execution protocol');
  }
  if (typeof value.packageId !== 'string' || !isRecord(value.operation)) {
    throw new TypeError('invalid behavior execution request');
  }
  const operation = value.operation;
  if (
    operation.kind !== 'step' ||
    !Number.isSafeInteger(operation.tick) ||
    (operation.tick as number) < 0 ||
    typeof operation.targetBehaviorId !== 'string'
  ) {
    throw new TypeError('invalid behavior step operation');
  }
  if (value.seed !== undefined && typeof value.seed !== 'string') {
    throw new TypeError('invalid behavior seed');
  }
  return value as unknown as WorkerdBehaviorStepRequest;
};

const execute = async (input: WorkerdBehaviorStepRequest): Promise<WorkerdBehaviorResponse> => {
  const packaged = bundledBehaviorModules.find(
    (module) =>
      module.packageId === input.packageId &&
      module.artifact.behaviorId === input.operation.targetBehaviorId,
  );
  if (packaged === undefined) {
    return {
      ok: false,
      code: 'TBRUNTIME3202',
      message: `behavior ${input.operation.targetBehaviorId} is not bundled for runtime package ${input.packageId}`,
    };
  }
  const host = new AuthoritativeBehaviorRuntimeHost({
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  });
  if (
    !host.load({
      artifact: packaged.artifact,
      code: packaged.code,
      namespace: packaged.createNamespace(),
    })
  ) {
    return {
      ok: false,
      code: 'TBRUNTIME3202',
      message: `failed to load behavior ${input.operation.targetBehaviorId}`,
    };
  }
  if (input.snapshot !== undefined && !host.restore(input.snapshot as BehaviorSchedulerSnapshot)) {
    return {
      ok: false,
      code: 'TBRUNTIME3203',
      message: 'failed to restore the last-known-good behavior snapshot',
    };
  }
  const timerTraces = await host.advanceTo(input.operation.tick);
  const eventTraces = await host.dispatch(
    'runtime.tick',
    { tick: input.operation.tick },
    input.operation.targetBehaviorId as BehaviorId,
  );
  return {
    ok: true,
    snapshot: host.snapshot,
    traces: [...timerTraces, ...eventTraces],
    diagnostics: host.diagnostics,
  };
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/execute') {
      return new Response('not found', { status: 404 });
    }
    try {
      return json(await execute(parseRequest(await request.json())));
    } catch (error) {
      return json(
        {
          ok: false,
          code: 'TBRUNTIME3201',
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  },
};

import type { BehaviorId, JsonObject } from '@tileborne/core';
import type {
  BehaviorRuntimeDiagnostic,
  BehaviorSchedulerSnapshot,
} from '@tileborne/runtime/behavior';
import type {
  RuntimeGameShellProjection,
  RuntimeShellBehaviorEventPayload,
  RuntimeShellNavigationRequest,
} from '@tileborne/runtime';

import {
  decodeWorkerdBehaviorResponse,
  WORKERD_BEHAVIOR_PROTOCOL_VERSION,
  type WorkerdBehaviorFailureResponse,
  type WorkerdBehaviorSuccessResponse,
  type WorkerdBehaviorStepRequest,
} from './behavior/workerd/protocol.js';
import type { BehaviorRuntimeFetcher } from './types.js';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const packageIdOf = (mapPackage: JsonObject | undefined): string | undefined => {
  const manifest = mapPackage?.manifest;
  if (!isRecord(manifest)) return undefined;
  return typeof manifest.packageId === 'string' ? manifest.packageId : undefined;
};

const behaviorIdsOf = (mapPackage: JsonObject | undefined): ReadonlyArray<BehaviorId> => {
  const behaviors = mapPackage?.behaviors;
  if (!isRecord(behaviors) || !Array.isArray(behaviors.modules)) return [];
  return behaviors.modules.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.behaviorId !== 'string') return [];
    return [candidate.behaviorId as BehaviorId];
  });
};

const MAX_TRANSIENT_ATTEMPTS = 2;

export interface BehaviorRuntimeStepFailure extends WorkerdBehaviorFailureResponse {
  readonly behaviorId: BehaviorId;
  readonly attempts: number;
}

export type BehaviorRuntimeStepResult =
  | { readonly status: 'idle' }
  | {
      readonly status: 'advanced';
      readonly snapshot: BehaviorSchedulerSnapshot;
      readonly advancedBehaviorIds: ReadonlyArray<BehaviorId>;
      readonly failures: ReadonlyArray<BehaviorRuntimeStepFailure>;
      readonly shellNavigationRequests: ReadonlyArray<RuntimeShellNavigationRequest>;
    }
  | { readonly status: 'failed'; readonly failures: ReadonlyArray<BehaviorRuntimeStepFailure> };

export interface AuthoritativeBehaviorRuntimeClient {
  readonly snapshot: BehaviorSchedulerSnapshot | undefined;
  readonly diagnostics: ReadonlyArray<BehaviorRuntimeDiagnostic>;
  readonly shellNavigationRequests: ReadonlyArray<RuntimeShellNavigationRequest>;
  readonly quarantinedBehaviorIds?: ReadonlySet<BehaviorId>;
  emitShellEvent(event: RuntimeShellBehaviorEventPayload): void;
  step(tick: number): Promise<unknown>;
}

export class WorkerdBehaviorRuntimeClient implements AuthoritativeBehaviorRuntimeClient {
  readonly #binding: BehaviorRuntimeFetcher | undefined;
  readonly #packageId: string | undefined;
  readonly #seed: string | undefined;
  readonly #behaviorIds: ReadonlyArray<BehaviorId>;
  readonly #shellProjection: RuntimeGameShellProjection | undefined;
  readonly #quarantined = new Set<BehaviorId>();
  readonly #queuedShellEvents: RuntimeShellBehaviorEventPayload[] = [];
  #shellNavigationRequests: ReadonlyArray<RuntimeShellNavigationRequest> = [];
  #snapshot: BehaviorSchedulerSnapshot | undefined;
  #diagnostics: ReadonlyArray<BehaviorRuntimeDiagnostic> = [];

  constructor(input: {
    readonly binding?: BehaviorRuntimeFetcher;
    readonly mapPackage?: JsonObject;
    readonly seed?: string | number;
    readonly shellProjection?: RuntimeGameShellProjection | undefined;
  }) {
    this.#binding = input.binding;
    this.#packageId = packageIdOf(input.mapPackage);
    this.#seed = input.seed === undefined ? undefined : String(input.seed);
    this.#behaviorIds = behaviorIdsOf(input.mapPackage);
    this.#shellProjection = input.shellProjection;
    if (
      this.#behaviorIds.length > 0 &&
      (this.#binding === undefined || this.#packageId === undefined)
    ) {
      throw new Error('behavior packages require the isolated BEHAVIOR_RUNTIME service binding');
    }
  }

  get snapshot(): BehaviorSchedulerSnapshot | undefined {
    return this.#snapshot === undefined ? undefined : structuredClone(this.#snapshot);
  }

  get diagnostics(): ReadonlyArray<BehaviorRuntimeDiagnostic> {
    return [...this.#diagnostics];
  }

  get shellNavigationRequests(): ReadonlyArray<RuntimeShellNavigationRequest> {
    return [...this.#shellNavigationRequests];
  }

  get quarantinedBehaviorIds(): ReadonlySet<BehaviorId> {
    return new Set(this.#quarantined);
  }

  emitShellEvent(event: RuntimeShellBehaviorEventPayload): void {
    this.#queuedShellEvents.push({ ...event });
  }

  async step(tick: number): Promise<BehaviorRuntimeStepResult> {
    if (
      this.#binding === undefined ||
      this.#packageId === undefined ||
      this.#behaviorIds.length === 0
    ) {
      return { status: 'idle' };
    }
    const failures: BehaviorRuntimeStepFailure[] = [];
    const advancedBehaviorIds: BehaviorId[] = [];
    const diagnostics: BehaviorRuntimeDiagnostic[] = [];
    const shellNavigationRequests: RuntimeShellNavigationRequest[] = [];
    const binding = this.#binding;
    const shellEvents = [...this.#queuedShellEvents];
    for (const behaviorId of this.#behaviorIds) {
      if (this.#quarantined.has(behaviorId)) continue;
      const body: WorkerdBehaviorStepRequest = {
        protocolVersion: WORKERD_BEHAVIOR_PROTOCOL_VERSION,
        packageId: this.#packageId,
        ...(this.#seed === undefined ? {} : { seed: this.#seed }),
        ...this.#snapshotFor(behaviorId),
        ...(this.#shellProjection === undefined && shellEvents.length === 0
          ? {}
          : {
              shell: {
                ...(this.#shellProjection === undefined
                  ? {}
                  : { projection: this.#shellProjection }),
                ...(shellEvents.length === 0 ? {} : { events: shellEvents }),
              },
            }),
        operation: { kind: 'step', tick, targetBehaviorId: behaviorId },
      };
      const result = await this.#executeTarget(binding, body, behaviorId, tick);
      if (!result.ok) {
        failures.push(result);
        diagnostics.push({
          code: result.code,
          severity: 'error',
          message: result.message,
          behaviorId,
          suggestion: result.retryable
            ? 'The isolated runtime will retry this behavior on a later authoritative tick.'
            : 'Inspect or replace this behavior before removing it from quarantine.',
          details: {
            attempts: result.attempts,
            retryable: result.retryable ?? false,
            ...(result.stage === undefined ? {} : { stage: result.stage }),
          },
        });
        if (!result.retryable) this.#quarantined.add(behaviorId);
        continue;
      }
      this.#mergeSnapshot(result.snapshot);
      advancedBehaviorIds.push(behaviorId);
      diagnostics.push(...result.diagnostics);
      shellNavigationRequests.push(...(result.shellNavigationRequests ?? []));
    }
    this.#diagnostics = diagnostics;
    this.#shellNavigationRequests = shellNavigationRequests;
    if (advancedBehaviorIds.length > 0) this.#queuedShellEvents.splice(0);
    if (advancedBehaviorIds.length > 0 && this.#snapshot !== undefined) {
      return {
        status: 'advanced',
        snapshot: structuredClone(this.#snapshot),
        advancedBehaviorIds,
        failures,
        shellNavigationRequests,
      };
    }
    return { status: 'failed', failures };
  }

  async #executeTarget(
    binding: BehaviorRuntimeFetcher,
    body: WorkerdBehaviorStepRequest,
    behaviorId: BehaviorId,
    tick: number,
  ): Promise<
    WorkerdBehaviorSuccessResponse | (BehaviorRuntimeStepFailure & { readonly ok: false })
  > {
    let lastFailure: WorkerdBehaviorFailureResponse = {
      ok: false,
      code: 'TBRUNTIME3204',
      message: 'behavior runtime request did not execute',
      retryable: true,
      stage: 'ipc',
    };
    for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await binding.fetch(
          new Request('https://behavior-runtime.internal/execute', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
      } catch (error) {
        lastFailure = {
          ok: false,
          code: 'TBRUNTIME3204',
          message: `behavior runtime transport failed: ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
          stage: 'ipc',
        };
        if (attempt < MAX_TRANSIENT_ATTEMPTS) continue;
        return { ...lastFailure, behaviorId, attempts: attempt };
      }

      const decoded = decodeWorkerdBehaviorResponse(await response.json().catch(() => undefined));
      if (!decoded.ok) {
        lastFailure = {
          ok: false,
          code: decoded.code,
          message: decoded.message,
          retryable: true,
          stage: 'response-validation',
        };
      } else if (!decoded.value.ok) {
        lastFailure = decoded.value;
      } else if (
        !response.ok ||
        decoded.value.snapshot.tick !== tick ||
        decoded.value.snapshot.states.length !== 1 ||
        decoded.value.snapshot.states[0]?.behaviorId !== behaviorId
      ) {
        lastFailure = {
          ok: false,
          code: 'TBRUNTIME3205',
          message: `behavior runtime returned a mismatched snapshot for ${behaviorId} at tick ${tick}`,
          retryable: true,
          stage: 'response-validation',
        };
      } else {
        return decoded.value;
      }

      if (!lastFailure.retryable || attempt === MAX_TRANSIENT_ATTEMPTS) {
        return { ...lastFailure, behaviorId, attempts: attempt };
      }
    }
    return { ...lastFailure, behaviorId, attempts: MAX_TRANSIENT_ATTEMPTS };
  }

  #snapshotFor(behaviorId: BehaviorId): { readonly snapshot?: BehaviorSchedulerSnapshot } {
    if (this.#snapshot === undefined) return {};
    const state = this.#snapshot.states.find((entry) => entry.behaviorId === behaviorId);
    return state === undefined
      ? {}
      : {
          snapshot: {
            tick: this.#snapshot.tick,
            states: [state],
          },
        };
  }

  #mergeSnapshot(snapshot: BehaviorSchedulerSnapshot): void {
    const states = new Map(
      (this.#snapshot?.states ?? []).map((entry) => [entry.behaviorId, entry] as const),
    );
    for (const entry of snapshot.states) states.set(entry.behaviorId, entry);
    this.#snapshot = {
      tick: snapshot.tick,
      states: [...states.values()].sort((left, right) =>
        String(left.behaviorId).localeCompare(String(right.behaviorId)),
      ),
    };
  }
}

export const createWorkerdBehaviorRuntimeClient = (input: {
  readonly binding?: BehaviorRuntimeFetcher;
  readonly mapPackage?: JsonObject;
  readonly seed?: string | number;
  readonly shellProjection?: RuntimeGameShellProjection | undefined;
}): AuthoritativeBehaviorRuntimeClient => new WorkerdBehaviorRuntimeClient(input);

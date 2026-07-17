import { BehaviorId, isPrefixedId, type JsonValue } from '@tileborne/core';
import type {
  BehaviorExecutionTrace,
  BehaviorRuntimeDiagnostic,
  BehaviorSchedulerSnapshot,
} from '@tileborne/runtime/behavior';

export const WORKERD_BEHAVIOR_PROTOCOL_VERSION = 1 as const;

export interface WorkerdBehaviorStepRequest {
  readonly protocolVersion: typeof WORKERD_BEHAVIOR_PROTOCOL_VERSION;
  readonly packageId: string;
  readonly seed?: string;
  readonly snapshot?: BehaviorSchedulerSnapshot;
  readonly operation: {
    readonly kind: 'step';
    readonly tick: number;
    readonly targetBehaviorId: BehaviorId;
  };
}

export interface WorkerdBehaviorSuccessResponse {
  readonly ok: true;
  readonly snapshot: BehaviorSchedulerSnapshot;
  readonly traces: ReadonlyArray<BehaviorExecutionTrace>;
  readonly diagnostics: ReadonlyArray<BehaviorRuntimeDiagnostic>;
}

export interface WorkerdBehaviorFailureResponse {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  /** Only infrastructure failures before a snapshot commit may be retried. */
  readonly retryable?: boolean;
  readonly stage?: 'startup' | 'dispatch' | 'ipc' | 'response-validation';
}

export type WorkerdBehaviorResponse =
  | WorkerdBehaviorSuccessResponse
  | WorkerdBehaviorFailureResponse;

export type WorkerdBehaviorResponseDecodeResult =
  | { readonly ok: true; readonly value: WorkerdBehaviorResponse }
  | { readonly ok: false; readonly code: 'TBRUNTIME3205'; readonly message: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};

const isSnapshot = (value: unknown): value is BehaviorSchedulerSnapshot =>
  isRecord(value) &&
  Number.isSafeInteger(value.tick) &&
  (value.tick as number) >= 0 &&
  Array.isArray(value.states) &&
  value.states.every(
    (entry) =>
      isRecord(entry) &&
      isPrefixedId(BehaviorId, entry.behaviorId) &&
      isRecord(entry.state) &&
      isJsonValue(entry.state),
  );

const isTrace = (value: unknown): value is BehaviorExecutionTrace =>
  isRecord(value) &&
  Number.isSafeInteger(value.sequence) &&
  (value.sequence as number) >= 0 &&
  Number.isSafeInteger(value.tick) &&
  (value.tick as number) >= 0 &&
  isPrefixedId(BehaviorId, value.behaviorId) &&
  (value.sourceKind === 'typescript' || value.sourceKind === 'visual') &&
  typeof value.eventId === 'string' &&
  isRecord(value.event) &&
  isJsonValue(value.event) &&
  Array.isArray(value.commands) &&
  value.commands.every(
    (command) =>
      isRecord(command) &&
      typeof command.kind === 'string' &&
      isRecord(command.payload) &&
      isJsonValue(command.payload),
  ) &&
  isRecord(value.state) &&
  isJsonValue(value.state);

const isDiagnostic = (value: unknown): value is BehaviorRuntimeDiagnostic =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  (value.severity === 'error' || value.severity === 'warning') &&
  typeof value.message === 'string' &&
  (value.behaviorId === undefined || isPrefixedId(BehaviorId, value.behaviorId)) &&
  (value.eventId === undefined || typeof value.eventId === 'string') &&
  typeof value.suggestion === 'string' &&
  (value.details === undefined || (isRecord(value.details) && isJsonValue(value.details)));

/** Decode the service boundary before any response or snapshot is committed. */
export const decodeWorkerdBehaviorResponse = (
  value: unknown,
): WorkerdBehaviorResponseDecodeResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return { ok: false, code: 'TBRUNTIME3205', message: 'invalid behavior response envelope' };
  }
  if (!value.ok) {
    if (
      typeof value.code !== 'string' ||
      typeof value.message !== 'string' ||
      (value.retryable !== undefined && typeof value.retryable !== 'boolean') ||
      (value.stage !== undefined &&
        !['startup', 'dispatch', 'ipc', 'response-validation'].includes(String(value.stage)))
    ) {
      return { ok: false, code: 'TBRUNTIME3205', message: 'invalid behavior failure response' };
    }
    return { ok: true, value: value as unknown as WorkerdBehaviorFailureResponse };
  }
  if (
    !isSnapshot(value.snapshot) ||
    !Array.isArray(value.traces) ||
    !value.traces.every(isTrace) ||
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every(isDiagnostic)
  ) {
    return {
      ok: false,
      code: 'TBRUNTIME3205',
      message: 'invalid behavior success response or scheduler snapshot',
    };
  }
  return { ok: true, value: value as unknown as WorkerdBehaviorSuccessResponse };
};

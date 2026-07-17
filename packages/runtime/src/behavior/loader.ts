import { hashBytes } from '@tileborne/core';

import type {
  BehaviorRuntimeDiagnostic,
  LoadedBehaviorModule,
  RuntimeBehaviorArtifactIdentity,
  RuntimeBehaviorModule,
} from './types.js';

const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.prototype.toString.call(value) === '[object Object]';

const isSerializable = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isSerializable(item, seen))
    : Object.prototype.toString.call(value) === '[object Object]' &&
      Object.values(value as Record<string, unknown>).every((item) => isSerializable(item, seen));
  seen.delete(value);
  return valid;
};

export type BehaviorModuleLoadResult =
  | { readonly ok: true; readonly loaded: LoadedBehaviorModule }
  | { readonly ok: false; readonly diagnostic: BehaviorRuntimeDiagnostic };

/**
 * Validates an already imported ESM namespace inside the authoritative game worker.
 * Import policy stays with the compiler/host; this boundary never evaluates source text.
 */
export const loadBehaviorModuleNamespace = (input: {
  readonly artifact: RuntimeBehaviorArtifactIdentity;
  readonly code: string;
  readonly namespace: Readonly<Record<string, unknown>>;
}): BehaviorModuleLoadResult => {
  const actualHash = hashBytes(encoder.encode(input.code));
  if (actualHash !== input.artifact.hash) {
    return {
      ok: false,
      diagnostic: {
        code: 'TBRUNTIME3001',
        severity: 'error',
        behaviorId: input.artifact.behaviorId,
        message: `Behavior module hash mismatch for ${input.artifact.modulePath}.`,
        suggestion: 'Rebuild the project; the last-known-good behavior remains active.',
        details: { expected: input.artifact.hash, actual: actualHash },
      },
    };
  }
  const candidate = input.namespace.default;
  if (
    !isRecord(candidate) ||
    typeof candidate.id !== 'string' ||
    candidate.sourceKind !== input.artifact.sourceKind ||
    !isRecord(candidate.state) ||
    !isSerializable(candidate.state) ||
    (candidate.on !== undefined && !isRecord(candidate.on))
  ) {
    return {
      ok: false,
      diagnostic: {
        code: 'TBRUNTIME3002',
        severity: 'error',
        behaviorId: input.artifact.behaviorId,
        message: `Default export from ${input.artifact.modulePath} is not a valid BehaviorModule.`,
        suggestion: 'Export exactly one defineBehavior(...) result or rebuild the visual behavior.',
      },
    };
  }
  if (
    candidate.on &&
    Object.values(candidate.on).some((handler) => typeof handler !== 'function')
  ) {
    return {
      ok: false,
      diagnostic: {
        code: 'TBRUNTIME3002',
        severity: 'error',
        behaviorId: input.artifact.behaviorId,
        message: `Behavior ${candidate.id} contains a non-callable event handler.`,
        suggestion: 'Define each on[eventId] entry as a function and rebuild.',
      },
    };
  }
  return {
    ok: true,
    loaded: {
      artifact: input.artifact,
      module: candidate as unknown as RuntimeBehaviorModule,
    },
  };
};

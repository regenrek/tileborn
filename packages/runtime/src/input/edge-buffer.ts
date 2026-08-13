export type RuntimeInputEdgeField<TInput extends object = object> = Extract<keyof TInput, string>;

export interface PendingRuntimeInputEdges<TInput extends object = object> {
  readonly version: number;
  readonly values: Readonly<Partial<TInput>>;
  readonly fieldVersions: Readonly<Partial<Record<RuntimeInputEdgeField<TInput>, number>>>;
  readonly revisions: readonly RuntimeInputEdgeRevision<TInput>[];
}

export interface RuntimeInputEdgeRevision<TInput extends object = object> {
  readonly version: number;
  readonly values: Readonly<Partial<TInput>>;
}

export interface RuntimeInputEdgeAcknowledgement<TInput extends object = object> {
  readonly versionsByPlayerId: ReadonlyMap<
    string,
    {
      readonly version: number;
      readonly fieldVersions: Readonly<Partial<Record<RuntimeInputEdgeField<TInput>, number>>>;
    }
  >;
}

export interface RuntimeInputEdgeTransport<TInput extends object = object> {
  readonly set: (playerId: string, input: TInput) => TInput;
  readonly get: (playerId: string) => TInput | undefined;
  readonly delete: (playerId: string) => void;
  readonly capturePendingAcknowledgement: () => RuntimeInputEdgeAcknowledgement<TInput>;
  readonly acknowledgePending: (acknowledgement: RuntimeInputEdgeAcknowledgement<TInput>) => void;
}

export interface RuntimeInputEdgeTransportOptions<TInput extends object = object> {
  readonly heldBooleanFields?: () => readonly RuntimeInputEdgeField<TInput>[];
}

const hasEdgeValue = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return value !== undefined;
};

const mergeEdgeValue = (current: unknown, next: unknown): unknown => {
  if (Array.isArray(current) || Array.isArray(next)) {
    return [
      ...new Set([
        ...(Array.isArray(current) ? current : []),
        ...(Array.isArray(next) ? next : []),
      ]),
    ];
  }
  if (typeof current === 'boolean' || typeof next === 'boolean') {
    return Boolean(current) || Boolean(next);
  }
  return next === undefined ? current : next;
};

const readField = <TInput extends object>(
  input: TInput | Partial<TInput>,
  field: RuntimeInputEdgeField<TInput>,
): unknown => (input as Record<string, unknown>)[field];

const writeField = <TInput extends object>(
  input: Record<string, unknown>,
  field: RuntimeInputEdgeField<TInput>,
  value: unknown,
): void => {
  input[field] = value;
};

export const hasRuntimeInputEdges = <TInput extends object>(
  input: TInput,
  edgeFields: readonly RuntimeInputEdgeField<TInput>[],
): boolean => edgeFields.some((field) => hasEdgeValue(readField(input, field)));

export const mergeRuntimeInputEdges = <TInput extends object>(
  current: PendingRuntimeInputEdges<TInput> | undefined,
  input: TInput,
  edgeFields: readonly RuntimeInputEdgeField<TInput>[],
): PendingRuntimeInputEdges<TInput> => {
  const values: Partial<TInput> = { ...(current?.values ?? {}) };
  const version = (current?.version ?? 0) + 1;
  const fieldVersions: Partial<Record<RuntimeInputEdgeField<TInput>, number>> = {
    ...(current?.fieldVersions ?? {}),
  };
  const revisionValues: Partial<TInput> = {};
  for (const field of edgeFields) {
    const value = readField(input, field);
    if (!hasEdgeValue(value)) {
      continue;
    }
    (revisionValues as Record<string, unknown>)[field] = value;
    (values as Record<string, unknown>)[field] = mergeEdgeValue(readField(values, field), value);
    fieldVersions[field] = version;
  }
  return Object.freeze({
    version,
    values,
    fieldVersions,
    revisions: Object.freeze([
      ...(current?.revisions ?? []),
      Object.freeze({ version, values: Object.freeze(revisionValues) }),
    ]),
  });
};

const buildRuntimeInputEdgesFromRevisions = <TInput extends object>(
  version: number,
  revisions: readonly RuntimeInputEdgeRevision<TInput>[],
  edgeFields: readonly RuntimeInputEdgeField<TInput>[],
): PendingRuntimeInputEdges<TInput> | undefined => {
  if (revisions.length === 0) {
    return undefined;
  }

  const values: Partial<TInput> = {};
  const fieldVersions: Partial<Record<RuntimeInputEdgeField<TInput>, number>> = {};
  for (const revision of revisions) {
    for (const field of edgeFields) {
      const value = readField(revision.values, field);
      if (!hasEdgeValue(value)) {
        continue;
      }
      (values as Record<string, unknown>)[field] = mergeEdgeValue(readField(values, field), value);
      fieldVersions[field] = revision.version;
    }
  }

  return Object.keys(values).length
    ? Object.freeze({
        version,
        values,
        fieldVersions,
        revisions: Object.freeze([...revisions]),
      })
    : undefined;
};

export const applyRuntimeInputEdges = <TInput extends object>(
  input: TInput,
  pending: PendingRuntimeInputEdges<TInput> | undefined,
  edgeFields: readonly RuntimeInputEdgeField<TInput>[],
): TInput => {
  if (pending === undefined) {
    return input;
  }
  const next = { ...input } as Record<string, unknown>;
  for (const field of edgeFields) {
    writeField(
      next,
      field,
      mergeEdgeValue(readField(pending.values, field), readField(input, field)),
    );
  }
  return next as TInput;
};

export const clearRuntimeInputEdges = <TInput extends object>(
  input: TInput,
  edgeFields: readonly RuntimeInputEdgeField<TInput>[],
): TInput => {
  const next = { ...input } as Record<string, unknown>;
  for (const field of edgeFields) {
    const value = readField(input, field);
    if (Array.isArray(value)) {
      next[field] = [];
    } else if (typeof value === 'boolean') {
      next[field] = false;
    } else {
      delete next[field];
    }
  }
  return next as TInput;
};

const clearAcknowledgedRuntimeInputEdges = <TInput extends object>(
  input: TInput,
  edgeFields: readonly RuntimeInputEdgeField<TInput>[],
  heldBooleanFields: readonly RuntimeInputEdgeField<TInput>[],
): TInput => {
  const heldBooleanFieldSet = new Set<RuntimeInputEdgeField<TInput>>(heldBooleanFields);
  const next = { ...input } as Record<string, unknown>;
  for (const field of edgeFields) {
    const value = readField(input, field);
    if (Array.isArray(value)) {
      next[field] = [];
    } else if (typeof value === 'boolean') {
      if (!heldBooleanFieldSet.has(field)) {
        next[field] = false;
      }
    } else {
      delete next[field];
    }
  }
  return next as TInput;
};

const suppressRepeatedOneShotBooleanEdges = <TInput extends object>(
  input: TInput,
  edgeFields: readonly RuntimeInputEdgeField<TInput>[],
  heldBooleanFields: readonly RuntimeInputEdgeField<TInput>[],
  rawBooleanEdgeState: Map<RuntimeInputEdgeField<TInput>, boolean>,
): TInput => {
  const heldBooleanFieldSet = new Set<RuntimeInputEdgeField<TInput>>(heldBooleanFields);
  let next: Record<string, unknown> | undefined;

  for (const field of edgeFields) {
    if (heldBooleanFieldSet.has(field)) {
      continue;
    }

    const value = readField(input, field);
    if (typeof value === 'boolean') {
      const wasHeld = rawBooleanEdgeState.get(field) === true;
      rawBooleanEdgeState.set(field, value);
      if (value && wasHeld) {
        if (next === undefined) {
          next = { ...(input as Record<string, unknown>) };
        }
        next[field] = false;
      }
    } else if (value === undefined && rawBooleanEdgeState.has(field)) {
      rawBooleanEdgeState.set(field, false);
    }
  }

  return (next ?? input) as TInput;
};

export const createRuntimeInputEdgeTransport = <TInput extends object>(
  edgeFields: () => readonly RuntimeInputEdgeField<TInput>[],
  options: RuntimeInputEdgeTransportOptions<TInput> = {},
): RuntimeInputEdgeTransport<TInput> => {
  const baseInputByPlayerId = new Map<string, TInput>();
  const pendingInputEdgesByPlayerId = new Map<string, PendingRuntimeInputEdges<TInput>>();
  const rawBooleanEdgeStateByPlayerId = new Map<
    string,
    Map<RuntimeInputEdgeField<TInput>, boolean>
  >();

  const resolveInput = (playerId: string, input: TInput): TInput =>
    applyRuntimeInputEdges(input, pendingInputEdgesByPlayerId.get(playerId), edgeFields());

  return {
    set: (playerId, input) => {
      const fields = edgeFields();
      const rawBooleanEdgeState =
        rawBooleanEdgeStateByPlayerId.get(playerId) ??
        new Map<RuntimeInputEdgeField<TInput>, boolean>();
      rawBooleanEdgeStateByPlayerId.set(playerId, rawBooleanEdgeState);
      const bufferedInput = suppressRepeatedOneShotBooleanEdges(
        input,
        fields,
        options.heldBooleanFields?.() ?? [],
        rawBooleanEdgeState,
      );
      if (hasRuntimeInputEdges(bufferedInput, fields)) {
        pendingInputEdgesByPlayerId.set(
          playerId,
          mergeRuntimeInputEdges(pendingInputEdgesByPlayerId.get(playerId), bufferedInput, fields),
        );
      }
      baseInputByPlayerId.set(playerId, bufferedInput);
      const resolvedInput = applyRuntimeInputEdges(
        bufferedInput,
        pendingInputEdgesByPlayerId.get(playerId),
        fields,
      );
      return resolvedInput;
    },
    get: (playerId) => {
      const input = baseInputByPlayerId.get(playerId);
      return input === undefined ? undefined : resolveInput(playerId, input);
    },
    delete: (playerId) => {
      baseInputByPlayerId.delete(playerId);
      pendingInputEdgesByPlayerId.delete(playerId);
      rawBooleanEdgeStateByPlayerId.delete(playerId);
    },
    capturePendingAcknowledgement: () =>
      Object.freeze({
        versionsByPlayerId: new Map(
          [...pendingInputEdgesByPlayerId.entries()].map(([playerId, pending]) => [
            playerId,
            {
              version: pending.version,
              fieldVersions: Object.freeze({ ...pending.fieldVersions }),
            },
          ]),
        ),
      }),
    acknowledgePending: (acknowledgement) => {
      for (const [playerId, acknowledged] of acknowledgement.versionsByPlayerId) {
        const pending = pendingInputEdgesByPlayerId.get(playerId);
        if (pending === undefined) {
          continue;
        }
        const fields = edgeFields();
        if (pending.version === acknowledged.version) {
          pendingInputEdgesByPlayerId.delete(playerId);
          const currentInput = baseInputByPlayerId.get(playerId);
          if (currentInput !== undefined) {
            baseInputByPlayerId.set(
              playerId,
              clearAcknowledgedRuntimeInputEdges(
                currentInput,
                fields,
                options.heldBooleanFields?.() ?? [],
              ),
            );
          }
          continue;
        }

        const retainedPending = buildRuntimeInputEdgesFromRevisions(
          pending.version,
          pending.revisions.filter((revision) => revision.version > acknowledged.version),
          fields,
        );
        if (retainedPending === undefined) {
          pendingInputEdgesByPlayerId.delete(playerId);
        } else {
          pendingInputEdgesByPlayerId.set(playerId, retainedPending);
        }
        const currentInput = baseInputByPlayerId.get(playerId);
        if (currentInput !== undefined) {
          baseInputByPlayerId.set(
            playerId,
            clearAcknowledgedRuntimeInputEdges(
              currentInput,
              fields,
              options.heldBooleanFields?.() ?? [],
            ),
          );
        }
      }
    },
  };
};

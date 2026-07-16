import {
  BehaviorDefinition,
  BehaviorActionNode,
  BehaviorCapabilityId,
  BehaviorCondition,
  BehaviorInvocation,
  BehaviorStateField,
  EventFieldBehaviorValue,
  LiteralBehaviorValue,
  ReferenceBehaviorValue,
  StateBehaviorValue,
  makeBehaviorNodeId,
  type BehaviorId,
  type BehaviorNodeId,
  type BehaviorParameterMetadata,
  type BehaviorReference,
  type BehaviorRegistryEntry,
  type BehaviorRegistryEntryKind,
  type BehaviorRegistryManifest,
  type BehaviorTemplate,
  type BehaviorValueExpression,
  type JsonValue,
  type Uuid,
} from '@tileborne/core';
import { Schema } from 'effect';

export interface VisualBehaviorDraft {
  readonly label: string;
  readonly state: readonly BehaviorStateField[];
  readonly when: BehaviorInvocation;
  readonly if?: BehaviorCondition | undefined;
  readonly do: readonly BehaviorActionNode[];
  readonly requiredCapabilities: readonly BehaviorCapabilityId[];
}

const VisualBehaviorDraftSchema = Schema.Struct({
  label: Schema.String,
  state: Schema.Array(BehaviorStateField),
  when: BehaviorInvocation,
  if: Schema.optional(BehaviorCondition),
  do: Schema.Array(BehaviorActionNode),
  requiredCapabilities: Schema.Array(BehaviorCapabilityId),
});

export const decodeVisualBehaviorDraft = (value: unknown): VisualBehaviorDraft =>
  Schema.decodeUnknownSync(VisualBehaviorDraftSchema)(value);

export interface BehaviorEditorIssue {
  readonly path: string;
  readonly message: string;
  readonly nodeId?: BehaviorNodeId | undefined;
}

export type BehaviorReferenceIndex = Partial<
  Record<BehaviorReference['_tag'], ReadonlySet<string>>
>;

export const freshBehaviorNodeId = (): BehaviorNodeId =>
  makeBehaviorNodeId(crypto.randomUUID() as Uuid);

const defaultLiteral = (parameter: BehaviorParameterMetadata): JsonValue => {
  if (parameter.defaultValue !== undefined) return parameter.defaultValue;
  switch (parameter.valueKind) {
    case 'boolean': return false;
    case 'number': return 0;
    case 'string': return '';
    case 'json': return null;
    case 'entity-reference':
    case 'asset-reference':
    case 'catalog-reference':
    case 'behavior-reference':
      return '';
  }
};

const referenceTag = (
  kind: BehaviorParameterMetadata['valueKind'],
): BehaviorReference['_tag'] | undefined => {
  switch (kind) {
    case 'entity-reference': return 'entity';
    case 'asset-reference': return 'asset';
    case 'catalog-reference': return 'catalog';
    case 'behavior-reference': return 'behavior';
    default: return undefined;
  }
};

export const expressionForParameter = (
  parameter: BehaviorParameterMetadata,
  references: Partial<Record<BehaviorReference['_tag'], readonly BehaviorReference[]>> = {},
): BehaviorValueExpression => {
  const tag = referenceTag(parameter.valueKind);
  const reference = tag === undefined ? undefined : references[tag]?.[0];
  return reference === undefined
    ? new LiteralBehaviorValue({ value: defaultLiteral(parameter) })
    : new ReferenceBehaviorValue({ reference });
};

export const invocationForEntry = (
  entry: BehaviorRegistryEntry,
  literalOverrides: Readonly<Record<string, JsonValue>> = {},
  references: Partial<Record<BehaviorReference['_tag'], readonly BehaviorReference[]>> = {},
): BehaviorInvocation =>
  new BehaviorInvocation({
    entryId: entry.id,
    arguments: Object.fromEntries(
      entry.inputs.flatMap((parameter) => {
        const hasOverride = Object.prototype.hasOwnProperty.call(literalOverrides, parameter.key);
        // An absent optional input is meaningful runtime semantics (for example,
        // "any eliminated player"). Available picker options must never turn it
        // into an arbitrary concrete project reference.
        if (!parameter.required && !hasOverride && parameter.defaultValue === undefined) return [];
        return [[parameter.key, hasOverride
          ? new LiteralBehaviorValue({ value: literalOverrides[parameter.key]! })
          : expressionForParameter(parameter, references)] as const];
      }),
    ),
  });

export const instantiateBehaviorTemplate = (
  template: BehaviorTemplate,
  registry: BehaviorRegistryManifest,
  references: Partial<Record<BehaviorReference['_tag'], readonly BehaviorReference[]>> = {},
): VisualBehaviorDraft => {
  const entries = new Map(registry.entries.map((entry) => [String(entry.id), entry]));
  const invocation = (value: BehaviorTemplate['when']): BehaviorInvocation => {
    const entry = entries.get(String(value.entryId));
    if (entry === undefined) throw new Error(`Template block is unavailable: ${value.entryId}`);
    return invocationForEntry(entry, value.arguments, references);
  };
  const conditions = (template.if ?? []).map(
    (item): BehaviorCondition => ({
      _tag: 'condition',
      nodeId: freshBehaviorNodeId(),
      invocation: invocation(item),
    }),
  );
  const rootCondition: BehaviorCondition | undefined = conditions.length === 0
    ? undefined
    : conditions.length === 1
      ? conditions[0]
      : { _tag: 'all', nodeId: freshBehaviorNodeId(), conditions };
  return {
    label: template.label,
    state: [],
    when: invocation(template.when),
    ...(rootCondition === undefined ? {} : { if: rootCondition }),
    do: template.do.map((item) => ({
      _tag: 'action' as const,
      nodeId: freshBehaviorNodeId(),
      invocation: invocation(item),
    })),
    requiredCapabilities: [...template.requiredCapabilities],
  };
};

export const createBlankBehaviorDraft = (
  registry: BehaviorRegistryManifest,
): VisualBehaviorDraft => {
  const event = registry.entries.find(({ kind }) => kind === 'event');
  if (event === undefined) throw new Error('No event capability is available for this project.');
  return {
    label: 'New behavior',
    state: [],
    when: invocationForEntry(event),
    do: [],
    requiredCapabilities: [event.capability],
  };
};

export const toBehaviorDefinition = (
  id: BehaviorId,
  draft: VisualBehaviorDraft,
): BehaviorDefinition =>
  new BehaviorDefinition({
    schemaVersion: 1,
    id,
    label: draft.label,
    state: [...draft.state],
    when: draft.when,
    ...(draft.if === undefined ? {} : { if: draft.if }),
    do: [...draft.do],
  });

export const fromBehaviorDefinition = (
  definition: BehaviorDefinition,
  requiredCapabilities: readonly BehaviorCapabilityId[],
): VisualBehaviorDraft => ({
  label: definition.label,
  state: [...definition.state],
  when: definition.when,
  ...(definition.if === undefined ? {} : { if: definition.if }),
  do: [...definition.do],
  requiredCapabilities: [...requiredCapabilities],
});

const expressionMatchesParameter = (
  expression: BehaviorValueExpression,
  parameter: BehaviorParameterMetadata,
  stateKeys: ReadonlySet<string>,
  references: BehaviorReferenceIndex,
): string | undefined => {
  if (expression._tag === 'state') {
    return stateKeys.has(expression.key) ? undefined : `Unknown local state field “${expression.key}”`;
  }
  if (expression._tag === 'event-field') {
    return expression.path.trim().length > 0 ? undefined : 'Event field path cannot be empty';
  }
  const expectedReference = referenceTag(parameter.valueKind);
  if (expression._tag === 'reference') {
    if (expectedReference === undefined) return `${parameter.label} does not accept a reference`;
    if (expression.reference._tag !== expectedReference) {
      return `${parameter.label} requires a ${expectedReference} reference`;
    }
    const id = expression.reference._tag === 'entity' ? expression.reference.objectId
      : expression.reference._tag === 'asset' ? expression.reference.assetId
        : expression.reference._tag === 'catalog' ? expression.reference.objectTypeId
          : expression.reference.behaviorId;
    return typeof id === 'string' && references[expectedReference]?.has(id) === false
      ? `${parameter.label} points to a missing ${expectedReference}`
      : undefined;
  }
  const value = expression.value;
  switch (parameter.valueKind) {
    case 'boolean': return typeof value === 'boolean' ? undefined : `${parameter.label} must be true or false`;
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? undefined : `${parameter.label} must be a number`;
    case 'string': return typeof value === 'string' ? undefined : `${parameter.label} must be text`;
    case 'json': return undefined;
    default: return `${parameter.label} requires a reference`;
  }
};

export const validateBehaviorDraft = (
  draft: VisualBehaviorDraft,
  registry: BehaviorRegistryManifest,
  references: BehaviorReferenceIndex = {},
): readonly BehaviorEditorIssue[] => {
  const issues: BehaviorEditorIssue[] = [];
  const entries = new Map(registry.entries.map((entry) => [String(entry.id), entry]));
  const stateKeys = new Set<string>();
  const nodeIds = new Set<string>();
  if (draft.label.trim().length === 0) issues.push({ path: 'label', message: 'Behavior name is required' });
  draft.state.forEach((field, index) => {
    const key = field.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      issues.push({ path: `state.${index}.key`, message: 'State keys use letters, numbers, _ or -' });
    }
    if (stateKeys.has(key)) issues.push({ path: `state.${index}.key`, message: `Duplicate state field “${key}”` });
    stateKeys.add(key);
  });
  const inspectInvocation = (
    invocation: BehaviorInvocation,
    expected: BehaviorRegistryEntryKind,
    path: string,
    nodeId?: BehaviorNodeId,
  ): void => {
    const entry = entries.get(String(invocation.entryId));
    if (entry === undefined) {
      issues.push({ path, message: `Unavailable block: ${invocation.entryId}`, nodeId });
      return;
    }
    if (entry.kind !== expected) {
      issues.push({ path, message: `${entry.label} is not a ${expected} block`, nodeId });
    }
    for (const parameter of entry.inputs) {
      const expression = invocation.arguments[parameter.key];
      if (expression === undefined) {
        if (parameter.required) issues.push({ path: `${path}.${parameter.key}`, message: `${parameter.label} is required`, nodeId });
        continue;
      }
      const message = expressionMatchesParameter(expression, parameter, stateKeys, references);
      if (message !== undefined) issues.push({ path: `${path}.${parameter.key}`, message, nodeId });
    }
  };
  const rememberNode = (nodeId: BehaviorNodeId, path: string): void => {
    if (nodeIds.has(String(nodeId))) issues.push({ path, message: 'Duplicate block identity', nodeId });
    nodeIds.add(String(nodeId));
  };
  const inspectCondition = (condition: BehaviorCondition, path: string): void => {
    rememberNode(condition.nodeId, path);
    if (condition._tag === 'condition') return inspectInvocation(condition.invocation, 'condition', path, condition.nodeId);
    if (condition._tag === 'not') return inspectCondition(condition.condition, `${path}.not`);
    if (condition.conditions.length === 0) issues.push({ path, message: `${condition._tag.toUpperCase()} needs at least one condition`, nodeId: condition.nodeId });
    condition.conditions.forEach((nested, index) => inspectCondition(nested, `${path}.${index}`));
  };
  const inspectActions = (actions: readonly BehaviorActionNode[], path: string): void => {
    actions.forEach((action, index) => {
      const itemPath = `${path}.${index}`;
      rememberNode(action.nodeId, itemPath);
      if (action._tag === 'action') inspectInvocation(action.invocation, 'action', itemPath, action.nodeId);
      else {
        inspectCondition(action.condition, `${itemPath}.if`);
        inspectActions(action.then, `${itemPath}.then`);
        inspectActions(action.else ?? [], `${itemPath}.else`);
      }
    });
  };
  inspectInvocation(draft.when, 'event', 'when');
  if (draft.if !== undefined) inspectCondition(draft.if, 'if');
  inspectActions(draft.do, 'do');
  return issues;
};

export const requiredCapabilitiesForDraft = (
  draft: VisualBehaviorDraft,
  registry: BehaviorRegistryManifest,
): readonly BehaviorCapabilityId[] => {
  const entries = new Map(registry.entries.map((entry) => [String(entry.id), entry]));
  const capabilities = new Set<BehaviorCapabilityId>(draft.requiredCapabilities);
  const add = (invocation: BehaviorInvocation): void => {
    const capability = entries.get(String(invocation.entryId))?.capability;
    if (capability !== undefined) capabilities.add(capability);
  };
  const condition = (value: BehaviorCondition): void => {
    if (value._tag === 'condition') add(value.invocation);
    else if (value._tag === 'not') condition(value.condition);
    else value.conditions.forEach(condition);
  };
  const actions = (values: readonly BehaviorActionNode[]): void => values.forEach((value) => {
    if (value._tag === 'action') add(value.invocation);
    else {
      condition(value.condition);
      actions(value.then);
      actions(value.else ?? []);
    }
  });
  add(draft.when);
  if (draft.if !== undefined) condition(draft.if);
  actions(draft.do);
  return [...capabilities].sort((left, right) => String(left).localeCompare(String(right)));
};

export const behaviorReferencesForDraft = (
  draft: VisualBehaviorDraft,
): readonly BehaviorReference[] => {
  const references = new Map<string, BehaviorReference>();
  const addInvocation = (invocation: BehaviorInvocation): void => {
    for (const expression of Object.values(invocation.arguments)) {
      if (expression?._tag !== 'reference') continue;
      const reference = expression.reference;
      const id = reference._tag === 'entity' ? reference.objectId
        : reference._tag === 'asset' ? reference.assetId
          : reference._tag === 'catalog' ? reference.objectTypeId
            : reference.behaviorId;
      references.set(`${reference._tag}:${id}`, reference);
    }
  };
  const addCondition = (condition: BehaviorCondition): void => {
    if (condition._tag === 'condition') addInvocation(condition.invocation);
    else if (condition._tag === 'not') addCondition(condition.condition);
    else condition.conditions.forEach(addCondition);
  };
  const addActions = (actions: readonly BehaviorActionNode[]): void => actions.forEach((action) => {
    if (action._tag === 'action') addInvocation(action.invocation);
    else {
      addCondition(action.condition);
      addActions(action.then);
      addActions(action.else ?? []);
    }
  });
  addInvocation(draft.when);
  if (draft.if !== undefined) addCondition(draft.if);
  addActions(draft.do);
  return [...references.values()];
};

export type BehaviorExpressionMode = BehaviorValueExpression['_tag'];

export const convertExpression = (
  mode: BehaviorExpressionMode,
  parameter: BehaviorParameterMetadata,
  current: BehaviorValueExpression,
  firstReference?: BehaviorReference,
): BehaviorValueExpression => {
  if (mode === current._tag) return current;
  if (mode === 'state') return new StateBehaviorValue({ key: '' });
  if (mode === 'event-field') return new EventFieldBehaviorValue({ path: '' });
  if (mode === 'reference' && firstReference !== undefined) return new ReferenceBehaviorValue({ reference: firstReference });
  return new LiteralBehaviorValue({ value: defaultLiteral(parameter) });
};

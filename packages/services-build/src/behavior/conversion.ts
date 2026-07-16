import {
  type BehaviorActionNode,
  type BehaviorCondition,
  type BehaviorDefinition,
  type BehaviorInvocation,
  type BehaviorReference,
  type BehaviorRegistryManifest,
  type BehaviorValueExpression,
  type JsonValue,
} from '@tileborne/core';

export interface GenerateTypeScriptBehaviorSourceInput {
  readonly definition: BehaviorDefinition;
  readonly registry: BehaviorRegistryManifest;
  readonly requiredCapabilities: readonly string[];
}

const canonicalJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]),
  );
};

const literal = (value: JsonValue): string => JSON.stringify(canonicalJson(value));

const referenceKey = (reference: BehaviorReference): string =>
  JSON.stringify(canonicalJson(reference));

const referenceFactory = (reference: BehaviorReference): string => {
  switch (reference._tag) {
    case 'entity':
      return `gameRefs.entity(${JSON.stringify(reference.objectId)})`;
    case 'asset':
      return `gameRefs.asset(${JSON.stringify(reference.assetId)})`;
    case 'catalog':
      return `gameRefs.catalog(${JSON.stringify(reference.objectTypeId)})`;
    case 'behavior':
      return `gameRefs.behavior(${JSON.stringify(reference.behaviorId)})`;
  }
};

/**
 * Ejects the declarative event sheet into ordinary, readable SDK TypeScript.
 * Output is deliberately stable: registry input order controls calls, object
 * values are key-sorted, and repeated references share deterministic names.
 */
export const generateTypeScriptBehaviorSource = (
  input: GenerateTypeScriptBehaviorSourceInput,
): string => {
  const entries = new Map(
    input.registry.entries.map((entry) => [String(entry.id), entry] as const),
  );
  const references = new Map<
    string,
    { readonly name: string; readonly value: BehaviorReference }
  >();
  let usesEventField = false;

  const collectExpression = (expression: BehaviorValueExpression): void => {
    if (expression._tag === 'event-field') usesEventField = true;
    if (expression._tag !== 'reference') return;
    const key = referenceKey(expression.reference);
    if (!references.has(key)) {
      references.set(key, {
        name: `${expression.reference._tag}${references.size + 1}`,
        value: expression.reference,
      });
    }
  };
  const orderedExpressions = (
    invocation: BehaviorInvocation,
  ): readonly BehaviorValueExpression[] => {
    const entry = entries.get(String(invocation.entryId));
    if (entry === undefined) {
      throw new Error(
        `Cannot convert unknown behavior registry entry ${JSON.stringify(invocation.entryId)}.`,
      );
    }
    return entry.inputs.map(({ key }) => {
      const expression = invocation.arguments[key];
      if (expression === undefined) {
        throw new Error(
          `Cannot convert ${JSON.stringify(invocation.entryId)} because input ${JSON.stringify(key)} is missing.`,
        );
      }
      collectExpression(expression);
      return expression;
    });
  };
  const collectCondition = (condition: BehaviorCondition): void => {
    if (condition._tag === 'condition') {
      for (const expression of orderedExpressions(condition.invocation))
        collectExpression(expression);
    } else if (condition._tag === 'not') collectCondition(condition.condition);
    else for (const nested of condition.conditions) collectCondition(nested);
  };
  const collectActions = (actions: readonly BehaviorActionNode[]): void => {
    for (const action of actions) {
      if (action._tag === 'action') {
        for (const expression of orderedExpressions(action.invocation))
          collectExpression(expression);
      } else {
        collectCondition(action.condition);
        collectActions(action.then);
        collectActions(action.else ?? []);
      }
    }
  };

  // Validate and collect in execution order before rendering any source.
  const eventEntry = entries.get(String(input.definition.when.entryId));
  if (eventEntry?.kind !== 'event') {
    throw new Error(
      `Cannot convert invalid event entry ${JSON.stringify(input.definition.when.entryId)}.`,
    );
  }
  for (const [, expression] of Object.entries(input.definition.when.arguments).sort(
    ([left], [right]) => left.localeCompare(right),
  ))
    collectExpression(expression);
  if (input.definition.if !== undefined) collectCondition(input.definition.if);
  collectActions(input.definition.do);

  const expressionSource = (expression: BehaviorValueExpression): string => {
    switch (expression._tag) {
      case 'literal':
        return literal(expression.value);
      case 'state':
        return `context.state.get(${JSON.stringify(expression.key)})`;
      case 'event-field':
        return `readEventField(context.event, ${JSON.stringify(expression.path)})`;
      case 'reference': {
        const found = references.get(referenceKey(expression.reference));
        if (found === undefined)
          throw new Error('Internal conversion error: reference was not collected.');
        return `context.refs.${found.name}`;
      }
    }
  };
  const invocationArguments = (invocation: BehaviorInvocation): readonly string[] =>
    orderedExpressions(invocation).map(expressionSource);

  const conditionSource = (condition: BehaviorCondition): string => {
    if (condition._tag === 'all') {
      return condition.conditions.length === 0
        ? 'true'
        : `(${condition.conditions.map(conditionSource).join(' && ')})`;
    }
    if (condition._tag === 'any') {
      return condition.conditions.length === 0
        ? 'false'
        : `(${condition.conditions.map(conditionSource).join(' || ')})`;
    }
    if (condition._tag === 'not') return `!(${conditionSource(condition.condition)})`;
    const entry = entries.get(String(condition.invocation.entryId));
    if (entry?.kind !== 'condition') {
      throw new Error(
        `Cannot convert invalid condition entry ${JSON.stringify(condition.invocation.entryId)}.`,
      );
    }
    const arguments_ = invocationArguments(condition.invocation);
    return condition.invocation.entryId === 'state.equals'
      ? `Object.is(context.state.get(${arguments_[0]}), ${arguments_[1]})`
      : `Boolean(context.query[${JSON.stringify(condition.invocation.entryId)}](${arguments_.join(', ')}))`;
  };

  const commandSource = (invocation: BehaviorInvocation): string => {
    const entry = entries.get(String(invocation.entryId));
    if (entry?.kind !== 'action') {
      throw new Error(`Cannot convert invalid action entry ${JSON.stringify(invocation.entryId)}.`);
    }
    const arguments_ = invocationArguments(invocation).join(', ');
    if (invocation.entryId === 'state.set') return `context.state.set(${arguments_})`;
    if (invocation.entryId === 'timer.after') return `context.timers.after(${arguments_})`;
    if (invocation.entryId === 'timer.every') return `context.timers.every(${arguments_})`;
    if (invocation.entryId === 'timer.cancel') return `context.timers.cancel(${arguments_})`;
    return `context.actions[${JSON.stringify(invocation.entryId)}](${arguments_})`;
  };

  const actionLines = (
    actions: readonly BehaviorActionNode[],
    indentation: string,
  ): readonly string[] =>
    actions.flatMap((action) => {
      if (action._tag === 'action') return [`${indentation}${commandSource(action.invocation)},`];
      return [
        `${indentation}...(${conditionSource(action.condition)} ? [`,
        ...actionLines(action.then, `${indentation}  `),
        `${indentation}] : [`,
        ...actionLines(action.else ?? [], `${indentation}  `),
        `${indentation}]),`,
      ];
    });

  const imports =
    references.size === 0
      ? `import { defineBehavior } from '@tileborne/game-sdk';`
      : `import { defineBehavior, refs as gameRefs } from '@tileborne/game-sdk';`;
  const helpers = [
    ...(usesEventField
      ? [
          '',
          'const readEventField = (event: unknown, path: string): unknown =>',
          "  path.split('.').reduce<unknown>(",
          "    (current, key) => typeof current === 'object' && current !== null",
          '      ? (current as Readonly<Record<string, unknown>>)[key]',
          '      : undefined,',
          '    event,',
          '  );',
        ]
      : []),
    ...(Object.keys(input.definition.when.arguments).length > 0
      ? [
          '',
          'const sameJsonValue = (left: unknown, right: unknown): boolean =>',
          '  JSON.stringify(left) === JSON.stringify(right);',
        ]
      : []),
  ];
  const refsLines =
    references.size === 0
      ? []
      : [
          '  refs: {',
          ...[...references.values()].map(
            ({ name, value }) => `    ${name}: ${referenceFactory(value)},`,
          ),
          '  },',
        ];
  const eventGuards = Object.entries(input.definition.when.arguments)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, expression]) =>
        `      if (!sameJsonValue(context.event[${JSON.stringify(key)}], ${expressionSource(expression)})) return [];`,
    );
  const conditionGuard =
    input.definition.if === undefined
      ? []
      : [`      if (!(${conditionSource(input.definition.if)})) return [];`];

  return [
    imports,
    ...helpers,
    '',
    'export default defineBehavior({',
    `  id: ${JSON.stringify(input.definition.id)},`,
    '  state: {',
    ...input.definition.state.map(
      ({ key, initialValue }) => `    ${JSON.stringify(key)}: ${literal(initialValue)},`,
    ),
    '  },',
    ...refsLines,
    '  requiredCapabilities: [',
    ...[...new Set(input.requiredCapabilities)]
      .sort()
      .map((capability) => `    ${JSON.stringify(capability)},`),
    '  ],',
    '  on: {',
    `    ${JSON.stringify(input.definition.when.entryId)}: (context) => {`,
    ...eventGuards,
    ...conditionGuard,
    '      return [',
    ...actionLines(input.definition.do, '        '),
    '      ];',
    '    },',
    '  },',
    '});',
    '',
  ].join('\n');
};

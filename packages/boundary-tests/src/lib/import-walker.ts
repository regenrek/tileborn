import fs from 'node:fs';
import ts from 'typescript';

export type CollectedImport = {
  readonly kind: 'static' | 'export' | 'dynamic' | 'require' | 'import-equals';
  readonly moduleSpecifier: string;
  readonly line: number;
};

const lineNumber = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const pushStringLiteralImport = (
  imports: CollectedImport[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  literal: ts.StringLiteralLike,
  kind: CollectedImport['kind'],
): void => {
  imports.push({
    kind,
    moduleSpecifier: literal.text,
    line: lineNumber(sourceFile, node),
  });
};

const isStringLiteralLike = (node: ts.Node): node is ts.StringLiteralLike =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

const resolvedStringLiteral = (node: ts.Expression): string | undefined =>
  evaluateStaticStringExpression(node, collectStringAliasesBefore(node));

/** Collect static and dynamic import module specifiers from a TypeScript source file. */
export function collectImports(sourceFile: ts.SourceFile): CollectedImport[] {
  const imports: CollectedImport[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      isStringLiteralLike(node.moduleSpecifier)
    ) {
      pushStringLiteralImport(imports, sourceFile, node, node.moduleSpecifier, 'static');
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      isStringLiteralLike(node.moduleSpecifier)
    ) {
      pushStringLiteralImport(imports, sourceFile, node, node.moduleSpecifier, 'export');
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const firstArgument = node.arguments[0];
      if (firstArgument !== undefined) {
        const moduleSpecifier = resolvedStringLiteral(firstArgument);
        if (moduleSpecifier !== undefined) {
          imports.push({ kind: 'dynamic', moduleSpecifier, line: lineNumber(sourceFile, node) });
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const firstArgument = node.arguments[0];
      if (firstArgument !== undefined) {
        const moduleSpecifier = resolvedStringLiteral(firstArgument);
        if (moduleSpecifier !== undefined) {
          imports.push({ kind: 'require', moduleSpecifier, line: lineNumber(sourceFile, node) });
        }
      }
    }

    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const moduleSpecifier = resolvedStringLiteral(node.moduleReference.expression);
      if (moduleSpecifier !== undefined) {
        imports.push({
          kind: 'import-equals',
          moduleSpecifier,
          line: lineNumber(sourceFile, node),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

export type CollectedNamedImport = {
  readonly importedName: string;
  readonly name: string;
  readonly moduleSpecifier: string;
  readonly line: number;
};

/**
 * Collect the locally-bound names of static `import` declarations and
 * re-export bindings (default, namespace, and named bindings) alongside
 * their module specifier. Unlike
 * {@link collectImports}, this lets boundary tests assert that a specific
 * *symbol* (e.g. a removed hard-cut export) is never imported, regardless of
 * which module it would come from.
 */
export function collectNamedImports(sourceFile: ts.SourceFile): CollectedNamedImport[] {
  const named: CollectedNamedImport[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      isStringLiteralLike(node.moduleSpecifier) &&
      node.importClause !== undefined
    ) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const line = lineNumber(sourceFile, node);
      const clause = node.importClause;
      if (clause.name !== undefined) {
        named.push({ importedName: 'default', name: clause.name.text, moduleSpecifier, line });
      }
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        named.push({ importedName: '*', name: bindings.name.text, moduleSpecifier, line });
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          named.push({
            importedName: element.propertyName?.text ?? element.name.text,
            name: element.name.text,
            moduleSpecifier,
            line,
          });
        }
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      isStringLiteralLike(node.moduleSpecifier)
    ) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const line = lineNumber(sourceFile, node);
      const clause = node.exportClause;
      if (clause === undefined) {
        named.push({ importedName: '*', name: '*', moduleSpecifier, line });
        ts.forEachChild(node, visit);
        return;
      }
      if (ts.isNamespaceExport(clause)) {
        named.push({ importedName: '*', name: clause.name.text, moduleSpecifier, line });
      }
      if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          named.push({
            importedName: element.propertyName?.text ?? element.name.text,
            name: element.name.text,
            moduleSpecifier,
            line,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return named;
}

export type SourceSpan = {
  readonly start: number;
  readonly end: number;
};

const sourceSpan = (sourceFile: ts.SourceFile, node: ts.Node): SourceSpan => ({
  start: node.getStart(sourceFile),
  end: node.getEnd(),
});

const isLiteralPropertyName = (
  node: ts.Expression,
  propertyName: string,
  aliases?: ReadonlyMap<string, string>,
): boolean => evaluateStaticStringExpression(node, aliases) === propertyName;

const isNamedPropertyAccess = (
  node: ts.Node,
  owner: (expression: ts.Expression) => boolean,
  propertyName: string,
  aliases?: ReadonlyMap<string, string>,
): boolean => {
  if (ts.isPropertyAccessExpression(node)) {
    return owner(unwrapExpression(node.expression)) && node.name.text === propertyName;
  }

  if (ts.isElementAccessExpression(node)) {
    return (
      owner(unwrapExpression(node.expression)) &&
      node.argumentExpression !== undefined &&
      isLiteralPropertyName(node.argumentExpression, propertyName, aliases)
    );
  }

  return false;
};

const isObservationProperty = (node: ts.Node, propertyName: string): boolean =>
  isNamedPropertyAccess(
    node,
    (expression) => ts.isIdentifier(expression) && expression.text === 'observation',
    propertyName,
  );

const isReconnectAttemptObservationCheck = (node: ts.Expression): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
  isObservationProperty(node.left, '_tag') &&
  isStringLiteralLike(node.right) &&
  node.right.text === 'reconnectAttempt';

const isReconnectAttemptProjectionTarget = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  unwrapExpression(node.expression).kind === ts.SyntaxKind.ThisKeyword &&
  node.name.text === 'reconnectAttempts';

const isReconnectAttemptProjectionStatement = (statement: ts.Statement): boolean => {
  if (ts.isReturnStatement(statement)) {
    return (
      statement.expression !== undefined && isObservationProperty(statement.expression, 'attempt')
    );
  }

  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
    return false;
  }

  const assignment = statement.expression;
  return (
    assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isReconnectAttemptProjectionTarget(assignment.left) &&
    isObservationProperty(assignment.right, 'attempt')
  );
};

const isReconnectAttemptProjectionBody = (statement: ts.Statement): boolean => {
  if (ts.isBlock(statement)) {
    return (
      statement.statements.length > 0 &&
      statement.statements.every(isReconnectAttemptProjectionStatement)
    );
  }

  return isReconnectAttemptProjectionStatement(statement);
};

/**
 * Return only the source spans that contain the canonical read-only
 * reconnectAttempt observation discriminant and projection of
 * `observation.attempt`.
 */
export function collectReconnectAttemptObservationProjectionSpans(
  sourceFile: ts.SourceFile,
): readonly SourceSpan[] {
  const spans: SourceSpan[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node) &&
      isReconnectAttemptObservationCheck(node.expression) &&
      node.elseStatement === undefined &&
      isReconnectAttemptProjectionBody(node.thenStatement)
    ) {
      spans.push(sourceSpan(sourceFile, node.expression));
      spans.push(sourceSpan(sourceFile, node.thenStatement));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return spans.sort((left, right) => left.start - right.start || left.end - right.end);
}

const isReconnectAttemptProjectionAssignment = (
  node: ts.Node,
  aliases: ReadonlyMap<string, string>,
): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  isNamedPropertyAccess(node.left, () => true, 'reconnectAttempts', aliases) &&
  isObservationProperty(node.right, 'attempt');

/**
 * Return source spans where client code projects `observation.attempt` into a
 * reconnectAttempts property owned by anything except the canonical instance
 * receiver.
 */
export function collectReconnectAttemptProjectionReceiverViolationSpans(
  sourceFile: ts.SourceFile,
): readonly SourceSpan[] {
  const spans: SourceSpan[] = [];

  const visit = (node: ts.Node): void => {
    const aliases = collectStringAliasesBefore(node);
    if (
      isReconnectAttemptProjectionAssignment(node, aliases) &&
      !isReconnectAttemptProjectionTarget(node.left)
    ) {
      spans.push(sourceSpan(sourceFile, node.left));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return spans.sort((left, right) => left.start - right.start || left.end - right.end);
}

const CLOSE_CODE_LITERAL_TEXTS = new Set(['1000', '4001', '4006']);

const unwrapExpression = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
};

const evaluateStaticStringExpression = (
  node: ts.Expression,
  aliases: ReadonlyMap<string, string> = new Map(),
  depth = 0,
): string | undefined => {
  if (depth > 8) {
    return undefined;
  }

  const expression = unwrapExpression(node);
  if (isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (ts.isIdentifier(expression)) {
    return aliases.get(expression.text);
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = evaluateStaticStringExpression(expression.left, aliases, depth + 1);
    const right = evaluateStaticStringExpression(expression.right, aliases, depth + 1);
    return left !== undefined && right !== undefined ? `${left}${right}` : undefined;
  }

  return undefined;
};

const collectStringAliasesBefore = (node: ts.Node): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();
  collectAliasesBefore(node, { stringValues: aliases });
  return aliases;
};

type CloseCodeAliases = {
  readonly classifierValues: Set<string>;
  readonly codeAccesses: Set<string>;
  readonly stringValues: Map<string, string>;
};

type AliasState = {
  readonly classifierValues?: Set<string>;
  readonly codeAccesses?: Set<string>;
  readonly stringValues: Map<string, string>;
};

type ConstDeclarationListPosition = {
  readonly declaration: ts.VariableDeclaration;
  readonly declarationList: ts.VariableDeclarationList;
};

const constDeclarationListPositionContaining = (
  declarationList: ts.VariableDeclarationList,
  target: ts.Node,
): ConstDeclarationListPosition | undefined => {
  let current: ts.Node | undefined = target;

  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) && current.parent === declarationList) {
      return isConstDeclarationList(declarationList)
        ? { declaration: current, declarationList }
        : undefined;
    }
    if (current === declarationList) {
      return undefined;
    }
    current = current.parent;
  }

  return undefined;
};

const sameConstDeclarationsBefore = (
  declarationList: ts.VariableDeclarationList,
  target: ts.Node,
): readonly ts.VariableDeclaration[] => {
  const position = constDeclarationListPositionContaining(declarationList, target);
  if (position === undefined) {
    return [];
  }

  const declarationIndex = position.declarationList.declarations.indexOf(position.declaration);
  return declarationIndex > 0
    ? position.declarationList.declarations.slice(0, declarationIndex)
    : [];
};

const lexicalAncestors = (node: ts.Node): readonly ts.Node[] => {
  const ancestors: ts.Node[] = [];
  let current: ts.Node | undefined = node;

  while (current !== undefined) {
    ancestors.push(current);
    current = current.parent;
  }

  return ancestors.reverse();
};

const isConstDeclarationList = (declarationList: ts.VariableDeclarationList): boolean =>
  (ts.getCombinedNodeFlags(declarationList) & ts.NodeFlags.Const) !== 0;

const bindingNames = (name: ts.BindingName): readonly string[] => {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
};

const invalidateAlias = (aliases: AliasState, name: string): void => {
  aliases.stringValues.delete(name);
  aliases.codeAccesses?.delete(name);
  aliases.classifierValues?.delete(name);
};

const invalidateBinding = (aliases: AliasState, name: ts.BindingName): void => {
  for (const bindingName of bindingNames(name)) {
    invalidateAlias(aliases, bindingName);
  }
};

const statementBindingNames = (statement: ts.Statement): readonly string[] => {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      bindingNames(declaration.name),
    );
  }

  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    return [statement.name.text];
  }

  if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
    const names: string[] = [];
    const clause = statement.importClause;
    if (clause.name !== undefined) {
      names.push(clause.name.text);
    }
    if (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
      names.push(clause.namedBindings.name.text);
    }
    if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        names.push(element.name.text);
      }
    }
    return names;
  }

  if (ts.isImportEqualsDeclaration(statement)) {
    return [statement.name.text];
  }

  return [];
};

const containerBindingNameCache = new WeakMap<ts.Block | ts.SourceFile, readonly string[]>();

const containerBindingNames = (container: ts.Block | ts.SourceFile): readonly string[] => {
  const cached = containerBindingNameCache.get(container);
  if (cached !== undefined) {
    return cached;
  }

  const names = container.statements.flatMap(statementBindingNames);
  containerBindingNameCache.set(container, names);
  return names;
};

const invalidateVariableDeclarationListBindings = (
  declarationList: ts.VariableDeclarationList,
  aliases: AliasState,
): void => {
  for (const declaration of declarationList.declarations) {
    invalidateBinding(aliases, declaration.name);
  }
};

const applyVariableDeclarationAliases = (
  declaration: ts.VariableDeclaration,
  declarationList: ts.VariableDeclarationList,
  aliases: AliasState,
): void => {
  invalidateBinding(aliases, declaration.name);

  if (!isConstDeclarationList(declarationList) || declaration.initializer === undefined) {
    return;
  }

  if (ts.isIdentifier(declaration.name)) {
    const name = declaration.name.text;
    const value = evaluateStaticStringExpression(declaration.initializer, aliases.stringValues);
    if (value !== undefined) {
      aliases.stringValues.set(name, value);
    }
    const closeCodeAliases =
      aliases.codeAccesses !== undefined && aliases.classifierValues !== undefined
        ? (aliases as CloseCodeAliases)
        : undefined;
    if (
      closeCodeAliases !== undefined &&
      isCloseCodeAccess(declaration.initializer, closeCodeAliases)
    ) {
      closeCodeAliases.codeAccesses.add(name);
    }
    if (
      closeCodeAliases !== undefined &&
      isCloseCodeClassifierValue(declaration.initializer, closeCodeAliases)
    ) {
      closeCodeAliases.classifierValues.add(name);
    }
    return;
  }

  if (
    aliases.codeAccesses === undefined ||
    aliases.classifierValues === undefined ||
    !ts.isObjectBindingPattern(declaration.name)
  ) {
    return;
  }

  for (const element of declaration.name.elements) {
    if (
      ts.isBindingElement(element) &&
      ts.isIdentifier(element.name) &&
      ((element.propertyName === undefined && element.name.text === 'code') ||
        (element.propertyName !== undefined &&
          isBindingPropertyName(element.propertyName, 'code', aliases.stringValues))) &&
      isCloseCodeOwner(declaration.initializer)
    ) {
      aliases.codeAccesses.add(element.name.text);
    }
  }
};

const applyStatementAliases = (statement: ts.Statement, aliases: AliasState): void => {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      applyVariableDeclarationAliases(declaration, statement.declarationList, aliases);
    }
    return;
  }

  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    invalidateAlias(aliases, statement.name.text);
    return;
  }

  if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
    invalidateAlias(aliases, statement.name.text);
    return;
  }

  if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
    const clause = statement.importClause;
    if (clause.name !== undefined) {
      invalidateAlias(aliases, clause.name.text);
    }
    if (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
      invalidateAlias(aliases, clause.namedBindings.name.text);
    }
    if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        invalidateAlias(aliases, element.name.text);
      }
    }
  }
};

const isFunctionLikeWithBody = (
  node: ts.Node,
): node is ts.FunctionLikeDeclaration & { readonly body: ts.ConciseBody } =>
  (ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)) &&
  node.body !== undefined;

const nodeContains = (container: ts.Node, node: ts.Node): boolean =>
  container.pos <= node.pos && node.end <= container.end;

const applyFunctionParameterAliases = (
  node: ts.Node,
  target: ts.Node,
  aliases: AliasState,
): void => {
  if (!isFunctionLikeWithBody(node)) {
    return;
  }

  const targetInParameterScope = node.parameters.some((parameter) =>
    nodeContains(parameter, target),
  );
  if (!targetInParameterScope && !nodeContains(node.body, target)) {
    return;
  }

  if (ts.isFunctionExpression(node) && node.name !== undefined) {
    invalidateAlias(aliases, node.name.text);
  }

  for (const parameter of node.parameters) {
    invalidateBinding(aliases, parameter.name);
  }
};

const applyCatchClauseAliases = (node: ts.Node, target: ts.Node, aliases: AliasState): void => {
  if (
    !ts.isCatchClause(node) ||
    node.variableDeclaration === undefined ||
    !nodeContains(node.block, target)
  ) {
    return;
  }

  invalidateBinding(aliases, node.variableDeclaration.name);
};

const applyContainerScopeBindingInvalidations = (
  container: ts.Block | ts.SourceFile,
  aliases: AliasState,
): void => {
  for (const name of containerBindingNames(container)) {
    invalidateAlias(aliases, name);
  }
};

const forInitializerDeclarationList = (node: ts.Node): ts.VariableDeclarationList | undefined => {
  if (ts.isForStatement(node) && node.initializer !== undefined) {
    return ts.isVariableDeclarationList(node.initializer) ? node.initializer : undefined;
  }

  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    return ts.isVariableDeclarationList(node.initializer) ? node.initializer : undefined;
  }

  return undefined;
};

const applyForInitializerAliases = (node: ts.Node, target: ts.Node, aliases: AliasState): void => {
  const declarationList = forInitializerDeclarationList(node);
  if (declarationList === undefined || !nodeContains(node, target)) {
    return;
  }

  invalidateVariableDeclarationListBindings(declarationList, aliases);

  if (nodeContains(declarationList, target)) {
    return;
  }

  for (const declaration of declarationList.declarations) {
    applyVariableDeclarationAliases(declaration, declarationList, aliases);
  }
};

const applySameDeclarationListAliases = (
  node: ts.Node,
  target: ts.Node,
  aliases: AliasState,
): void => {
  if (!ts.isVariableDeclarationList(node) || !nodeContains(node, target)) {
    return;
  }

  for (const declaration of sameConstDeclarationsBefore(node, target)) {
    applyVariableDeclarationAliases(declaration, node, aliases);
  }
};

const collectAliasesBefore = (node: ts.Node, aliases: AliasState): void => {
  for (const ancestor of lexicalAncestors(node)) {
    applySameDeclarationListAliases(ancestor, node, aliases);
    applyFunctionParameterAliases(ancestor, node, aliases);
    applyCatchClauseAliases(ancestor, node, aliases);
    applyForInitializerAliases(ancestor, node, aliases);

    if (!ts.isBlock(ancestor) && !ts.isSourceFile(ancestor)) {
      continue;
    }

    applyContainerScopeBindingInvalidations(ancestor, aliases);

    for (const statement of scopedStatementsBefore(ancestor, node)) {
      applyStatementAliases(statement, aliases);
    }
  }
};

const statementContaining = (
  container: ts.Block | ts.SourceFile,
  node: ts.Node,
): ts.Statement | undefined => {
  const nodeStart = node.getStart(container.getSourceFile());
  const nodeEnd = node.getEnd();
  return container.statements.find((statement) => {
    const statementStart = statement.getStart(container.getSourceFile());
    return statementStart <= nodeStart && nodeEnd <= statement.getEnd();
  });
};

const immediateChildInContainer = (
  container: ts.Block | ts.SourceFile,
  node: ts.Node,
): ts.Node | undefined => {
  let current: ts.Node = node;
  while (current.parent !== undefined && current.parent !== container) {
    current = current.parent;
  }
  return current.parent === container ? current : undefined;
};

const scopedStatementsBefore = (
  container: ts.Block | ts.SourceFile,
  node: ts.Node,
): readonly ts.Statement[] => {
  const boundary =
    statementContaining(container, node) ?? immediateChildInContainer(container, node);
  if (boundary === undefined || !ts.isStatement(boundary)) {
    return [];
  }

  return container.statements.slice(0, container.statements.indexOf(boundary));
};

const collectCloseCodeAliasesBefore = (node: ts.Node): CloseCodeAliases => {
  const classifierValues = new Set<string>();
  const codeAccesses = new Set<string>();
  const stringValues = new Map<string, string>();
  collectAliasesBefore(node, { classifierValues, codeAccesses, stringValues });
  return { classifierValues, codeAccesses, stringValues };
};

const isBindingPropertyName = (
  node: ts.PropertyName,
  propertyName: string,
  aliases: ReadonlyMap<string, string>,
): boolean => {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text === propertyName;
  }
  if (ts.isComputedPropertyName(node)) {
    return isLiteralPropertyName(node.expression, propertyName, aliases);
  }
  return false;
};

const isCloseCodeOwner = (node: ts.Expression): boolean => {
  const expression = unwrapExpression(node);
  return ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression);
};

const isCloseCodeAccess = (node: ts.Expression, aliases?: CloseCodeAliases): boolean => {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression) && aliases?.codeAccesses.has(expression.text) === true) {
    return true;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'code';
  }

  return (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    isLiteralPropertyName(expression.argumentExpression, 'code', aliases?.stringValues)
  );
};

const isCloseCodeClassifierValue = (node: ts.Expression, aliases?: CloseCodeAliases): boolean => {
  const expression = unwrapExpression(node);
  return (
    (ts.isNumericLiteral(expression) && CLOSE_CODE_LITERAL_TEXTS.has(expression.text)) ||
    (ts.isIdentifier(expression) &&
      (/_CLOSE_CODE$/.test(expression.text) ||
        aliases?.classifierValues.has(expression.text) === true))
  );
};

const isCloseCodeComparisonOperator = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
  kind === ts.SyntaxKind.EqualsEqualsToken ||
  kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
  kind === ts.SyntaxKind.ExclamationEqualsToken;

const isCloseCodeComparison = (
  node: ts.Node,
  aliases: CloseCodeAliases,
): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) &&
  isCloseCodeComparisonOperator(node.operatorToken.kind) &&
  ((isCloseCodeAccess(node.left, aliases) && isCloseCodeClassifierValue(node.right, aliases)) ||
    (isCloseCodeClassifierValue(node.left, aliases) && isCloseCodeAccess(node.right, aliases)));

const switchHasCloseCodeCase = (node: ts.SwitchStatement, aliases: CloseCodeAliases): boolean =>
  node.caseBlock.clauses.some(
    (clause) => ts.isCaseClause(clause) && isCloseCodeClassifierValue(clause.expression, aliases),
  );

/**
 * Return source spans where client code classifies transport close codes directly.
 * `packages/runtime/src/net` owns close-code policy; renderer/client code should
 * consume runtime observations instead of branching on raw close-code numbers.
 */
export function collectCloseCodeClassificationSpans(
  sourceFile: ts.SourceFile,
): readonly SourceSpan[] {
  const spans: SourceSpan[] = [];

  const visit = (node: ts.Node): void => {
    const aliases = collectCloseCodeAliasesBefore(node);
    if (isCloseCodeComparison(node, aliases)) {
      spans.push(sourceSpan(sourceFile, node));
    }

    if (
      ts.isSwitchStatement(node) &&
      isCloseCodeAccess(node.expression, aliases) &&
      switchHasCloseCodeCase(node, aliases)
    ) {
      spans.push(sourceSpan(sourceFile, node.expression));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return spans.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function parseSourceFile(filePath: string): ts.SourceFile {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  return ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(filePath),
  );
}

const scriptKindForPath = (filePath: string): ts.ScriptKind => {
  if (filePath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};

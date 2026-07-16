import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export type GameplaySourceDiagnosticCode = 'TBSDK1001' | 'TBSDK1002' | 'TBSDK1003' | 'TBSDK1004';

export interface GameplaySourceDiagnostic {
  readonly code: GameplaySourceDiagnosticCode;
  readonly severity: 'error';
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly suggestion: string;
}

export interface GameplaySourceFile {
  readonly fileName: string;
  readonly sourceText: string;
}

export interface ValidateGameplayProgramOptions {
  readonly projectRoot: string;
  readonly files: ReadonlyArray<GameplaySourceFile>;
  /** Optional compilation roots. Dependencies are followed, while unrelated files stay out of the policy pass. */
  readonly rootFiles?: ReadonlyArray<string>;
  readonly allowedBareImports?: ReadonlyArray<string>;
}

const FORBIDDEN_GLOBALS = new Map<string, string>([
  ['fetch', 'Use a typed SDK query or action supplied by an approved capability.'],
  ['setTimeout', 'Use context.timers.after(ticks, timerId).'],
  ['setInterval', 'Use context.timers.every(ticks, timerId).'],
  ['queueMicrotask', 'Return commands from the handler; the scheduler owns ordering.'],
  ['requestAnimationFrame', 'Gameplay code advances on simulation ticks, not render frames.'],
  ['process', 'Node.js globals are unavailable in gameplay code.'],
  ['Buffer', 'Use serializable SDK values rather than Node.js buffers.'],
  ['Bun', 'Host runtime globals are unavailable in gameplay code.'],
  ['Deno', 'Host runtime globals are unavailable in gameplay code.'],
  ['window', 'Gameplay code runs outside the renderer.'],
  ['document', 'Gameplay code runs outside the renderer.'],
  ['navigator', 'Gameplay code has no browser or network capability.'],
  ['localStorage', 'Persist typed behavior state through context.state.'],
  ['sessionStorage', 'Persist typed behavior state through context.state.'],
  ['WebSocket', 'Use an approved typed SDK capability; direct networking is unavailable.'],
  ['XMLHttpRequest', 'Use an approved typed SDK capability; direct networking is unavailable.'],
  ['EventSource', 'Use an approved typed SDK capability; direct networking is unavailable.'],
  ['globalThis', 'Use only values exposed by the behavior context.'],
  ['eval', 'Dynamic code evaluation is unavailable.'],
  ['Function', 'Dynamic code evaluation is unavailable.'],
  ['WebAssembly', 'Wasm loading is owned by the runtime, not project gameplay code.'],
  ['crypto', 'Use context.rng for deterministic random values.'],
]);

const FORBIDDEN_MEMBER_CALLS = new Map<string, string>([
  ['Math.random', 'Use context.rng.nextFloat(), integer(), or pick().'],
  ['Date.now', 'Use context.clock.tick or elapsedTicks.'],
  ['performance.now', 'Use context.clock.tick or elapsedTicks.'],
]);

const DYNAMIC_CODE_PROPERTIES = new Set(['constructor', '__proto__', 'prototype']);
const REFLECTION_ESCAPE_METHODS = new Map<string, ReadonlySet<string>>([
  ['Reflect', new Set(['get', 'getOwnPropertyDescriptor', 'getPrototypeOf'])],
  ['Object', new Set(['getOwnPropertyDescriptor', 'getPrototypeOf'])],
]);

const locationOf = (sourceFile: ts.SourceFile, node: ts.Node) => {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
};

const isReferenceIdentifier = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isEnumDeclaration(parent) && parent.name === node) ||
    (ts.isModuleDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node) ||
    (ts.isExportSpecifier(parent) && parent.name === node)
  ) {
    return false;
  }
  return true;
};

const importIsAllowed = (
  specifier: string,
  fileName: string,
  projectRoot: string,
  allowedBareImports: ReadonlySet<string>,
): boolean => {
  if (specifier === '@tileborne/game-sdk' || specifier.startsWith('@tileborne/game-sdk/')) {
    return true;
  }
  if (!specifier.startsWith('.') && !isAbsolute(specifier)) {
    return allowedBareImports.has(specifier);
  }
  const target = resolve(resolve(fileName, '..'), specifier);
  const projectRelative = relative(resolve(projectRoot), target);
  return projectRelative !== '..' && !projectRelative.startsWith(`..${sep}`);
};

export const validateGameplayProgram = (
  options: ValidateGameplayProgramOptions,
): ReadonlyArray<GameplaySourceDiagnostic> => {
  const diagnostics: GameplaySourceDiagnostic[] = [];
  const allowedBareImports = new Set(options.allowedBareImports ?? []);
  const sources = new Map(
    options.files.map((file) => [resolve(file.fileName), file.sourceText] as const),
  );
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
    noEmit: true,
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const compilerHost: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => sources.has(resolve(fileName)) || defaultHost.fileExists(fileName),
    readFile: (fileName) => sources.get(resolve(fileName)) ?? defaultHost.readFile(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const sourceText = sources.get(resolve(fileName));
      return sourceText === undefined
        ? defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS);
    },
  };
  const program = ts.createProgram({
    rootNames: options.rootFiles?.map((fileName) => resolve(fileName)) ?? [...sources.keys()],
    options: compilerOptions,
    host: compilerHost,
  });
  const checker = program.getTypeChecker();
  type DeterministicOwner = 'Math' | 'Date';
  const constantStrings = new Map<ts.Symbol, string>();

  const hasDeclareModifier = (node: ts.Node): boolean => {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      if (
        ts.canHaveModifiers(current) &&
        ts.getModifiers(current)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
      ) {
        return true;
      }
      if (ts.isSourceFile(current)) break;
    }
    return false;
  };

  const isRuntimeValueDeclaration = (declaration: ts.Declaration): boolean => {
    if (declaration.getSourceFile().isDeclarationFile || hasDeclareModifier(declaration)) {
      return false;
    }
    if (ts.isImportSpecifier(declaration)) {
      const importClause = declaration.parent.parent;
      return !declaration.isTypeOnly && !importClause.isTypeOnly;
    }
    if (ts.isImportClause(declaration)) return !declaration.isTypeOnly;
    if (ts.isNamespaceImport(declaration)) return !declaration.parent.isTypeOnly;
    if (ts.isImportEqualsDeclaration(declaration)) return !declaration.isTypeOnly;
    if (ts.isFunctionDeclaration(declaration)) return declaration.body !== undefined;
    return (
      ts.isVariableDeclaration(declaration) ||
      ts.isBindingElement(declaration) ||
      ts.isParameter(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isEnumDeclaration(declaration) ||
      ts.isModuleDeclaration(declaration)
    );
  };

  const isPureTypePosition = (node: ts.Node): boolean =>
    ts.isPartOfTypeNode(node) || ts.isPartOfTypeOnlyImportOrExportDeclaration(node);

  const isAmbientIdentifier = (node: ts.Expression, name: string): node is ts.Identifier => {
    if (!ts.isIdentifier(node) || node.text !== name) return false;
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return true;
    if (
      symbol.flags & ts.SymbolFlags.Alias &&
      symbol.declarations?.some(isRuntimeValueDeclaration)
    ) {
      return false;
    }
    const resolvedSymbol =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declarations = resolvedSymbol.declarations;
    return declarations === undefined || !declarations.some(isRuntimeValueDeclaration);
  };

  const symbolOf = (node: ts.Node): ts.Symbol | undefined => checker.getSymbolAtLocation(node);

  const ownerOf = (node: ts.Expression): DeterministicOwner | undefined => {
    if (isAmbientIdentifier(node, 'Math')) return 'Math';
    if (isAmbientIdentifier(node, 'Date')) return 'Date';
    return undefined;
  };

  const constantStringOf = (node: ts.Expression): string | undefined => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return constantStringOf(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constantStringOf(node.left);
      const right = constantStringOf(node.right);
      return left === undefined || right === undefined ? undefined : `${left}${right}`;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'join' &&
      ts.isArrayLiteralExpression(node.expression.expression)
    ) {
      const separator = node.arguments.length === 0
        ? ','
        : node.arguments[0] === undefined
          ? undefined
          : constantStringOf(node.arguments[0]);
      const values = node.expression.expression.elements.map((element) =>
        ts.isExpression(element) ? constantStringOf(element) : undefined);
      return separator === undefined || values.some((value) => value === undefined)
        ? undefined
        : (values as string[]).join(separator);
    }
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = symbolOf(node);
    return symbol ? constantStrings.get(symbol) : undefined;
  };

  const visitProgramNodes = (visitor: (node: ts.Node) => void): void => {
    const visit = (node: ts.Node): void => {
      visitor(node);
      ts.forEachChild(node, visit);
    };
    for (const sourceFile of program.getSourceFiles()) {
      if (sources.has(resolve(sourceFile.fileName))) visit(sourceFile);
    }
  };

  let constantsChanged = true;
  while (constantsChanged) {
    constantsChanged = false;
    visitProgramNodes((node) => {
      if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) {
        return;
      }
      const declaredSymbol = symbolOf(node.name);
      if (!declaredSymbol) return;
      const constantString = constantStringOf(node.initializer);
      if (constantString !== undefined && !constantStrings.has(declaredSymbol)) {
        constantStrings.set(declaredSymbol, constantString);
        constantsChanged = true;
      }
    });
  }

  const isAllowedOwnerPosition = (node: ts.Identifier, owner: DeterministicOwner): boolean => {
    const parent = node.parent;
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node
    ) {
      return true;
    }
    if (
      owner === 'Date' &&
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === node
    ) {
      return true;
    }
    return ts.isTypeQueryNode(parent);
  };

  const forbiddenMember = (
    node: ts.Node,
  ): { readonly key: string; readonly suggestion: string } | undefined => {
    if (ts.isPropertyAccessExpression(node)) {
      const owner = ownerOf(node.expression);
      const key = owner ? `${owner}.${node.name.text}` : undefined;
      if (key) {
        const suggestion = FORBIDDEN_MEMBER_CALLS.get(key);
        if (suggestion) return { key, suggestion };
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const owner = ownerOf(node.expression);
      if (!owner) return undefined;
      const member = constantStringOf(node.argumentExpression);
      if (member === undefined) {
        return {
          key: `${owner}[computed]`,
          suggestion: `Use explicit deterministic ${owner} members; computed access could select ${owner === 'Math' ? 'random' : 'now'}.`,
        };
      }
      const key = `${owner}.${member}`;
      const suggestion = FORBIDDEN_MEMBER_CALLS.get(key);
      if (suggestion) return { key, suggestion };
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const key = `${node.expression.text}.${node.name.text}`;
      const suggestion = FORBIDDEN_MEMBER_CALLS.get(key);
      if (suggestion && isAmbientIdentifier(node.expression, node.expression.text)) {
        return { key, suggestion };
      }
    }
    return undefined;
  };

  const unwrapParentheses = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) ? unwrapParentheses(node.expression) : node;

  const reflectionEscapeMethod = (node: ts.Node): string | undefined => {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
      return undefined;
    }
    const owner = unwrapParentheses(node.expression);
    if (!ts.isIdentifier(owner) || !isAmbientIdentifier(owner, owner.text)) return undefined;
    const methods = REFLECTION_ESCAPE_METHODS.get(owner.text);
    if (methods === undefined) return undefined;
    const method = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : constantStringOf(node.argumentExpression);
    if (method === undefined) return `${owner.text}[computed]`;
    return methods.has(method) ? `${owner.text}.${method}` : undefined;
  };

  const isReflectionOwnerFirstClassValue = (node: ts.Node): node is ts.Identifier => {
    if (!ts.isIdentifier(node) || !isReferenceIdentifier(node)) return false;
    if (node.text !== 'Reflect' && node.text !== 'Object') return false;
    if (!isAmbientIdentifier(node, node.text)) return false;
    let value: ts.Expression = node;
    let parent = node.parent;
    while (ts.isParenthesizedExpression(parent) && parent.expression === value) {
      value = parent;
      parent = parent.parent;
    }
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === value
    ) {
      return false;
    }
    return !(
      node.text === 'Object' &&
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === value
    );
  };

  const hasCallableOrUnknownType = (node: ts.Expression): boolean => {
    const type = checker.getTypeAtLocation(node);
    return (
      (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 ||
      type.getCallSignatures().length > 0 ||
      type.getConstructSignatures().length > 0
    );
  };

  const add = (
    sourceFile: ts.SourceFile,
    node: ts.Node,
    code: GameplaySourceDiagnosticCode,
    message: string,
    suggestion: string,
  ): void => {
    diagnostics.push({
      code,
      severity: 'error',
      fileName: sourceFile.fileName,
      ...locationOf(sourceFile, node),
      message,
      suggestion,
    });
  };

  for (const file of options.files) {
    const sourceFile = program.getSourceFile(resolve(file.fileName));
    if (!sourceFile) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (!importIsAllowed(specifier, file.fileName, options.projectRoot, allowedBareImports)) {
          add(
            sourceFile,
            node.moduleSpecifier,
            'TBSDK1001',
            `Import "${specifier}" is not available to gameplay code.`,
            'Import @tileborne/game-sdk, a project-relative module inside the project root, or an explicitly approved project module.',
          );
        }
      }

      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        if (!importIsAllowed(specifier, file.fileName, options.projectRoot, allowedBareImports)) {
          add(
            sourceFile,
            node.moduleSpecifier,
            'TBSDK1001',
            `Export from "${specifier}" is not available to gameplay code.`,
            'Export only from @tileborne/game-sdk, a project-relative module inside the project root, or an explicitly approved project module.',
          );
        }
      }

      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        const specifier = node.moduleReference.expression.text;
        if (!importIsAllowed(specifier, file.fileName, options.projectRoot, allowedBareImports)) {
          add(
            sourceFile,
            node.moduleReference.expression,
            'TBSDK1001',
            `Import "${specifier}" is not available to gameplay code.`,
            'Use a native static import from @tileborne/game-sdk, a project-relative module inside the project root, or an explicitly approved project module.',
          );
        }
      }

      const member = forbiddenMember(node);
      if (member) {
        add(sourceFile, node, 'TBSDK1002', `${member.key} is nondeterministic.`, member.suggestion);
        return;
      }

      const reflectiveEscape = reflectionEscapeMethod(node);
      if (reflectiveEscape !== undefined) {
        add(
          sourceFile,
          node,
          'TBSDK1003',
          `${reflectiveEscape} is unavailable because reflective property retrieval can expose dynamic-code constructors outside the capability realm.`,
          'Use ordinary typed values exposed by @tileborne/game-sdk; reflective property retrieval is forbidden.',
        );
        return;
      }

      if (isReflectionOwnerFirstClassValue(node)) {
        add(
          sourceFile,
          node,
          'TBSDK1003',
          `Ambient ${node.text} cannot escape as a first-class value because it exposes reflective dynamic-code constructors.`,
          'Use ordinary typed values exposed by @tileborne/game-sdk; reflection owners cannot be aliased or destructured.',
        );
        return;
      }

      const dynamicCodeProperty = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isElementAccessExpression(node)
          ? constantStringOf(node.argumentExpression)
          : undefined;
      if (
        ts.isElementAccessExpression(node) &&
        dynamicCodeProperty === undefined &&
        hasCallableOrUnknownType(node.expression)
      ) {
        add(
          sourceFile,
          node,
          'TBSDK1003',
          'Computed access on a callable or unknown value must use a statically known safe property.',
          'Use a direct typed member; unresolved computed access can select a dynamic-code constructor.',
        );
        return;
      }
      if (dynamicCodeProperty && DYNAMIC_CODE_PROPERTIES.has(dynamicCodeProperty)) {
        add(
          sourceFile,
          node,
          'TBSDK1003',
          `Property ${JSON.stringify(dynamicCodeProperty)} is unavailable because it can construct dynamic code or escape the capability realm.`,
          'Use ordinary typed functions and values exposed by @tileborne/game-sdk; dynamic code construction is forbidden.',
        );
        return;
      }

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          add(
            sourceFile,
            node.expression,
            'TBSDK1003',
            'Dynamic import() is not available to gameplay code.',
            'Use static project-relative imports so the build can validate and bundle the complete module graph.',
          );
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          add(
            sourceFile,
            node.expression,
            'TBSDK1003',
            'CommonJS require() is not available to gameplay code.',
            'Use native static TypeScript import declarations.',
          );
        }
        if (ownerOf(node.expression) === 'Date') {
          add(
            sourceFile,
            node.expression,
            'TBSDK1002',
            'Date() reads wall-clock time and is nondeterministic.',
            'Use context.clock.tick or elapsedTicks.',
          );
        }
      }

      if (ts.isNewExpression(node) && ownerOf(node.expression) === 'Date') {
        add(
          sourceFile,
          node.expression,
          'TBSDK1002',
          'new Date() reads wall-clock time and is nondeterministic.',
          'Use context.clock.tick or elapsedTicks.',
        );
      }

      if (ts.isExportSpecifier(node) && !isPureTypePosition(node)) {
        const exportedValue = node.propertyName ?? node.name;
        const owner = isAmbientIdentifier(exportedValue, 'Math')
          ? 'Math'
          : isAmbientIdentifier(exportedValue, 'Date')
            ? 'Date'
            : undefined;
        if (owner) {
          add(
            sourceFile,
            exportedValue,
            'TBSDK1002',
            `Ambient ${owner} cannot be exported as a first-class value.`,
            `Use deterministic ${owner} members directly; use context.${owner === 'Math' ? 'rng' : 'clock'} for nondeterministic behavior.`,
          );
          return;
        }
      }

      if (ts.isIdentifier(node) && !isPureTypePosition(node) && isReferenceIdentifier(node)) {
        const owner = isAmbientIdentifier(node, 'Math')
          ? 'Math'
          : isAmbientIdentifier(node, 'Date')
            ? 'Date'
            : undefined;
        if (owner && !isAllowedOwnerPosition(node, owner)) {
          add(
            sourceFile,
            node,
            'TBSDK1002',
            `Ambient ${owner} cannot escape as a first-class value.`,
            `Use deterministic ${owner} members directly; use context.${owner === 'Math' ? 'rng' : 'clock'} for nondeterministic behavior.`,
          );
          return;
        }
      }

      if (ts.isIdentifier(node) && !isPureTypePosition(node) && isReferenceIdentifier(node)) {
        const suggestion = FORBIDDEN_GLOBALS.get(node.text);
        if (
          suggestion &&
          isAmbientIdentifier(node, node.text) &&
          !(
            ts.isCallExpression(node.parent) &&
            node.parent.expression === node &&
            node.text === 'require'
          )
        ) {
          add(
            sourceFile,
            node,
            'TBSDK1002',
            `Global "${node.text}" is not available to gameplay code.`,
            suggestion,
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const parseDiagnostics = (
      sourceFile as ts.SourceFile & { readonly parseDiagnostics: ReadonlyArray<ts.Diagnostic> }
    ).parseDiagnostics;
    for (const parseDiagnostic of parseDiagnostics) {
      const start = parseDiagnostic.start ?? 0;
      const position = sourceFile.getLineAndCharacterOfPosition(start);
      diagnostics.push({
        code: 'TBSDK1004',
        severity: 'error',
        fileName: sourceFile.fileName,
        line: position.line + 1,
        column: position.character + 1,
        message: ts.flattenDiagnosticMessageText(parseDiagnostic.messageText, '\n'),
        suggestion: 'Fix the TypeScript syntax error before building the behavior.',
      });
    }
  }

  return diagnostics.sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      left.line - right.line ||
      left.column - right.column,
  );
};

export class InvalidGameplayProgramError extends Error {
  readonly diagnostics: ReadonlyArray<GameplaySourceDiagnostic>;

  constructor(diagnostics: ReadonlyArray<GameplaySourceDiagnostic>) {
    super(
      diagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.fileName}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message} ${diagnostic.suggestion}`,
        )
        .join('\n'),
    );
    this.name = 'InvalidGameplayProgramError';
    this.diagnostics = diagnostics;
  }
}

export const assertValidGameplayProgram = (options: ValidateGameplayProgramOptions): void => {
  const diagnostics = validateGameplayProgram(options);
  if (diagnostics.length > 0) throw new InvalidGameplayProgramError(diagnostics);
};

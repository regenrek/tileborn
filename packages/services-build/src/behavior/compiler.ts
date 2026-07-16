import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  BehaviorDefinition,
  BehaviorRegistryManifest,
  type BehaviorId,
  type BehaviorNodeId,
  type BehaviorSourceKind,
  type ContentHash,
  hashBytes,
} from '@tileborne/core';
import {
  type GameplaySourceDiagnostic,
  validateGameplayProgram,
} from '@tileborne/game-sdk/authoring';
import { build, type Message, type Plugin } from 'esbuild';
import { Schema } from 'effect';

const encoder = new TextEncoder();

/**
 * The Electron main process bundles this package to CommonJS, so module-relative
 * `import.meta.dirname` is not stable. Resolve the SDK from an explicit runtime
 * root instead and keep lookup lazy so opening the editor never depends on the
 * TypeScript compiler path.
 */
export const resolveGameSdkEntryPath = (runtimeRoot = process.cwd()): string => {
  let directory = path.resolve(runtimeRoot);
  for (;;) {
    for (const relativePath of [
      'packages/game-sdk/dist/index.js',
      'packages/game-sdk/src/index.ts',
      'game-sdk/dist/index.js',
    ]) {
      const candidate = path.join(directory, relativePath);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not locate the Tileborne game SDK from ${runtimeRoot}`);
};

export interface BehaviorCompileDiagnostic {
  readonly code: string;
  readonly severity: 'error';
  readonly message: string;
  readonly fileName: string;
  readonly line?: number;
  readonly column?: number;
  readonly suggestion: string;
  readonly behaviorId?: BehaviorId;
  readonly nodeId?: BehaviorNodeId;
  readonly sourceKind?: BehaviorSourceKind;
}

export interface CompiledBehaviorModule {
  readonly behaviorId: BehaviorId;
  readonly sourceKind: BehaviorSourceKind;
  readonly modulePath: string;
  readonly code: string;
  readonly sourceMap: string;
  readonly hash: ContentHash;
}

export interface TypeScriptBehaviorCompileInput {
  readonly behaviorId: BehaviorId;
  readonly projectRoot: string;
  readonly entryFile: string;
  readonly exportName?: string;
  readonly files: ReadonlyArray<{ readonly fileName: string; readonly sourceText: string }>;
  readonly modulePath?: string;
}

export interface VisualBehaviorCompileInput {
  readonly definition: BehaviorDefinition;
  readonly definitionPath: string;
  readonly registry: BehaviorRegistryManifest;
  readonly modulePath?: string;
}

export type BehaviorCompileResult =
  | { readonly ok: true; readonly artifact: CompiledBehaviorModule }
  | {
      readonly ok: false;
      readonly diagnostics: ReadonlyArray<BehaviorCompileDiagnostic>;
      readonly lastKnownGood?: CompiledBehaviorModule;
    };

const contentHash = (code: string): ContentHash => hashBytes(encoder.encode(code));

const diagnosticFromSdk = (diagnostic: GameplaySourceDiagnostic): BehaviorCompileDiagnostic => ({
  ...diagnostic,
});

const diagnosticFromEsbuild = (message: Message): BehaviorCompileDiagnostic => ({
  code: 'TBBUILD2002',
  severity: 'error',
  fileName: message.location?.file ?? '<behavior>',
  ...(message.location === null
    ? {}
    : { line: message.location.line, column: message.location.column + 1 }),
  message: message.text,
  suggestion: 'Fix the TypeScript source and rebuild; the last-known-good module remains active.',
});

const safeModuleName = (behaviorId: BehaviorId): string =>
  String(behaviorId).replaceAll(/[^a-zA-Z0-9_-]/g, '-');

const projectFilesPlugin = (
  projectRoot: string,
  files: ReadonlyMap<string, string>,
  entryFile: string,
  exportName: string,
): Plugin => ({
  name: 'tileborne-restricted-gameplay-resolution',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^tileborne:entry$/ }, () => ({
      path: 'tileborne:entry',
      namespace: 'tileborne-entry',
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: 'tileborne-entry' }, () => ({
      contents:
        exportName === 'default'
          ? `export { default } from ${JSON.stringify(entryFile)};`
          : `export { ${exportName} as default } from ${JSON.stringify(entryFile)};`,
      loader: 'ts',
      resolveDir: projectRoot,
    }));
    pluginBuild.onResolve({ filter: /^@tileborne\/game-sdk(?:\/.*)?$/ }, (args) => {
      if (args.path !== '@tileborne/game-sdk') {
        return {
          errors: [
            {
              text: `Runtime import ${JSON.stringify(args.path)} is not exported to gameplay code.`,
            },
          ],
        };
      }
      return { path: resolveGameSdkEntryPath() };
    });
    pluginBuild.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace !== 'tileborne-entry' && args.namespace !== 'tileborne-project') {
        return undefined;
      }
      if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) {
        return {
          errors: [
            { text: `Import ${JSON.stringify(args.path)} is not available to gameplay code.` },
          ],
        };
      }
      const absolutePath = path.resolve(args.resolveDir, args.path);
      const projectRelative = path.relative(projectRoot, absolutePath);
      if (projectRelative === '..' || projectRelative.startsWith(`..${path.sep}`)) {
        return {
          errors: [{ text: `Import ${JSON.stringify(args.path)} escapes the project root.` }],
        };
      }
      const candidates = path.extname(absolutePath)
        ? [absolutePath]
        : [
            absolutePath,
            `${absolutePath}.ts`,
            `${absolutePath}.tsx`,
            path.join(absolutePath, 'index.ts'),
          ];
      const resolved = candidates.find((candidate) => files.has(path.resolve(candidate)));
      return resolved
        ? { path: resolved, namespace: 'tileborne-project' }
        : {
            errors: [
              { text: `Project gameplay module ${JSON.stringify(args.path)} was not provided.` },
            ],
          };
    });
    pluginBuild.onLoad({ filter: /.*/, namespace: 'tileborne-project' }, (args) => ({
      contents: files.get(path.resolve(args.path)) ?? '',
      loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
      resolveDir: path.dirname(args.path),
    }));
  },
});

export const compileTypeScriptBehavior = async (
  input: TypeScriptBehaviorCompileInput,
): Promise<BehaviorCompileResult> => {
  const projectRoot = path.resolve(input.projectRoot);
  const entryFile = path.resolve(input.entryFile);
  const exportName = input.exportName ?? 'default';
  if (exportName !== 'default' && !/^[A-Za-z_$][\w$]*$/u.test(exportName)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'TBBUILD2001',
          severity: 'error',
          fileName: entryFile,
          message: `Export name ${JSON.stringify(exportName)} is invalid.`,
          suggestion: 'Use default or a static JavaScript identifier as the behavior export.',
          behaviorId: input.behaviorId,
          sourceKind: 'typescript',
        },
      ],
    };
  }

  const diagnostics = validateGameplayProgram({
    projectRoot,
    files: input.files,
    rootFiles: [entryFile],
  }).map(diagnosticFromSdk);
  if (diagnostics.length > 0) return {
    ok: false,
    diagnostics: diagnostics.map((entry) => ({
      ...entry,
      behaviorId: input.behaviorId,
      sourceKind: 'typescript',
    })),
  };

  const files = new Map(
    input.files.map((file) => [path.resolve(file.fileName), file.sourceText] as const),
  );
  if (!files.has(entryFile)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'TBBUILD2003',
          severity: 'error',
          fileName: entryFile,
          message: 'The behavior entry file was not included in the compile input.',
          suggestion:
            'Add the entry file and every project-relative dependency to the compile input.',
          behaviorId: input.behaviorId,
          sourceKind: 'typescript',
        },
      ],
    };
  }

  try {
    const result = await build({
      absWorkingDir: projectRoot,
      entryPoints: ['tileborne:entry'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      sourcemap: 'external',
      sourcesContent: true,
      outfile: 'behavior.mjs',
      logLevel: 'silent',
      plugins: [projectFilesPlugin(projectRoot, files, entryFile, exportName)],
    });
    const codeFile = result.outputFiles.find((file) => file.path.endsWith('behavior.mjs'));
    const mapFile = result.outputFiles.find((file) => file.path.endsWith('behavior.mjs.map'));
    if (!codeFile || !mapFile)
      throw new Error('esbuild did not emit the behavior module and source map');
    const code = codeFile.text;
    return {
      ok: true,
      artifact: {
        behaviorId: input.behaviorId,
        sourceKind: 'typescript',
        modulePath: input.modulePath ?? `behaviors/modules/${safeModuleName(input.behaviorId)}.mjs`,
        code,
        sourceMap: mapFile.text,
        hash: contentHash(code),
      },
    };
  } catch (error) {
    const messages =
      typeof error === 'object' &&
      error !== null &&
      'errors' in error &&
      Array.isArray(error.errors)
        ? (error.errors as Message[]).map(diagnosticFromEsbuild)
        : [
            {
              code: 'TBBUILD2004',
              severity: 'error' as const,
              fileName: entryFile,
              message: error instanceof Error ? error.message : String(error),
              suggestion:
                'Fix the compile error and rebuild; the last-known-good module remains active.',
            },
          ];
    return {
      ok: false,
      diagnostics: messages.map((entry) => ({
        ...entry,
        behaviorId: input.behaviorId,
        sourceKind: 'typescript',
      })),
    };
  }
};

const visualRuntime = (
  definition: BehaviorDefinition,
  registry: BehaviorRegistryManifest,
): string => {
  const inputOrder = Object.fromEntries(
    registry.entries.map((entry) => [entry.id, entry.inputs.map((input) => input.key)]),
  );
  return `const definition=${JSON.stringify(Schema.encodeSync(BehaviorDefinition)(definition))};
const inputOrder=${JSON.stringify(inputOrder)};
const resolveValue=(value,context)=>{switch(value._tag){case"literal":return value.value;case"state":return context.state.get(value.key);case"event-field":return value.path.split(".").reduce((current,key)=>current?.[key],context.event);case"reference":return value.reference;}};
const args=(invocation,context)=>(inputOrder[invocation.entryId]??Object.keys(invocation.arguments).sort()).map((key)=>resolveValue(invocation.arguments[key],context));
const condition=(node,context)=>{switch(node._tag){case"condition":{const values=args(node.invocation,context);if(node.invocation.entryId==="state.equals")return Object.is(context.state.get(values[0]),values[1]);const query=context.query[node.invocation.entryId];if(typeof query!=="function")throw new TypeError("TBRUNTIME3008: missing deterministic query "+node.invocation.entryId);return Boolean(query(...values));}case"all":return node.conditions.every((item)=>condition(item,context));case"any":return node.conditions.some((item)=>condition(item,context));case"not":return !condition(node.condition,context);}};
const command=(invocation,context)=>{const values=args(invocation,context);if(invocation.entryId==="state.set")return{kind:"state.set",payload:{key:values[0],value:values[1]}};if(invocation.entryId==="timer.after"||invocation.entryId==="timer.every")return{kind:invocation.entryId,payload:{ticks:values[0],timerId:values[1]}};if(invocation.entryId==="timer.cancel")return{kind:"timer.cancel",payload:{timerId:values[0]}};return{kind:invocation.entryId,payload:{arguments:values}};};
const commands=(nodes,context)=>nodes.flatMap((node)=>{if(node._tag==="branch"){const matched=condition(node.condition,context);return[{kind:"__tileborne.debug.branch",payload:{nodeId:node.nodeId,branch:matched?"then":"else"}},...commands(matched?node.then:(node.else??[]),context)];}return[{kind:"__tileborne.debug.action",payload:{nodeId:node.nodeId,actionId:node.invocation.entryId}},command(node.invocation,context)];});
const eventMatches=(context)=>Object.entries(definition.when.arguments).every(([key,value])=>JSON.stringify(context.event[key])===JSON.stringify(resolveValue(value,context)));
const module={id:definition.id,sourceKind:"visual",state:Object.fromEntries(definition.state.map((field)=>[field.key,field.initialValue])),requiredCapabilities:[],on:{[definition.when.entryId]:(context)=>eventMatches(context)&&(!definition.if||condition(definition.if,context))?commands(definition.do,context):[]}};
export default Object.freeze(module);
`;
};

export const compileVisualBehavior = (input: VisualBehaviorCompileInput): BehaviorCompileResult => {
  const definition = Schema.decodeUnknownSync(BehaviorDefinition)(input.definition);
  const registry = Schema.decodeUnknownSync(BehaviorRegistryManifest)(input.registry);
  const available = new Map(
    registry.entries.map((entry) => [String(entry.id), entry.kind] as const),
  );
  const missing: { readonly entryId: string; readonly nodeId?: BehaviorNodeId }[] = [];
  const wrongKind: {
    readonly entryId: string;
    readonly actual: string;
    readonly expected: string;
    readonly nodeId?: BehaviorNodeId;
  }[] = [];
  const inspectInvocation = (
    invocation: { readonly entryId: string },
    expected: 'event' | 'condition' | 'action',
    nodeId?: BehaviorNodeId,
  ): void => {
    const actual = available.get(invocation.entryId);
    if (actual === undefined) {
      missing.push({ entryId: invocation.entryId, ...(nodeId === undefined ? {} : { nodeId }) });
    } else if (actual !== expected) {
      wrongKind.push({
        entryId: invocation.entryId,
        actual,
        expected,
        ...(nodeId === undefined ? {} : { nodeId }),
      });
    }
  };
  const inspectCondition = (condition: typeof definition.if): void => {
    if (!condition) return;
    if (condition._tag === 'condition') {
      inspectInvocation(condition.invocation, 'condition', condition.nodeId);
    }
    else if (condition._tag === 'not') inspectCondition(condition.condition);
    else for (const nested of condition.conditions) inspectCondition(nested);
  };
  const inspectActions = (nodes: typeof definition.do): void => {
    for (const node of nodes) {
      if (node._tag === 'action') inspectInvocation(node.invocation, 'action', node.nodeId);
      else {
        inspectCondition(node.condition);
        inspectActions(node.then);
        inspectActions(node.else ?? []);
      }
    }
  };
  inspectInvocation(definition.when, 'event');
  inspectCondition(definition.if);
  inspectActions(definition.do);
  if (missing.length > 0 || wrongKind.length > 0) {
    return {
      ok: false,
      diagnostics: [
        ...missing
          .sort((left, right) => left.entryId.localeCompare(right.entryId))
          .map(({ entryId, nodeId }) => ({
          code: 'TBBUILD2101',
          severity: 'error' as const,
          fileName: input.definitionPath,
          message: `Visual behavior references unknown registry entry ${JSON.stringify(entryId)}.`,
          suggestion: 'Enable the owning capability/plugin or replace the missing block.',
          behaviorId: definition.id,
          sourceKind: 'visual' as const,
          ...(nodeId === undefined ? {} : { nodeId }),
        })),
        ...wrongKind
          .sort((left, right) => left.entryId.localeCompare(right.entryId))
          .map(({ entryId, actual, expected, nodeId }) => ({
            code: 'TBBUILD2102',
            severity: 'error' as const,
            fileName: input.definitionPath,
            message: `Registry entry ${JSON.stringify(entryId)} is ${actual}, not ${expected}.`,
            suggestion: `Replace the block with a registered ${expected} entry.`,
            behaviorId: definition.id,
            sourceKind: 'visual' as const,
            ...(nodeId === undefined ? {} : { nodeId }),
          })),
      ],
    };
  }
  const code = visualRuntime(definition, registry);
  const sourceMap = JSON.stringify({
    version: 3,
    file: input.modulePath ?? `${safeModuleName(definition.id)}.mjs`,
    sources: [input.definitionPath],
    sourcesContent: [JSON.stringify(Schema.encodeSync(BehaviorDefinition)(definition), null, 2)],
    names: [],
    mappings: '',
  });
  return {
    ok: true,
    artifact: {
      behaviorId: definition.id,
      sourceKind: 'visual',
      modulePath: input.modulePath ?? `behaviors/modules/${safeModuleName(definition.id)}.mjs`,
      code,
      sourceMap,
      hash: contentHash(code),
    },
  };
};

/** Keeps a verified module active when an edit fails compilation. */
export class BehaviorCompilerSession {
  readonly #lastKnownGood = new Map<BehaviorId, CompiledBehaviorModule>();

  async compileTypeScript(input: TypeScriptBehaviorCompileInput): Promise<BehaviorCompileResult> {
    return this.#remember(input.behaviorId, await compileTypeScriptBehavior(input));
  }

  compileVisual(input: VisualBehaviorCompileInput): BehaviorCompileResult {
    return this.#remember(input.definition.id, compileVisualBehavior(input));
  }

  #remember(behaviorId: BehaviorId, result: BehaviorCompileResult): BehaviorCompileResult {
    if (result.ok) {
      this.#lastKnownGood.set(behaviorId, result.artifact);
      return result;
    }
    const lastKnownGood = this.#lastKnownGood.get(behaviorId);
    return lastKnownGood ? { ...result, lastKnownGood } : result;
  }
}

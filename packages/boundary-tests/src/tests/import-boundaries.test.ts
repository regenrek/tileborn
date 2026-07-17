import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectImports, parseSourceFile } from '../lib/import-walker.js';
import { repoRoot } from '../lib/repo-root.js';
import { walkFiles } from '../lib/walk-files.js';

type ImportViolation = {
  readonly file: string;
  readonly line: number;
  readonly moduleSpecifier: string;
  readonly rule: string;
};

type ImportAllowEntry = {
  readonly fileSuffix: string;
  readonly line: number;
  readonly moduleSpecifier: string;
  readonly reason: string;
};

/**
 * Inline allow-list for documented import-boundary exceptions.
 */
const ALLOW_LIST: readonly ImportAllowEntry[] = [
  /** Allow (deferred fu-core-node-crypto): core hashing still uses Node crypto until Web Crypto migration */
  {
    fileSuffix: 'packages/core/src/hashing/hash.ts',
    line: 1,
    moduleSpecifier: 'node:crypto',
    reason:
      'deferred: migrate core hashing to Web Crypto/subtle (see docs/follow-ups.md fu-core-node-crypto)',
  },
  /** Allow (deferred fu-runtime-renderer-test-node): renderer integration tests use temp dirs via Node APIs */
  {
    fileSuffix: 'packages/runtime/src/renderer/renderer.test.ts',
    line: 4,
    moduleSpecifier: 'node:fs/promises',
    reason:
      'deferred: move renderer tests behind platform test harness (see docs/follow-ups.md fu-runtime-renderer-test-node)',
  },
  {
    fileSuffix: 'packages/runtime/src/renderer/renderer.test.ts',
    line: 5,
    moduleSpecifier: 'node:os',
    reason:
      'deferred: move renderer tests behind platform test harness (see docs/follow-ups.md fu-runtime-renderer-test-node)',
  },
  {
    fileSuffix: 'packages/runtime/src/renderer/renderer.test.ts',
    line: 6,
    moduleSpecifier: 'node:path',
    reason:
      'deferred: move renderer tests behind platform test harness (see docs/follow-ups.md fu-runtime-renderer-test-node)',
  },
  {
    fileSuffix: 'packages/ui/src/build-output-sourcemaps.test.ts',
    line: 1,
    moduleSpecifier: 'node:fs',
    reason: 'package build-output verification runs in Node and does not ship in UI runtime',
  },
  {
    fileSuffix: 'packages/ui/src/build-output-sourcemaps.test.ts',
    line: 2,
    moduleSpecifier: 'node:fs/promises',
    reason: 'package build-output verification runs in Node and does not ship in UI runtime',
  },
  {
    fileSuffix: 'packages/ui/src/build-output-sourcemaps.test.ts',
    line: 3,
    moduleSpecifier: 'node:path',
    reason: 'package build-output verification runs in Node and does not ship in UI runtime',
  },
];

const RENDERER_ROOT = path.join(repoRoot, 'apps/desktop/src/renderer');
const PACKAGE_ROOTS = {
  ui: path.join(repoRoot, 'packages/ui/src'),
  core: path.join(repoRoot, 'packages/core/src'),
  runtime: path.join(repoRoot, 'packages/runtime/src'),
  sdkTileset: path.join(repoRoot, 'packages/sdk-tileset/src'),
} as const;

const SDK_TILESET_ALLOWED_DEPENDENCIES = new Set(['@tileborne/core', 'effect', 'fast-xml-parser']);

const SDK_TILESET_FORBIDDEN_MODULE_PREFIXES = [
  'pixi.js',
  '@pixi/',
  'react',
  'react-dom',
  '@tanstack/react-',
] as const;

const NODE_FORBIDDEN_MODULES = new Set(['electron', 'fs', 'path', 'child_process']);

const NATIVE_MODULE_PREFIXES = [
  'better-sqlite3',
  'sharp',
  'canvas',
  'node-gyp',
  'fsevents',
] as const;

const REACT_FORBIDDEN_MODULES = new Set(['react', 'react-dom']);

const REACT_FORBIDDEN_PREFIXES = ['@tanstack/react-'] as const;

const RENDERER_PLUGIN_EXECUTABLE_PREFIXES = [
  '@tileborne/services-plugin',
  '@tileborne-plugins/',
] as const;

const RENDERER_PLUGIN_EXECUTABLE_PATH_PATTERNS = [
  /\.tileborne\/plugins\//,
  /\/plugins\/[^/]+\/dist\//,
  /\/plugins\/[^/]+\/src\//,
] as const;

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

const isAllowed = (violation: ImportViolation): boolean =>
  ALLOW_LIST.some(
    (entry) =>
      entry.fileSuffix === violation.file &&
      entry.line === violation.line &&
      entry.moduleSpecifier === violation.moduleSpecifier,
  );

const isNodeForbiddenModule = (moduleSpecifier: string): boolean => {
  if (NODE_FORBIDDEN_MODULES.has(moduleSpecifier)) {
    return true;
  }
  if (moduleSpecifier.startsWith('node:')) {
    return true;
  }
  return NATIVE_MODULE_PREFIXES.some(
    (prefix) => moduleSpecifier === prefix || moduleSpecifier.startsWith(`${prefix}/`),
  );
};

const isReactForbiddenModule = (moduleSpecifier: string): boolean => {
  if (REACT_FORBIDDEN_MODULES.has(moduleSpecifier)) {
    return true;
  }
  return REACT_FORBIDDEN_PREFIXES.some((prefix) => moduleSpecifier.startsWith(prefix));
};

const isRendererPluginExecutableImport = (moduleSpecifier: string): boolean => {
  if (RENDERER_PLUGIN_EXECUTABLE_PREFIXES.some((prefix) => moduleSpecifier.startsWith(prefix))) {
    return true;
  }
  return RENDERER_PLUGIN_EXECUTABLE_PATH_PATTERNS.some((pattern) => pattern.test(moduleSpecifier));
};

const scanDirectory = (
  rootDir: string,
  rules: Array<
    (file: string, line: number, moduleSpecifier: string) => ImportViolation | undefined
  >,
): ImportViolation[] => {
  const violations: ImportViolation[] = [];
  const files = walkFiles({ rootDir, extensions: ['.ts', '.tsx', '.js', '.jsx'] });

  for (const filePath of files) {
    const sourceFile = parseSourceFile(filePath);
    const file = relativeRepoPath(filePath);
    for (const collectedImport of collectImports(sourceFile)) {
      for (const rule of rules) {
        const violation = rule(file, collectedImport.line, collectedImport.moduleSpecifier);
        if (violation !== undefined && !isAllowed(violation)) {
          violations.push(violation);
        }
      }
    }
  }

  return violations;
};

const nodeRule =
  (scope: string) =>
  (file: string, line: number, moduleSpecifier: string): ImportViolation | undefined => {
    if (!isNodeForbiddenModule(moduleSpecifier)) {
      return undefined;
    }
    return {
      file,
      line,
      moduleSpecifier,
      rule: `${scope} must not import Node/Electron/native modules`,
    };
  };

const reactRule =
  (scope: string) =>
  (file: string, line: number, moduleSpecifier: string): ImportViolation | undefined => {
    if (!isReactForbiddenModule(moduleSpecifier)) {
      return undefined;
    }
    return {
      file,
      line,
      moduleSpecifier,
      rule: `${scope} must not import React or TanStack React packages`,
    };
  };

const sdkTilesetPlatformRule = (
  file: string,
  line: number,
  moduleSpecifier: string,
): ImportViolation | undefined => {
  if (SDK_TILESET_FORBIDDEN_MODULE_PREFIXES.some((prefix) => moduleSpecifier.startsWith(prefix))) {
    return {
      file,
      line,
      moduleSpecifier,
      rule: 'packages/sdk-tileset must not import DOM, Pixi, or React packages',
    };
  }
  return undefined;
};

const rendererPluginRule = (
  file: string,
  line: number,
  moduleSpecifier: string,
): ImportViolation | undefined => {
  if (!isRendererPluginExecutableImport(moduleSpecifier)) {
    return undefined;
  }
  return {
    file,
    line,
    moduleSpecifier,
    rule: 'renderer must not import plugin executable code (declarative manifest reads via ipc only)',
  };
};

describe('import boundaries', () => {
  it('packages/ui, packages/core, packages/runtime, and packages/sdk-tileset avoid Node/Electron/native imports', () => {
    const violations = [
      ...scanDirectory(PACKAGE_ROOTS.ui, [nodeRule('packages/ui')]),
      ...scanDirectory(PACKAGE_ROOTS.core, [nodeRule('packages/core')]),
      ...scanDirectory(PACKAGE_ROOTS.runtime, [nodeRule('packages/runtime')]),
      ...scanDirectory(PACKAGE_ROOTS.sdkTileset, [nodeRule('packages/sdk-tileset')]),
    ];

    const message = violations
      .map(
        (violation) =>
          `${violation.rule}: ${violation.file}:${violation.line} imports "${violation.moduleSpecifier}"`,
      )
      .join('\n');

    expect(violations, message).toEqual([]);
  }, 30_000);

  it('packages/core and packages/runtime avoid React imports', () => {
    const violations = [
      ...scanDirectory(PACKAGE_ROOTS.core, [reactRule('packages/core')]),
      ...scanDirectory(PACKAGE_ROOTS.runtime, [reactRule('packages/runtime')]),
    ];

    const message = violations
      .map(
        (violation) =>
          `${violation.rule}: ${violation.file}:${violation.line} imports "${violation.moduleSpecifier}"`,
      )
      .join('\n');

    expect(violations, message).toEqual([]);
  });

  it('packages/sdk-tileset avoids DOM, Pixi, and React imports', () => {
    const violations = scanDirectory(PACKAGE_ROOTS.sdkTileset, [sdkTilesetPlatformRule]);

    const message = violations
      .map(
        (violation) =>
          `${violation.rule}: ${violation.file}:${violation.line} imports "${violation.moduleSpecifier}"`,
      )
      .join('\n');

    expect(violations, message).toEqual([]);
  });

  it('packages/sdk-tileset depends only on @tileborne/core, effect, and fast-xml-parser', () => {
    const packageJsonPath = path.join(repoRoot, 'packages/sdk-tileset/package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = Object.keys(packageJson.dependencies ?? {});
    const forbidden = dependencies.filter(
      (dependency) => !SDK_TILESET_ALLOWED_DEPENDENCIES.has(dependency),
    );

    expect(forbidden, `unexpected sdk-tileset dependencies: ${forbidden.join(', ')}`).toEqual([]);
  });

  it('desktop renderer avoids plugin executable imports', () => {
    const violations = scanDirectory(RENDERER_ROOT, [rendererPluginRule]);

    const message = violations
      .map(
        (violation) =>
          `${violation.rule}: ${violation.file}:${violation.line} imports "${violation.moduleSpecifier}"`,
      )
      .join('\n');

    expect(violations, message).toEqual([]);
  }, 30_000);
});

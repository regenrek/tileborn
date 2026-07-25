import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectCloseCodeClassificationSpans,
  collectImports,
  collectNamedImports,
  collectReconnectAttemptObservationProjectionSpans,
  collectReconnectAttemptProjectionReceiverViolationSpans,
  parseSourceFile,
} from '../lib/import-walker.js';
import { repoRoot } from '../lib/repo-root.js';
import { walkFiles } from '../lib/walk-files.js';

type ForbiddenPattern = {
  readonly name: string;
  readonly pattern: RegExp;
};

type PatternAllowance = (input: {
  readonly forbidden: ForbiddenPattern;
  readonly filePath: string;
  readonly line: string;
  readonly lineNumber: number;
  readonly matchEnd: number;
  readonly matchStart: number;
  readonly sourceFile: ReturnType<typeof parseSourceFile>;
}) => boolean;

const WORKSPACE_PACKAGE_PARENT_DIRS = ['apps', 'packages'] as const;
const PRODUCTION_CLIENT_ROOTS = [
  'apps/desktop/src/renderer',
  'apps/game-client/src',
  'packages/game-client/src',
] as const;
const JS_TS_SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
] as const;
const RUNTIME_NET_ROOT = path.join(repoRoot, 'packages/runtime/src/net');

const PACKAGE_MANIFESTS = [
  'package.json',
  'pnpm-lock.yaml',
  'apps/desktop/package.json',
  'apps/game-host/package.json',
  'packages/runtime/package.json',
  'packages/plugin-battle-royale/package.json',
  'packages/plugin-example-arena/package.json',
] as const;

const PARTY_DEPENDENCY_PATTERN = /\b(?:partysocket|partyserver|partysub)\b/i;

const PLUGIN_ALLOWED_TRANSPORT_NEUTRAL_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  'packages/plugin-battle-royale': [
    '@testing-library/react',
    '@testing-library/user-event',
    '@tileborne/core',
    '@tileborne/game-client',
    '@tileborne/ipc-contracts',
    '@tileborne/plugin-api',
    '@tileborne/runtime',
    '@tileborne/sdk-tileset',
    '@tileborne/services-plugin',
    '@tileborne/simulation',
    '@tileborne/ui',
    '@types/react',
    '@vitejs/plugin-react',
    'effect',
    'jsdom',
    'lucide-react',
    'react',
    'react-dom',
    'tsup',
    'typescript',
    'vitest',
  ],
  'packages/plugin-example-arena': [
    '@tileborne/core',
    '@tileborne/plugin-api',
    '@tileborne/runtime',
    '@tileborne/services-plugin',
    '@tileborne/simulation',
    '@types/node',
    'effect',
    'msgpackr',
    'tsup',
    'typescript',
    'vitest',
  ],
} as const;

const PLUGIN_ALLOWED_TRANSPORT_NEUTRAL_IMPORT_SPECIFIERS: Readonly<
  Record<string, readonly string[]>
> = {
  'packages/plugin-battle-royale': [
    '@testing-library/react',
    '@testing-library/user-event',
    '@tileborne/core',
    '@tileborne/game-client',
    '@tileborne/ipc-contracts',
    '@tileborne/ipc-contracts/protocols/battle-royale',
    '@tileborne/plugin-api',
    '@tileborne/plugin-api/project-content',
    '@tileborne/runtime',
    '@tileborne/sdk-tileset',
    '@tileborne/sdk-tileset/manifest',
    '@tileborne/sdk-tileset/schemas',
    '@tileborne/services-plugin',
    '@tileborne/simulation',
    '@tileborne/ui',
    'effect',
    'lucide-react',
    'node:crypto',
    'node:fs',
    'node:fs/promises',
    'node:path',
    'node:url',
    'react',
    'vitest',
  ],
  'packages/plugin-example-arena': [
    '@tileborne/core',
    '@tileborne/plugin-api',
    '@tileborne/runtime',
    '@tileborne/runtime/map-package',
    '@tileborne/simulation',
    'effect',
    'msgpackr',
    'node:fs',
    'node:path',
    'node:url',
    'vitest',
  ],
} as const;

const PLUGIN_ALLOWED_TRANSPORT_NEUTRAL_ROOT_IMPORT_SYMBOLS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  'packages/plugin-battle-royale': {
    '@tileborne/game-client': ['MenuSectionProps', 'MenuSectionRegistration'],
    '@tileborne/runtime': [
      'BundledAssetIdSchema',
      'RuntimeAudioBusDefinition',
      'RuntimeAudioCueDefinition',
      'BundledAssetId',
      'BundledAssetSpec',
      'RenderableAnimationFrame',
      'RenderableEntity',
      'RenderableEntityAnimation',
      'RenderableEntityProjector',
      'RuntimePluginRenderManifest',
      'decodeGameShellDefaultsDefinition',
    ],
  },
  'packages/plugin-example-arena': {
    '@tileborne/runtime': [
      'BundledAssetId',
      'BundledAssetIdSchema',
      'BundledAssetSpec',
      'RenderableEntity',
      'RenderableEntityProjector',
      'RuntimePluginRenderManifest',
    ],
  },
} as const;

const PLUGIN_RESTRICTED_DYNAMIC_ROOT_IMPORTS = [
  '@tileborne/game-client',
  '@tileborne/runtime',
] as const;

const PRODUCTION_CLIENT_MANIFESTS = [
  'apps/desktop/package.json',
  'apps/game-client/package.json',
  'packages/game-client/package.json',
] as const;

const PRODUCTION_CLIENT_ALLOWED_PACKAGE_IMPORT_ROOTS: Readonly<Record<string, readonly string[]>> =
  {
    'apps/desktop/package.json': [
      '@base-ui/react',
      '@electron-forge/cli',
      '@electron-forge/maker-deb',
      '@electron-forge/maker-dmg',
      '@electron-forge/maker-rpm',
      '@electron-forge/maker-squirrel',
      '@electron-forge/plugin-vite',
      '@fontsource-variable/ibm-plex-sans',
      '@pixi/tilemap',
      '@playwright/test',
      '@remixicon/react',
      '@tailwindcss/vite',
      '@tanstack/react-query',
      '@tanstack/react-query-devtools',
      '@tanstack/react-router',
      '@tanstack/react-router-devtools',
      '@tanstack/router-plugin',
      '@tanstack/react-virtual',
      '@testing-library/react',
      '@testing-library/user-event',
      '@types/react',
      '@types/react-dom',
      '@tileborne/asset-pipeline',
      '@tileborne/core',
      '@tileborne/game-client',
      '@tileborne/game-host',
      '@tileborne/ipc-contracts',
      '@tileborne/plugin-api',
      '@tileborne/plugin-battle-royale',
      '@tileborne/plugin-example-arena',
      '@tileborne/runtime',
      '@tileborne/sdk-tileset',
      '@tileborne/services-app',
      '@tileborne/services-build',
      '@tileborne/services-foundation',
      '@tileborne/services-plugin',
      '@tileborne/test-fixtures',
      '@tileborne/ui',
      '@vitejs/plugin-react',
      'alchemy',
      'class-variance-authority',
      'clsx',
      'effect',
      'electron',
      'esbuild',
      'jsdom',
      'lucide-react',
      'miniflare',
      'msgpackr',
      'pixi.js',
      'react',
      'react-dom',
      'shadcn',
      'tailwind-merge',
      'tailwindcss',
      'tw-animate-css',
      'vite',
      'vitest',
      'zustand',
    ],
    'apps/game-client/package.json': [
      '@testing-library/react',
      '@testing-library/user-event',
      '@tailwindcss/vite',
      '@tileborne/core',
      '@tileborne/game-client',
      '@tileborne/ipc-contracts',
      '@tileborne/plugin-battle-royale',
      '@tileborne/runtime',
      '@tileborne/ui',
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'jsdom',
      'react',
      'react-dom',
      'tailwindcss',
      'tw-animate-css',
      'typescript',
      'vite',
      'vitest',
    ],
    'packages/game-client/package.json': [
      '@testing-library/jest-dom',
      '@testing-library/react',
      '@testing-library/user-event',
      '@tileborne/core',
      '@tileborne/ipc-contracts',
      '@tileborne/plugin-api',
      '@tileborne/runtime',
      '@tileborne/ui',
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'effect',
      'jsdom',
      'react',
      'react-dom',
      'typescript',
      'vitest',
    ],
  } as const;

const PLUGIN_NETWORK_POLICY_PATTERNS: readonly ForbiddenPattern[] = [
  { name: 'WebSocket constructor', pattern: /\bnew\s+WebSocket\b/ },
  { name: 'WebSocketPair provider primitive', pattern: /\bWebSocketPair\b/ },
  { name: 'fetch transport request', pattern: /\bfetch\s*\(/ },
  { name: 'close-event handler', pattern: /\b(?:onclose|addEventListener\s*\(\s*['"]close['"])/ },
  { name: 'reconnect token ownership', pattern: /\breconnectToken\b/ },
  {
    name: 'reconnect attempt policy',
    pattern: /\breconnect(?:AttemptCap|Attempt|Backoff|Delay|Budget|Cap)\b/i,
  },
  { name: 'transport backpressure policy', pattern: /\bbufferedAmount\b/ },
  { name: 'room close-code constant ownership', pattern: /\bROOM_[A-Z0-9_]+_CLOSE_CODE\b/ },
] as const;

const CLIENT_TRANSPORT_POLICY_PATTERNS: readonly ForbiddenPattern[] = [
  { name: 'direct WebSocket construction', pattern: /\bnew\s+WebSocket\b/ },
  { name: 'reconnect fetch wrapper', pattern: /\breconnect\w*\s*=.*\bfetch\s*\(/i },
  {
    name: 'reconnect timer policy',
    pattern: /\breconnect\w*\s*=.*\bset(?:Timeout|Interval)\s*\(/i,
  },
  {
    name: 'close-event classification',
    pattern: /\b(?:onclose|addEventListener\s*\(\s*['"]close['"])/,
  },
  {
    name: 'reconnect attempt policy',
    pattern: /\breconnect(?:AttemptCap|Attempt|Backoff|Delay|Budget|Cap)\b/i,
  },
  {
    name: 'manual reconnect attempt increment',
    pattern: /\breconnectAttempts\s*(?:\+\+|--|[+-]=)|(?:\+\+|--)\s*reconnectAttempts\b/,
  },
  {
    name: 'reconnect observation projection receiver',
    pattern: /\breconnectAttempts\s*=\s*observation\.attempt\b/,
  },
  { name: 'reconnect endpoint ownership', pattern: /['"]\/rooms\/reconnect['"]/ },
  { name: 'transport backpressure policy', pattern: /\bbufferedAmount\b/ },
  { name: 'outbound transport queue', pattern: /\boutbound(?:Message|Frame)?Queue\b/i },
] as const;

const PRODUCTION_CLIENT_FORBIDDEN_ROOT_IMPORT_SYMBOLS: Readonly<Record<string, readonly string[]>> =
  {
    '@tileborne/runtime': ['makeBrowserWebSocketTransport', 'makeNetClient'],
    '@tileborne/runtime/net': [
      'isReconnectableCloseCode',
      'KICKED_CLOSE_CODE',
      'MATCH_ENDED_CLOSE_CODE',
      'NORMAL_CLOSE_CODE',
    ],
  } as const;

const PRODUCTION_CLIENT_RESTRICTED_DYNAMIC_ROOT_IMPORTS = [
  '@tileborne/runtime',
  '@tileborne/runtime/net',
] as const;

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

type ParsedSourceFile = ReturnType<typeof parseSourceFile>;

const parsedSourceFiles = new Map<
  string,
  { readonly mtimeMs: number; readonly size: number; readonly sourceFile: ParsedSourceFile }
>();

const parseCachedSourceFile = (filePath: string): ParsedSourceFile => {
  const { mtimeMs, size } = fs.statSync(filePath);
  const cached = parsedSourceFiles.get(filePath);
  if (cached?.mtimeMs === mtimeMs && cached.size === size) {
    return cached.sourceFile;
  }
  const sourceFile = parseSourceFile(filePath);
  parsedSourceFiles.set(filePath, { mtimeMs, size, sourceFile });
  return sourceFile;
};

const sourceLines = (filePath: string): readonly string[] =>
  fs.readFileSync(filePath, 'utf8').split('\n');

const lineStartPositions = (sourceFile: ReturnType<typeof parseSourceFile>): readonly number[] =>
  sourceFile.getLineStarts();

const isProductionSourceFile = (filePath: string): boolean =>
  !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path.basename(filePath));

const readJsonObject = (filePath: string): Record<string, unknown> => {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

const recordKeys = (value: unknown): readonly string[] =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];

const workspacePackageDirs = (): readonly string[] =>
  WORKSPACE_PACKAGE_PARENT_DIRS.flatMap((parentDir) => {
    const absoluteParent = path.join(repoRoot, parentDir);
    return fs
      .readdirSync(absoluteParent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(absoluteParent, entry.name))
      .filter((packageDir) => fs.existsSync(path.join(packageDir, 'package.json')));
  }).sort();

const packageDependencyNames = (manifest: Record<string, unknown>): readonly string[] => [
  ...recordKeys(manifest.dependencies),
  ...recordKeys(manifest.devDependencies),
  ...recordKeys(manifest.peerDependencies),
  ...recordKeys(manifest.optionalDependencies),
];

const packageImportRoot = (moduleSpecifier: string): string => {
  const segments = moduleSpecifier.split('/');
  if (moduleSpecifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : moduleSpecifier;
  }
  return segments[0] ?? moduleSpecifier;
};

const isPackageImport = (moduleSpecifier: string): boolean =>
  !moduleSpecifier.startsWith('.') &&
  !moduleSpecifier.startsWith('@/') &&
  !path.isAbsolute(moduleSpecifier);

const productionClientManifestPathForFile = (
  filePath: string,
): (typeof PRODUCTION_CLIENT_MANIFESTS)[number] => {
  const relativePath = relativeRepoPath(filePath);
  if (relativePath.startsWith('apps/desktop/src/renderer/')) {
    return 'apps/desktop/package.json';
  }
  if (relativePath.startsWith('apps/game-client/src/')) {
    return 'apps/game-client/package.json';
  }
  if (relativePath.startsWith('packages/game-client/src/')) {
    return 'packages/game-client/package.json';
  }
  throw new Error(`production client source has no manifest owner: ${relativePath}`);
};

const hasGameModeContributions = (pluginManifest: Record<string, unknown>): boolean => {
  const contributes = pluginManifest.contributes;
  if (contributes === null || typeof contributes !== 'object' || Array.isArray(contributes)) {
    return false;
  }
  return Array.isArray((contributes as Record<string, unknown>).gameModes);
};

const gameModePluginPackageDirs = (): readonly string[] =>
  workspacePackageDirs().filter((packageDir) => {
    const pluginManifestPath = path.join(packageDir, 'tileborne-plugin.json');
    return (
      fs.existsSync(pluginManifestPath) &&
      hasGameModeContributions(readJsonObject(pluginManifestPath)) &&
      fs.existsSync(path.join(packageDir, 'src'))
    );
  });

const collectPatternViolations = (
  files: readonly string[],
  patterns: readonly ForbiddenPattern[],
  allowance?: PatternAllowance,
): string[] => {
  const violations: string[] = [];

  for (const filePath of files) {
    const lines = sourceLines(filePath);
    const sourceFile = parseCachedSourceFile(filePath);
    const starts = lineStartPositions(sourceFile);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      for (const forbidden of patterns) {
        const flags = forbidden.pattern.flags.includes('g')
          ? forbidden.pattern.flags
          : `${forbidden.pattern.flags}g`;
        const pattern = new RegExp(forbidden.pattern.source, flags);
        const matches = [...line.matchAll(pattern)];
        for (const match of matches) {
          const lineMatchStart = match.index;
          if (lineMatchStart === undefined) {
            continue;
          }
          const matchStart = (starts[index] ?? 0) + lineMatchStart;
          const matchEnd = matchStart + match[0].length;
          if (
            allowance?.({
              forbidden,
              filePath,
              line,
              lineNumber: index + 1,
              matchEnd,
              matchStart,
              sourceFile,
            }) === true
          ) {
            continue;
          }
          violations.push(`${forbidden.name}: ${relativeRepoPath(filePath)}:${index + 1}`);
          break;
        }
      }
    }
  }

  return violations;
};

const allowsRuntimeReconnectAttemptObservationProjection: PatternAllowance = ({
  forbidden,
  matchEnd,
  matchStart,
  sourceFile,
}): boolean =>
  (forbidden.name === 'reconnect attempt policy' ||
    forbidden.name === 'reconnect observation projection receiver') &&
  collectReconnectAttemptObservationProjectionSpans(sourceFile).some(
    (span) => span.start <= matchStart && matchEnd <= span.end,
  );

const lineNumberForPosition = (
  sourceFile: ReturnType<typeof parseSourceFile>,
  position: number,
): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

const collectProductionClientCloseCodeClassificationViolations = (
  files: readonly string[],
): string[] => {
  const violations: string[] = [];

  for (const filePath of files) {
    const sourceFile = parseCachedSourceFile(filePath);
    const spans = collectCloseCodeClassificationSpans(sourceFile);
    for (const span of spans) {
      violations.push(
        `close-event classification: ${relativeRepoPath(filePath)}:${lineNumberForPosition(
          sourceFile,
          span.start,
        )}`,
      );
    }
  }

  return violations;
};

const collectProductionClientReconnectAttemptProjectionReceiverViolations = (
  files: readonly string[],
): string[] => {
  const violations: string[] = [];

  for (const filePath of files) {
    const sourceFile = parseCachedSourceFile(filePath);
    const spans = collectReconnectAttemptProjectionReceiverViolationSpans(sourceFile);
    for (const span of spans) {
      violations.push(
        `reconnect observation projection receiver: ${relativeRepoPath(
          filePath,
        )}:${lineNumberForPosition(sourceFile, span.start)}`,
      );
    }
  }

  return violations;
};

const collectPluginTransportNeutralityViolations = (
  packageDir: string,
  manifest: Record<string, unknown>,
  sourceFiles: readonly string[],
): string[] => {
  const violations: string[] = [];
  const packagePath = relativeRepoPath(packageDir);
  const allowedDependencies = new Set(
    PLUGIN_ALLOWED_TRANSPORT_NEUTRAL_DEPENDENCIES[packagePath] ?? [],
  );
  const allowedImportSpecifiers = new Set(
    PLUGIN_ALLOWED_TRANSPORT_NEUTRAL_IMPORT_SPECIFIERS[packagePath] ?? [],
  );
  const allowedRootImportSymbols =
    PLUGIN_ALLOWED_TRANSPORT_NEUTRAL_ROOT_IMPORT_SYMBOLS[packagePath] ?? {};
  const restrictedDynamicRootImports = new Set(PLUGIN_RESTRICTED_DYNAMIC_ROOT_IMPORTS);

  if (allowedDependencies.size === 0 || allowedImportSpecifiers.size === 0) {
    violations.push(`game-mode plugin missing transport-neutral allowlist: ${packagePath}`);
  }

  for (const dependencyName of packageDependencyNames(manifest)) {
    if (!allowedDependencies.has(dependencyName)) {
      violations.push(
        `plugin non-allowlisted dependency: ${packagePath}/package.json depends on "${dependencyName}"`,
      );
    }
  }

  for (const filePath of sourceFiles) {
    const sourceFile = parseCachedSourceFile(filePath);
    for (const collectedImport of collectImports(sourceFile)) {
      if (!isPackageImport(collectedImport.moduleSpecifier)) {
        continue;
      }
      if (
        restrictedDynamicRootImports.has(
          collectedImport.moduleSpecifier as (typeof PLUGIN_RESTRICTED_DYNAMIC_ROOT_IMPORTS)[number],
        ) &&
        (collectedImport.kind === 'dynamic' ||
          collectedImport.kind === 'require' ||
          collectedImport.kind === 'import-equals')
      ) {
        violations.push(
          `plugin restricted dynamic root import: ${relativeRepoPath(filePath)}:${collectedImport.line} ${collectedImport.kind} imports "${collectedImport.moduleSpecifier}"`,
        );
      }
      if (!allowedImportSpecifiers.has(collectedImport.moduleSpecifier)) {
        violations.push(
          `plugin non-allowlisted import: ${relativeRepoPath(filePath)}:${collectedImport.line} imports "${collectedImport.moduleSpecifier}"`,
        );
      }
    }
    for (const collectedImport of collectNamedImports(sourceFile)) {
      const allowedSymbols = allowedRootImportSymbols[collectedImport.moduleSpecifier];
      if (allowedSymbols === undefined) {
        continue;
      }
      if (!allowedSymbols.includes(collectedImport.importedName)) {
        violations.push(
          `plugin non-allowlisted root import symbol: ${relativeRepoPath(filePath)}:${collectedImport.line} imports "${collectedImport.importedName}" from "${collectedImport.moduleSpecifier}"`,
        );
      }
    }
  }

  violations.push(...collectPatternViolations(sourceFiles, PLUGIN_NETWORK_POLICY_PATTERNS));
  return violations;
};

const collectProductionClientRestrictedRootImportViolations = (
  files: readonly string[],
): string[] => {
  const violations: string[] = [];
  const restrictedDynamicRootImports = new Set(PRODUCTION_CLIENT_RESTRICTED_DYNAMIC_ROOT_IMPORTS);

  for (const filePath of files) {
    const sourceFile = parseCachedSourceFile(filePath);
    for (const collectedImport of collectImports(sourceFile)) {
      if (
        restrictedDynamicRootImports.has(
          collectedImport.moduleSpecifier as (typeof PRODUCTION_CLIENT_RESTRICTED_DYNAMIC_ROOT_IMPORTS)[number],
        ) &&
        (collectedImport.kind === 'dynamic' ||
          collectedImport.kind === 'require' ||
          collectedImport.kind === 'import-equals')
      ) {
        violations.push(
          `production client restricted dynamic root import: ${relativeRepoPath(filePath)}:${collectedImport.line} ${collectedImport.kind} imports "${collectedImport.moduleSpecifier}"`,
        );
      }
    }
    for (const collectedImport of collectNamedImports(sourceFile)) {
      const forbiddenSymbols =
        PRODUCTION_CLIENT_FORBIDDEN_ROOT_IMPORT_SYMBOLS[collectedImport.moduleSpecifier];
      if (forbiddenSymbols === undefined) {
        continue;
      }
      if (
        collectedImport.importedName === '*' ||
        forbiddenSymbols.includes(collectedImport.importedName)
      ) {
        violations.push(
          `production client forbidden root import symbol: ${relativeRepoPath(filePath)}:${collectedImport.line} imports "${collectedImport.importedName}" from "${collectedImport.moduleSpecifier}"`,
        );
      }
    }
  }

  return violations;
};

const collectProductionClientManifestDependencyViolations = (
  manifestPath: (typeof PRODUCTION_CLIENT_MANIFESTS)[number],
  manifest: Record<string, unknown>,
): string[] => {
  const violations: string[] = [];
  const allowedPackageRoots = new Set(
    PRODUCTION_CLIENT_ALLOWED_PACKAGE_IMPORT_ROOTS[manifestPath] ?? [],
  );

  for (const dependencyName of packageDependencyNames(manifest)) {
    if (!allowedPackageRoots.has(dependencyName)) {
      violations.push(
        `production client non-allowlisted dependency: ${manifestPath} depends on "${dependencyName}"`,
      );
    }
  }

  return violations;
};

const collectProductionClientTransportDependencyViolations = (): string[] => {
  const violations: string[] = [];

  for (const manifestPath of PRODUCTION_CLIENT_MANIFESTS) {
    const manifest = readJsonObject(path.join(repoRoot, manifestPath));
    violations.push(...collectProductionClientManifestDependencyViolations(manifestPath, manifest));
  }

  return violations;
};

const collectProductionClientTransportImportViolations = (
  files: readonly string[],
  manifestPathForFixtures?: (typeof PRODUCTION_CLIENT_MANIFESTS)[number],
): string[] => {
  const violations: string[] = [];

  for (const filePath of files) {
    const sourceFile = parseCachedSourceFile(filePath);
    for (const collectedImport of collectImports(sourceFile)) {
      if (
        isPackageImport(collectedImport.moduleSpecifier) &&
        !(
          PRODUCTION_CLIENT_ALLOWED_PACKAGE_IMPORT_ROOTS[
            manifestPathForFixtures ?? productionClientManifestPathForFile(filePath)
          ] ?? []
        ).includes(packageImportRoot(collectedImport.moduleSpecifier))
      ) {
        violations.push(
          `production client non-allowlisted package import: ${relativeRepoPath(filePath)}:${collectedImport.line} imports "${collectedImport.moduleSpecifier}"`,
        );
      }
    }
  }

  return violations;
};

describe('multiplayer connection lifecycle ownership boundary', () => {
  it('does not add PartyServer, PartySocket, or Partysub dependencies or imports', () => {
    const violations: string[] = [];

    for (const manifest of PACKAGE_MANIFESTS) {
      const filePath = path.join(repoRoot, manifest);
      if (PARTY_DEPENDENCY_PATTERN.test(fs.readFileSync(filePath, 'utf8'))) {
        violations.push(`dependency manifest mentions Party* package: ${manifest}`);
      }
    }

    for (const root of ['apps', 'packages', 'scripts'] as const) {
      const files = walkFiles({
        rootDir: path.join(repoRoot, root),
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      });
      for (const filePath of files) {
        const sourceFile = parseCachedSourceFile(filePath);
        for (const collectedImport of collectImports(sourceFile)) {
          if (PARTY_DEPENDENCY_PATTERN.test(collectedImport.moduleSpecifier)) {
            violations.push(
              `Party* import: ${relativeRepoPath(filePath)}:${collectedImport.line} imports "${collectedImport.moduleSpecifier}"`,
            );
          }
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  }, 30_000);

  it('keeps game-mode plugins out of transport, reconnect, close-code, and backpressure policy', () => {
    const pluginPackageDirs = gameModePluginPackageDirs();
    expect(pluginPackageDirs.map(relativeRepoPath)).toEqual([
      'packages/plugin-battle-royale',
      'packages/plugin-example-arena',
    ]);

    const violations: string[] = [];
    for (const packageDir of pluginPackageDirs) {
      const manifest = readJsonObject(path.join(packageDir, 'package.json'));
      const files = walkFiles({
        rootDir: path.join(packageDir, 'src'),
        extensions: JS_TS_SOURCE_EXTENSIONS,
      });
      violations.push(...collectPluginTransportNeutralityViolations(packageDir, manifest, files));
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('allows only transitional production client owners to carry direct socket or reconnect policy', () => {
    const files = PRODUCTION_CLIENT_ROOTS.flatMap((root) =>
      walkFiles({ rootDir: path.join(repoRoot, root), extensions: JS_TS_SOURCE_EXTENSIONS }),
    ).filter((filePath) => isProductionSourceFile(filePath));

    const violations = [
      ...collectProductionClientTransportDependencyViolations(),
      ...collectProductionClientTransportImportViolations(files),
      ...collectProductionClientRestrictedRootImportViolations(files),
      ...collectProductionClientCloseCodeClassificationViolations(files),
      ...collectProductionClientReconnectAttemptProjectionReceiverViolations(files),
      ...collectPatternViolations(
        files,
        CLIENT_TRANSPORT_POLICY_PATTERNS,
        allowsRuntimeReconnectAttemptObservationProjection,
      ),
    ];
    expect(violations, violations.join('\n')).toEqual([]);
  }, 60_000);

  it('rejects fixture evasions with exact runtime-root plugin and client transport violations', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tileborne-transport-boundary-'));
    try {
      const pluginPackageDir = path.join(repoRoot, 'packages/plugin-example-arena');
      const battleRoyalePluginPackageDir = path.join(repoRoot, 'packages/plugin-battle-royale');
      const writeFixture = (name: string, source: string): string => {
        const filePath = path.join(fixtureRoot, name);
        fs.writeFileSync(filePath, source);
        return filePath;
      };
      const pluginViolationsFor = (
        filePath: string,
        packageDir: string = pluginPackageDir,
      ): readonly string[] =>
        collectPluginTransportNeutralityViolations(packageDir, { dependencies: {} }, [filePath]);
      const clientViolationsFor = (filePath: string): readonly string[] => [
        ...collectProductionClientTransportImportViolations(
          [filePath],
          'apps/game-client/package.json',
        ),
        ...collectProductionClientRestrictedRootImportViolations([filePath]),
        ...collectProductionClientCloseCodeClassificationViolations([filePath]),
        ...collectProductionClientReconnectAttemptProjectionReceiverViolations([filePath]),
        ...collectPatternViolations(
          [filePath],
          CLIENT_TRANSPORT_POLICY_PATTERNS,
          allowsRuntimeReconnectAttemptObservationProjection,
        ),
      ];

      expect(
        collectPluginTransportNeutralityViolations(
          pluginPackageDir,
          {
            dependencies: {
              '@tileborne/core': 'workspace:*',
              '@tileborne/plugin-api': 'workspace:*',
              '@tileborne/runtime': 'workspace:*',
              '@tileborne/simulation': 'workspace:*',
              effect: '4.0.0-beta.78',
              msgpackr: '2.0.1',
              'reconnecting-websocket': '4.4.0',
            },
          },
          [],
        ),
      ).toContain(
        'plugin non-allowlisted dependency: packages/plugin-example-arena/package.json depends on "reconnecting-websocket"',
      );

      const pluginPackageImportFixture = writeFixture(
        'plugin-package-import.ts',
        "import ReconnectingWebSocket from 'reconnecting-websocket';\nexport const wrapper = ReconnectingWebSocket;\n",
      );
      expect(pluginViolationsFor(pluginPackageImportFixture)).toContain(
        `plugin non-allowlisted import: ${relativeRepoPath(pluginPackageImportFixture)}:1 imports "reconnecting-websocket"`,
      );

      const pluginRuntimeSymbolFixture = writeFixture(
        'plugin-runtime-symbol.ts',
        "import { makeBrowserWebSocketTransport } from '@tileborne/runtime';\nexport const socket = makeBrowserWebSocketTransport;\n",
      );
      expect(pluginViolationsFor(pluginRuntimeSymbolFixture)).toContain(
        `plugin non-allowlisted root import symbol: ${relativeRepoPath(pluginRuntimeSymbolFixture)}:1 imports "makeBrowserWebSocketTransport" from "@tileborne/runtime"`,
      );

      const pluginGameClientReExportFixture = writeFixture(
        'plugin-game-client-reexport.ts',
        "export { createGameHostLobbyClient } from '@tileborne/game-client';\n",
      );
      expect(
        pluginViolationsFor(pluginGameClientReExportFixture, battleRoyalePluginPackageDir),
      ).toContain(
        `plugin non-allowlisted root import symbol: ${relativeRepoPath(pluginGameClientReExportFixture)}:1 imports "createGameHostLobbyClient" from "@tileborne/game-client"`,
      );

      const pluginRuntimeNamespaceReExportFixture = writeFixture(
        'plugin-runtime-namespace-reexport.ts',
        "export * as runtimeTransport from '@tileborne/runtime';\n",
      );
      expect(pluginViolationsFor(pluginRuntimeNamespaceReExportFixture)).toContain(
        `plugin non-allowlisted root import symbol: ${relativeRepoPath(pluginRuntimeNamespaceReExportFixture)}:1 imports "*" from "@tileborne/runtime"`,
      );

      const pluginRuntimeBareStarReExportFixture = writeFixture(
        'plugin-runtime-bare-star-reexport.ts',
        "export * from '@tileborne/runtime';\n",
      );
      expect(pluginViolationsFor(pluginRuntimeBareStarReExportFixture)).toContain(
        `plugin non-allowlisted root import symbol: ${relativeRepoPath(pluginRuntimeBareStarReExportFixture)}:1 imports "*" from "@tileborne/runtime"`,
      );

      const pluginRuntimeTemplateDynamicFixture = writeFixture(
        'plugin-runtime-template-dynamic.ts',
        'export const loadRuntime = () => import(`@tileborne/runtime`);\n',
      );
      expect(pluginViolationsFor(pluginRuntimeTemplateDynamicFixture)).toContain(
        `plugin restricted dynamic root import: ${relativeRepoPath(pluginRuntimeTemplateDynamicFixture)}:1 dynamic imports "@tileborne/runtime"`,
      );

      const pluginGameClientRequireFixture = writeFixture(
        'plugin-game-client-require.cjs',
        "exports.loadGameClient = () => require('@tileborne/game-client');\n",
      );
      expect(pluginViolationsFor(pluginGameClientRequireFixture)).toContain(
        `plugin restricted dynamic root import: ${relativeRepoPath(pluginGameClientRequireFixture)}:1 require imports "@tileborne/game-client"`,
      );

      const pluginGameClientTemplateRequireFixture = writeFixture(
        'plugin-game-client-template-require.cjs',
        'exports.loadGameClient = () => require(`@tileborne/game-client`);\n',
      );
      expect(pluginViolationsFor(pluginGameClientTemplateRequireFixture)).toContain(
        `plugin restricted dynamic root import: ${relativeRepoPath(pluginGameClientTemplateRequireFixture)}:1 require imports "@tileborne/game-client"`,
      );

      const pluginRuntimeImportEqualsFixture = writeFixture(
        'plugin-runtime-import-equals.ts',
        "import runtime = require('@tileborne/runtime');\nexport const load = runtime;\n",
      );
      expect(pluginViolationsFor(pluginRuntimeImportEqualsFixture)).toContain(
        `plugin restricted dynamic root import: ${relativeRepoPath(pluginRuntimeImportEqualsFixture)}:1 import-equals imports "@tileborne/runtime"`,
      );

      expect(
        collectProductionClientManifestDependencyViolations('apps/game-client/package.json', {
          dependencies: {
            '@tileborne/core': 'workspace:*',
            '@tileborne/game-client': 'workspace:*',
            '@tileborne/runtime': 'workspace:*',
            '@tileborne/socket-helper': '1.0.0',
            react: '19.2.6',
            'react-dom': '19.2.6',
          },
        }),
      ).toContain(
        'production client non-allowlisted dependency: apps/game-client/package.json depends on "@tileborne/socket-helper"',
      );

      const clientPackageImportFixture = writeFixture(
        'client-package-import.js',
        "import SocketHelper from '@tileborne/socket-helper';\nexport const helper = SocketHelper;\n",
      );
      expect(clientViolationsFor(clientPackageImportFixture)).toContain(
        `production client non-allowlisted package import: ${relativeRepoPath(clientPackageImportFixture)}:1 imports "@tileborne/socket-helper"`,
      );

      const clientRuntimeSymbolFixture = writeFixture(
        'client-runtime-symbol.js',
        "import { makeNetClient } from '@tileborne/runtime';\nexport const net = makeNetClient;\n",
      );
      expect(clientViolationsFor(clientRuntimeSymbolFixture)).toContain(
        `production client forbidden root import symbol: ${relativeRepoPath(clientRuntimeSymbolFixture)}:1 imports "makeNetClient" from "@tileborne/runtime"`,
      );

      const clientRuntimeReExportFixture = writeFixture(
        'client-runtime-reexport.js',
        "export { makeNetClient } from '@tileborne/runtime';\n",
      );
      expect(clientViolationsFor(clientRuntimeReExportFixture)).toContain(
        `production client forbidden root import symbol: ${relativeRepoPath(clientRuntimeReExportFixture)}:1 imports "makeNetClient" from "@tileborne/runtime"`,
      );

      const clientRuntimeBareStarReExportFixture = writeFixture(
        'client-runtime-bare-star-reexport.js',
        "export * from '@tileborne/runtime';\n",
      );
      expect(clientViolationsFor(clientRuntimeBareStarReExportFixture)).toContain(
        `production client forbidden root import symbol: ${relativeRepoPath(clientRuntimeBareStarReExportFixture)}:1 imports "*" from "@tileborne/runtime"`,
      );

      const clientRuntimeRequireFixture = writeFixture(
        'client-runtime-require.cjs',
        "exports.runtime = () => require('@tileborne/runtime');\n",
      );
      expect(clientViolationsFor(clientRuntimeRequireFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeRequireFixture)}:1 require imports "@tileborne/runtime"`,
      );

      const clientRuntimeTemplateRequireFixture = writeFixture(
        'client-runtime-template-require.cjs',
        'exports.runtime = () => require(`@tileborne/runtime`);\n',
      );
      expect(clientViolationsFor(clientRuntimeTemplateRequireFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeTemplateRequireFixture)}:1 require imports "@tileborne/runtime"`,
      );

      const clientRuntimeTemplateDynamicFixture = writeFixture(
        'client-runtime-template-dynamic.js',
        'exports.transport = async () => import(`@tileborne/runtime`);\n',
      );
      expect(clientViolationsFor(clientRuntimeTemplateDynamicFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeTemplateDynamicFixture)}:1 dynamic imports "@tileborne/runtime"`,
      );

      const clientRuntimeImportEqualsFixture = writeFixture(
        'client-runtime-import-equals.ts',
        "import runtime = require('@tileborne/runtime');\nexport const load = runtime;\n",
      );
      expect(clientViolationsFor(clientRuntimeImportEqualsFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeImportEqualsFixture)}:1 import-equals imports "@tileborne/runtime"`,
      );

      const clientRuntimeNetClassifierImportFixture = writeFixture(
        'client-runtime-net-classifier-import.ts',
        "import { isReconnectableCloseCode } from '@tileborne/runtime/net';\nexport const classify = isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetClassifierImportFixture)).toContain(
        `production client forbidden root import symbol: ${relativeRepoPath(clientRuntimeNetClassifierImportFixture)}:1 imports "isReconnectableCloseCode" from "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetDynamicFixture = writeFixture(
        'client-runtime-net-dynamic.ts',
        "export const classify = async () => (await import('@tileborne/runtime/net')).isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDynamicFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetDynamicFixture)}:1 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetAliasedDynamicFixture = writeFixture(
        'client-runtime-net-aliased-dynamic.ts',
        "const runtimeNet = '@tileborne/runtime/net';\nexport const classify = async () => (await import(runtimeNet)).isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetAliasedDynamicFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetAliasedDynamicFixture)}:2 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetConcatenatedDynamicFixture = writeFixture(
        'client-runtime-net-concatenated-dynamic.ts',
        "export const classify = async () => (await import('@tileborne/runtime' + '/net')).isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetConcatenatedDynamicFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetConcatenatedDynamicFixture)}:1 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetSameDeclarationAliasedDynamicFixture = writeFixture(
        'client-runtime-net-same-declaration-aliased-dynamic.ts',
        "const runtimeRoot = '@tileborne/runtime', runtimeNet = runtimeRoot + '/net', loader = import(runtimeNet);\nexport const classify = loader;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetSameDeclarationAliasedDynamicFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetSameDeclarationAliasedDynamicFixture)}:1 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetNestedSameDeclarationAliasedDynamicFixture = writeFixture(
        'client-runtime-net-nested-same-declaration-aliased-dynamic.ts',
        "const runtimeRoot = '@tileborne/runtime', load = () => { const nested = import(runtimeRoot + '/net'); return nested; };\nexport const classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetNestedSameDeclarationAliasedDynamicFixture),
      ).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetNestedSameDeclarationAliasedDynamicFixture)}:1 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetParameterShadowedDynamicFixture = writeFixture(
        'client-runtime-net-parameter-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime';\nexport function load(root) { return import(root + '/net'); }\n",
      );
      expect(clientViolationsFor(clientRuntimeNetParameterShadowedDynamicFixture)).toEqual([]);

      const clientRuntimeNetSameDeclarationParameterShadowedDynamicFixture = writeFixture(
        'client-runtime-net-same-declaration-parameter-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime', load = (root) => import(root + '/net');\nexport const classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetSameDeclarationParameterShadowedDynamicFixture),
      ).toEqual([]);

      const clientRuntimeNetDefaultParameterShadowedDynamicFixture = writeFixture(
        'client-runtime-net-default-parameter-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime', load = (root, value = import(root + '/net')) => value;\nexport const classify = load;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDefaultParameterShadowedDynamicFixture)).toEqual(
        [],
      );

      const clientRuntimeNetDestructuredDefaultParameterShadowedDynamicFixture = writeFixture(
        'client-runtime-net-destructured-default-parameter-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime', load = ({ root = import(root + '/net') } = {}) => root;\nexport const classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetDestructuredDefaultParameterShadowedDynamicFixture),
      ).toEqual([]);

      const clientRuntimeNetDefaultParameterPositiveDynamicFixture = writeFixture(
        'client-runtime-net-default-parameter-positive-dynamic.ts',
        "const root = '@tileborne/runtime', load = (value = import(root + '/net')) => value;\nexport const classify = load;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDefaultParameterPositiveDynamicFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetDefaultParameterPositiveDynamicFixture)}:1 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetNamedFunctionExpressionShadowedDynamicFixture = writeFixture(
        'client-runtime-net-named-function-expression-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime', load = function root() { return import(root + '/net'); };\nexport const classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetNamedFunctionExpressionShadowedDynamicFixture),
      ).toEqual([]);

      const clientRuntimeNetNamedFunctionExpressionPositiveDynamicFixture = writeFixture(
        'client-runtime-net-named-function-expression-positive-dynamic.ts',
        "const root = '@tileborne/runtime', load = function loader() { return import(root + '/net'); };\nexport const classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetNamedFunctionExpressionPositiveDynamicFixture),
      ).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetNamedFunctionExpressionPositiveDynamicFixture)}:1 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetSameDeclarationCatchShadowedDynamicFixture = writeFixture(
        'client-runtime-net-same-declaration-catch-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime', load = () => { try { return undefined; } catch (root) { return import(root + '/net'); } };\nexport const classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetSameDeclarationCatchShadowedDynamicFixture),
      ).toEqual([]);

      const clientRuntimeNetLocalShadowedDynamicFixture = writeFixture(
        'client-runtime-net-local-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime';\nexport function load(nextRoot) { const root = nextRoot; return import(root + '/net'); }\n",
      );
      expect(clientViolationsFor(clientRuntimeNetLocalShadowedDynamicFixture)).toEqual([]);

      const clientRuntimeNetSameDeclarationLocalShadowedDynamicFixture = writeFixture(
        'client-runtime-net-same-declaration-local-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime', load = (nextRoot) => { const root = nextRoot; return import(root + '/net'); };\nexport const classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetSameDeclarationLocalShadowedDynamicFixture),
      ).toEqual([]);

      const clientRuntimeNetForOfShadowedDynamicFixture = writeFixture(
        'client-runtime-net-for-of-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime';\nexport async function load(roots) { for (const root of roots) { await import(root + '/net'); } }\n",
      );
      expect(clientViolationsFor(clientRuntimeNetForOfShadowedDynamicFixture)).toEqual([]);

      const clientRuntimeNetDestructuredForOfShadowedDynamicFixture = writeFixture(
        'client-runtime-net-destructured-for-of-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime';\nexport async function load(entries) { for (const { root } of entries) { await import(root + '/net'); } }\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDestructuredForOfShadowedDynamicFixture)).toEqual(
        [],
      );

      const clientRuntimeNetLaterDeclarationShadowedDynamicFixture = writeFixture(
        'client-runtime-net-later-declaration-shadowed-dynamic.ts',
        "const root = '@tileborne/runtime';\nexport function load(nextRoot) { const loader = import(root + '/net'); const root = nextRoot; return loader; }\n",
      );
      expect(clientViolationsFor(clientRuntimeNetLaterDeclarationShadowedDynamicFixture)).toEqual(
        [],
      );

      const clientRuntimeNetDestructuredDynamicFixture = writeFixture(
        'client-runtime-net-destructured-dynamic.ts',
        "export const classify = async () => { const { isReconnectableCloseCode } = await import('@tileborne/runtime/net'); return isReconnectableCloseCode; };\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDestructuredDynamicFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetDestructuredDynamicFixture)}:1 dynamic imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetRequireFixture = writeFixture(
        'client-runtime-net-require.cjs',
        "exports.classify = () => require('@tileborne/runtime/net').isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetRequireFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetRequireFixture)}:1 require imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetAliasedRequireFixture = writeFixture(
        'client-runtime-net-aliased-require.cjs',
        "const runtimeNet = '@tileborne/runtime/net';\nexports.classify = () => require(runtimeNet).isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetAliasedRequireFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetAliasedRequireFixture)}:2 require imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetSameDeclarationAliasedRequireFixture = writeFixture(
        'client-runtime-net-same-declaration-aliased-require.cjs',
        "const runtimeRoot = '@tileborne/runtime', runtimeNet = runtimeRoot + '/net', loader = require(runtimeNet);\nexports.classify = loader.isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetSameDeclarationAliasedRequireFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetSameDeclarationAliasedRequireFixture)}:1 require imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetNestedSameDeclarationAliasedRequireFixture = writeFixture(
        'client-runtime-net-nested-same-declaration-aliased-require.cjs',
        "const runtimeRoot = '@tileborne/runtime', load = () => { const nested = require(runtimeRoot + '/net'); return nested; };\nexports.classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetNestedSameDeclarationAliasedRequireFixture),
      ).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetNestedSameDeclarationAliasedRequireFixture)}:1 require imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetSameDeclarationParameterShadowedRequireFixture = writeFixture(
        'client-runtime-net-same-declaration-parameter-shadowed-require.cjs',
        "const root = '@tileborne/runtime', load = (root) => require(root + '/net');\nexports.classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetSameDeclarationParameterShadowedRequireFixture),
      ).toEqual([]);

      const clientRuntimeNetDefaultParameterShadowedRequireFixture = writeFixture(
        'client-runtime-net-default-parameter-shadowed-require.cjs',
        "const root = '@tileborne/runtime', load = (root, value = require(root + '/net')) => value;\nexports.classify = load;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDefaultParameterShadowedRequireFixture)).toEqual(
        [],
      );

      const clientRuntimeNetDestructuredDefaultParameterShadowedRequireFixture = writeFixture(
        'client-runtime-net-destructured-default-parameter-shadowed-require.cjs',
        "const root = '@tileborne/runtime', load = ({ root = require(root + '/net') } = {}) => root;\nexports.classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetDestructuredDefaultParameterShadowedRequireFixture),
      ).toEqual([]);

      const clientRuntimeNetDefaultParameterPositiveRequireFixture = writeFixture(
        'client-runtime-net-default-parameter-positive-require.cjs',
        "const root = '@tileborne/runtime', load = (value = require(root + '/net')) => value;\nexports.classify = load;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDefaultParameterPositiveRequireFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetDefaultParameterPositiveRequireFixture)}:1 require imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetNamedFunctionExpressionShadowedRequireFixture = writeFixture(
        'client-runtime-net-named-function-expression-shadowed-require.cjs',
        "const root = '@tileborne/runtime', load = function root() { return require(root + '/net'); };\nexports.classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetNamedFunctionExpressionShadowedRequireFixture),
      ).toEqual([]);

      const clientRuntimeNetNamedFunctionExpressionPositiveRequireFixture = writeFixture(
        'client-runtime-net-named-function-expression-positive-require.cjs',
        "const root = '@tileborne/runtime', load = function loader() { return require(root + '/net'); };\nexports.classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetNamedFunctionExpressionPositiveRequireFixture),
      ).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetNamedFunctionExpressionPositiveRequireFixture)}:1 require imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetSameDeclarationCatchShadowedRequireFixture = writeFixture(
        'client-runtime-net-same-declaration-catch-shadowed-require.cjs',
        "const root = '@tileborne/runtime', load = () => { try { return undefined; } catch (root) { return require(root + '/net'); } };\nexports.classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetSameDeclarationCatchShadowedRequireFixture),
      ).toEqual([]);

      const clientRuntimeNetSameDeclarationLocalShadowedRequireFixture = writeFixture(
        'client-runtime-net-same-declaration-local-shadowed-require.cjs',
        "const root = '@tileborne/runtime', load = (nextRoot) => { const root = nextRoot; return require(root + '/net'); };\nexports.classify = load;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNetSameDeclarationLocalShadowedRequireFixture),
      ).toEqual([]);

      const clientRuntimeNetForInShadowedRequireFixture = writeFixture(
        'client-runtime-net-for-in-shadowed-require.cjs',
        "const root = '@tileborne/runtime';\nexports.load = (roots) => { for (const root in roots) { require(root + '/net'); } };\n",
      );
      expect(clientViolationsFor(clientRuntimeNetForInShadowedRequireFixture)).toEqual([]);

      const clientRuntimeNetDestructuredForOfShadowedRequireFixture = writeFixture(
        'client-runtime-net-destructured-for-of-shadowed-require.cjs',
        "const root = '@tileborne/runtime';\nexports.load = (entries) => { for (const { root } of entries) { require(root + '/net'); } };\n",
      );
      expect(clientViolationsFor(clientRuntimeNetDestructuredForOfShadowedRequireFixture)).toEqual(
        [],
      );

      const clientRuntimeNetLaterDeclarationShadowedRequireFixture = writeFixture(
        'client-runtime-net-later-declaration-shadowed-require.cjs',
        "const root = '@tileborne/runtime';\nexports.load = (nextRoot) => { const loaded = require(root + '/net'); const root = nextRoot; return loaded; };\n",
      );
      expect(clientViolationsFor(clientRuntimeNetLaterDeclarationShadowedRequireFixture)).toEqual(
        [],
      );

      const clientRuntimeNetConstRequireImportEqualsFixture = writeFixture(
        'client-runtime-net-const-require-import-equals.ts',
        "const runtimeNet = require('@tileborne/runtime/net');\nexport const classify = runtimeNet.isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetConstRequireImportEqualsFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetConstRequireImportEqualsFixture)}:1 require imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetImportEqualsFixture = writeFixture(
        'client-runtime-net-import-equals.ts',
        "import net = require('@tileborne/runtime/net');\nexport const classify = net.isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetImportEqualsFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetImportEqualsFixture)}:1 import-equals imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetAliasedImportEqualsFixture = writeFixture(
        'client-runtime-net-aliased-import-equals.ts',
        "const runtimeNet = '@tileborne/runtime/net';\nimport net = require(runtimeNet);\nexport const classify = net.isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetAliasedImportEqualsFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetAliasedImportEqualsFixture)}:2 import-equals imports "@tileborne/runtime/net"`,
      );

      const clientRuntimeNetConcatenatedImportEqualsFixture = writeFixture(
        'client-runtime-net-concatenated-import-equals.ts',
        "const runtimeRoot = '@tileborne/runtime';\nconst runtimeNet = runtimeRoot + '/net';\nimport net = require(runtimeNet);\nexport const classify = net.isReconnectableCloseCode;\n",
      );
      expect(clientViolationsFor(clientRuntimeNetConcatenatedImportEqualsFixture)).toContain(
        `production client restricted dynamic root import: ${relativeRepoPath(clientRuntimeNetConcatenatedImportEqualsFixture)}:3 import-equals imports "@tileborne/runtime/net"`,
      );

      const clientAllowedAliasedDynamicFixture = writeFixture(
        'client-allowed-aliased-dynamic.ts',
        "const allowedRoot = 'react';\nexport const loadReact = () => import(allowedRoot);\n",
      );
      expect(clientViolationsFor(clientAllowedAliasedDynamicFixture)).toEqual([]);

      const clientWebSocketFixture = writeFixture(
        'client-websocket.js',
        'export const connect = (url) => new WebSocket(url);\n',
      );
      expect(clientViolationsFor(clientWebSocketFixture)).toContain(
        `direct WebSocket construction: ${relativeRepoPath(clientWebSocketFixture)}:1`,
      );

      const clientRuntimeObservationProjectionFixture = writeFixture(
        'client-runtime-observation-projection.ts',
        "export const observe = (observation) => {\n  if (observation._tag === 'reconnectAttempt') {\n    return observation.attempt;\n  }\n  return 0;\n};\n",
      );
      expect(clientViolationsFor(clientRuntimeObservationProjectionFixture)).toEqual([]);

      const clientRuntimeSameLineObservationProjectionFixture = writeFixture(
        'client-runtime-same-line-observation-projection.ts',
        "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') return observation.attempt; };\n",
      );
      expect(clientViolationsFor(clientRuntimeSameLineObservationProjectionFixture)).toEqual([]);

      const clientRuntimeDotThisProjectionFixture = writeFixture(
        'client-runtime-dot-this-projection.ts',
        "export function observe(observation) { if (observation._tag === 'reconnectAttempt') this.reconnectAttempts = observation.attempt; }\n",
      );
      expect(clientViolationsFor(clientRuntimeDotThisProjectionFixture)).toEqual([]);

      const clientRuntimeComputedThisProjectionFixture = writeFixture(
        'client-runtime-computed-this-projection.ts',
        "export function observe(observation) { if (observation._tag === 'reconnectAttempt') this['reconnectAttempts'] = observation.attempt; }\n",
      );
      expect(clientViolationsFor(clientRuntimeComputedThisProjectionFixture)).toContain(
        `reconnect observation projection receiver: ${relativeRepoPath(clientRuntimeComputedThisProjectionFixture)}:1`,
      );

      const clientRuntimeComputedThisTemplateProjectionFixture = writeFixture(
        'client-runtime-computed-this-template-projection.ts',
        'export function observe(observation) { if (observation._tag === "reconnectAttempt") this[`reconnectAttempts`] = observation.attempt; }\n',
      );
      expect(clientViolationsFor(clientRuntimeComputedThisTemplateProjectionFixture)).toContain(
        `reconnect observation projection receiver: ${relativeRepoPath(clientRuntimeComputedThisTemplateProjectionFixture)}:1`,
      );

      const clientRuntimeComputedThisAliasedProjectionFixture = writeFixture(
        'client-runtime-computed-this-aliased-projection.ts',
        "export function observe(observation) { const key = 'reconnectAttempts'; if (observation._tag === 'reconnectAttempt') this[key] = observation.attempt; }\n",
      );
      expect(clientViolationsFor(clientRuntimeComputedThisAliasedProjectionFixture)).toContain(
        `reconnect observation projection receiver: ${relativeRepoPath(clientRuntimeComputedThisAliasedProjectionFixture)}:1`,
      );

      const clientRuntimeParameterShadowedProjectionFixture = writeFixture(
        'client-runtime-parameter-shadowed-projection.ts',
        "const key = 'reconnectAttempts';\nexport function observe(key, observation, retryPolicy) { retryPolicy[key] = observation.attempt; }\n",
      );
      expect(clientViolationsFor(clientRuntimeParameterShadowedProjectionFixture)).toEqual([]);

      const clientRuntimeSameDeclarationParameterShadowedProjectionFixture = writeFixture(
        'client-runtime-same-declaration-parameter-shadowed-projection.ts',
        "const key = 'reconnectAttempts', observe = (key, observation, retryPolicy) => { retryPolicy[key] = observation.attempt; };\nexport const handler = observe;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeSameDeclarationParameterShadowedProjectionFixture),
      ).toEqual([]);

      const clientRuntimeDefaultParameterShadowedProjectionFixture = writeFixture(
        'client-runtime-default-parameter-shadowed-projection.ts',
        "const key = 'reconnectAttempts', observe = (key, leaked = (retryPolicy, observation) => retryPolicy[key] = observation.attempt) => leaked;\nexport const handler = observe;\n",
      );
      expect(clientViolationsFor(clientRuntimeDefaultParameterShadowedProjectionFixture)).toEqual(
        [],
      );

      const clientRuntimeDestructuredDefaultParameterShadowedProjectionFixture = writeFixture(
        'client-runtime-destructured-default-parameter-shadowed-projection.ts',
        "const key = 'reconnectAttempts', observe = ({ key = 'next' } = {}, leaked = (retryPolicy, observation) => retryPolicy[key] = observation.attempt) => leaked;\nexport const handler = observe;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeDestructuredDefaultParameterShadowedProjectionFixture),
      ).toEqual([]);

      const clientRuntimeDefaultParameterPositiveProjectionFixture = writeFixture(
        'client-runtime-default-parameter-positive-projection.ts',
        "const key = 'reconnectAttempts', observe = (leaked = (retryPolicy, observation) => retryPolicy[key] = observation.attempt) => leaked;\nexport const handler = observe;\n",
      );
      expect(clientViolationsFor(clientRuntimeDefaultParameterPositiveProjectionFixture)).toContain(
        `reconnect observation projection receiver: ${relativeRepoPath(clientRuntimeDefaultParameterPositiveProjectionFixture)}:1`,
      );

      const clientRuntimeNamedFunctionExpressionShadowedProjectionFixture = writeFixture(
        'client-runtime-named-function-expression-shadowed-projection.ts',
        "const key = 'reconnectAttempts', observe = function key(retryPolicy, observation) { retryPolicy[key] = observation.attempt; };\nexport const handler = observe;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNamedFunctionExpressionShadowedProjectionFixture),
      ).toEqual([]);

      const clientRuntimeNamedFunctionExpressionPositiveProjectionFixture = writeFixture(
        'client-runtime-named-function-expression-positive-projection.ts',
        "const key = 'reconnectAttempts', observe = function loader(retryPolicy, observation) { retryPolicy[key] = observation.attempt; };\nexport const handler = observe;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeNamedFunctionExpressionPositiveProjectionFixture),
      ).toContain(
        `reconnect observation projection receiver: ${relativeRepoPath(clientRuntimeNamedFunctionExpressionPositiveProjectionFixture)}:1`,
      );

      const clientRuntimeSameDeclarationCatchShadowedProjectionFixture = writeFixture(
        'client-runtime-same-declaration-catch-shadowed-projection.ts',
        "const key = 'reconnectAttempts', observe = (observation, retryPolicy) => { try { return undefined; } catch (key) { retryPolicy[key] = observation.attempt; } };\nexport const handler = observe;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeSameDeclarationCatchShadowedProjectionFixture),
      ).toEqual([]);

      const clientRuntimeLocalShadowedProjectionFixture = writeFixture(
        'client-runtime-local-shadowed-projection.ts',
        "const key = 'reconnectAttempts';\nexport function observe(nextKey, observation, retryPolicy) { const key = nextKey; retryPolicy[key] = observation.attempt; }\n",
      );
      expect(clientViolationsFor(clientRuntimeLocalShadowedProjectionFixture)).toEqual([]);

      const clientRuntimeSameDeclarationLocalShadowedProjectionFixture = writeFixture(
        'client-runtime-same-declaration-local-shadowed-projection.ts',
        "const key = 'reconnectAttempts', observe = (nextKey, observation, retryPolicy) => { const key = nextKey; retryPolicy[key] = observation.attempt; };\nexport const handler = observe;\n",
      );
      expect(
        clientViolationsFor(clientRuntimeSameDeclarationLocalShadowedProjectionFixture),
      ).toEqual([]);

      const clientRuntimeForOfShadowedProjectionFixture = writeFixture(
        'client-runtime-for-of-shadowed-projection.ts',
        "const key = 'reconnectAttempts';\nexport function observe(keys, observation, retryPolicy) { for (const key of keys) { retryPolicy[key] = observation.attempt; } }\n",
      );
      expect(clientViolationsFor(clientRuntimeForOfShadowedProjectionFixture)).toEqual([]);

      const clientRuntimeForInShadowedProjectionFixture = writeFixture(
        'client-runtime-for-in-shadowed-projection.ts',
        "const key = 'reconnectAttempts';\nexport function observe(keys, observation, retryPolicy) { for (const key in keys) { retryPolicy[key] = observation.attempt; } }\n",
      );
      expect(clientViolationsFor(clientRuntimeForInShadowedProjectionFixture)).toEqual([]);

      const clientRuntimeDestructuredForOfShadowedProjectionFixture = writeFixture(
        'client-runtime-destructured-for-of-shadowed-projection.ts',
        "const key = 'reconnectAttempts';\nexport function observe(entries, observation, retryPolicy) { for (const { key } of entries) { retryPolicy[key] = observation.attempt; } }\n",
      );
      expect(clientViolationsFor(clientRuntimeDestructuredForOfShadowedProjectionFixture)).toEqual(
        [],
      );

      const clientRuntimeLaterDeclarationShadowedProjectionFixture = writeFixture(
        'client-runtime-later-declaration-shadowed-projection.ts',
        "const key = 'reconnectAttempts';\nexport function observe(nextKey, observation, retryPolicy) { retryPolicy[key] = observation.attempt; const key = nextKey; }\n",
      );
      expect(clientViolationsFor(clientRuntimeLaterDeclarationShadowedProjectionFixture)).toEqual(
        [],
      );

      const clientCloseCodeParameterShadowedFixture = writeFixture(
        'client-close-code-parameter-shadowed.ts',
        'const closeCode = event.code;\nexport function classify(closeCode) { return closeCode === 4006; }\n',
      );
      expect(clientViolationsFor(clientCloseCodeParameterShadowedFixture)).toEqual([]);

      const clientCloseCodeSameDeclarationParameterShadowedFixture = writeFixture(
        'client-close-code-same-declaration-parameter-shadowed.ts',
        'const closeCode = event.code, classify = (closeCode) => closeCode === 4006;\nexport const ended = classify;\n',
      );
      expect(clientViolationsFor(clientCloseCodeSameDeclarationParameterShadowedFixture)).toEqual(
        [],
      );

      const clientCloseCodeDefaultParameterShadowedFixture = writeFixture(
        'client-close-code-default-parameter-shadowed.ts',
        'const closeCode = event.code, classify = (closeCode, ended = closeCode === 4006) => ended;\nexport const result = classify;\n',
      );
      expect(clientViolationsFor(clientCloseCodeDefaultParameterShadowedFixture)).toEqual([]);

      const clientCloseCodeDestructuredDefaultParameterShadowedFixture = writeFixture(
        'client-close-code-destructured-default-parameter-shadowed.ts',
        'const closeCode = event.code, classify = ({ closeCode = 4006 } = {}, ended = closeCode === 4006) => ended;\nexport const result = classify;\n',
      );
      expect(
        clientViolationsFor(clientCloseCodeDestructuredDefaultParameterShadowedFixture),
      ).toEqual([]);

      const clientCloseCodeDefaultParameterPositiveFixture = writeFixture(
        'client-close-code-default-parameter-positive.ts',
        'const closeCode = event.code, classify = (ended = closeCode === 4006) => ended;\nexport const result = classify;\n',
      );
      expect(clientViolationsFor(clientCloseCodeDefaultParameterPositiveFixture)).toContain(
        `close-event classification: ${relativeRepoPath(clientCloseCodeDefaultParameterPositiveFixture)}:1`,
      );

      const clientCloseCodeNamedFunctionExpressionShadowedFixture = writeFixture(
        'client-close-code-named-function-expression-shadowed.ts',
        'const closeCode = event.code, classify = function closeCode() { return closeCode === 4006; };\nexport const result = classify;\n',
      );
      expect(clientViolationsFor(clientCloseCodeNamedFunctionExpressionShadowedFixture)).toEqual(
        [],
      );

      const clientCloseCodeNamedFunctionExpressionPositiveFixture = writeFixture(
        'client-close-code-named-function-expression-positive.ts',
        'const closeCode = event.code, classify = function loader() { return closeCode === 4006; };\nexport const result = classify;\n',
      );
      expect(clientViolationsFor(clientCloseCodeNamedFunctionExpressionPositiveFixture)).toContain(
        `close-event classification: ${relativeRepoPath(clientCloseCodeNamedFunctionExpressionPositiveFixture)}:1`,
      );

      const clientCloseCodeSameDeclarationCatchShadowedFixture = writeFixture(
        'client-close-code-same-declaration-catch-shadowed.ts',
        'const closeCode = event.code, classify = () => { try { return false; } catch (closeCode) { return closeCode === 4006; } };\nexport const ended = classify;\n',
      );
      expect(clientViolationsFor(clientCloseCodeSameDeclarationCatchShadowedFixture)).toEqual([]);

      const clientCloseCodeLocalShadowedFixture = writeFixture(
        'client-close-code-local-shadowed.ts',
        'const closeCode = event.code;\nexport function classify(event) { const closeCode = event.detail; return closeCode === 4006; }\n',
      );
      expect(clientViolationsFor(clientCloseCodeLocalShadowedFixture)).toEqual([]);

      const clientCloseCodeSameDeclarationLocalShadowedFixture = writeFixture(
        'client-close-code-same-declaration-local-shadowed.ts',
        'const closeCode = event.code, classify = (event) => { const closeCode = event.detail; return closeCode === 4006; };\nexport const ended = classify;\n',
      );
      expect(clientViolationsFor(clientCloseCodeSameDeclarationLocalShadowedFixture)).toEqual([]);

      const clientComputedCloseCodeParameterShadowedFixture = writeFixture(
        'client-computed-close-code-parameter-shadowed.ts',
        "const key = 'code';\nexport function classify(key, event) { return event[key] === 4006; }\n",
      );
      expect(clientViolationsFor(clientComputedCloseCodeParameterShadowedFixture)).toEqual([]);

      const clientCloseCodeForOfShadowedFixture = writeFixture(
        'client-close-code-for-of-shadowed.ts',
        'const closeCode = event.code;\nexport function classify(codes) { for (const closeCode of codes) { if (closeCode === 4006) return true; } return false; }\n',
      );
      expect(clientViolationsFor(clientCloseCodeForOfShadowedFixture)).toEqual([]);

      const clientCloseCodeForInShadowedFixture = writeFixture(
        'client-close-code-for-in-shadowed.ts',
        'const closeCode = event.code;\nexport function classify(codes) { for (const closeCode in codes) { if (closeCode === 4006) return true; } return false; }\n',
      );
      expect(clientViolationsFor(clientCloseCodeForInShadowedFixture)).toEqual([]);

      const clientCloseCodeDestructuredForOfShadowedFixture = writeFixture(
        'client-close-code-destructured-for-of-shadowed.ts',
        'const closeCode = event.code;\nexport function classify(entries) { for (const { closeCode } of entries) { if (closeCode === 4006) return true; } return false; }\n',
      );
      expect(clientViolationsFor(clientCloseCodeDestructuredForOfShadowedFixture)).toEqual([]);

      const clientCloseCodeLaterDeclarationShadowedFixture = writeFixture(
        'client-close-code-later-declaration-shadowed.ts',
        'const closeCode = event.code;\nexport function classify(event) { const ended = closeCode === 4006; const closeCode = event.detail; return ended; }\n',
      );
      expect(clientViolationsFor(clientCloseCodeLaterDeclarationShadowedFixture)).toEqual([]);

      const adversarialReconnectObservationFixtures = [
        {
          name: 'client-reconnect-observation-cap.ts',
          source:
            "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') reconnectAttemptCap = 6; };\n",
          violation: 'reconnect attempt policy',
        },
        {
          name: 'client-reconnect-observation-backoff.ts',
          source:
            "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') reconnectBackoff = 250; };\n",
          violation: 'reconnect attempt policy',
        },
        {
          name: 'client-reconnect-observation-timer.ts',
          source:
            "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') reconnectTimer = setTimeout(reconnect, 250); };\n",
          violation: 'reconnect timer policy',
        },
        {
          name: 'client-reconnect-observation-fetch.ts',
          source:
            "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') reconnectFetch = fetch('/rooms/reconnect'); };\n",
          violation: 'reconnect fetch wrapper',
        },
        {
          name: 'client-reconnect-observation-increment.ts',
          source:
            "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') reconnectAttempts++; };\n",
          violation: 'manual reconnect attempt increment',
        },
        {
          name: 'client-reconnect-observation-websocket.ts',
          source:
            "export const observe = (observation, url) => { if (observation._tag === 'reconnectAttempt') new WebSocket(url); };\n",
          violation: 'direct WebSocket construction',
        },
        {
          name: 'client-reconnect-observation-close-classification.ts',
          source:
            "export const observe = (observation, socket) => { if (observation._tag === 'reconnectAttempt') socket.onclose = () => {}; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-direct-close-code.ts',
          source:
            "export const observe = (observation, event) => { if (observation._tag === 'reconnectAttempt' && event.code === 4006) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-computed-close-code.ts',
          source:
            "export const observe = (observation, event) => { if (observation._tag === 'reconnectAttempt' && event['code'] === 4006) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-computed-close-code-alias.ts',
          source:
            "export const observe = (observation, event) => { const key = 'code'; if (observation._tag === 'reconnectAttempt' && event[key] === 4006) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-wrapped-close-code.ts',
          source:
            "export const observe = (observation, event) => { if (observation._tag === 'reconnectAttempt' && (event.code as number)! === 4006) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-close-code-local-alias.ts',
          source:
            "export const observe = (observation, event) => { const closeCode = event.code; if (observation._tag === 'reconnectAttempt' && closeCode === 4006) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-same-declaration-close-code-alias.ts',
          source:
            "export const observe = (observation, event) => { const closeCode = event.code, ended = closeCode === 4006; if (observation._tag === 'reconnectAttempt' && ended) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-nested-same-declaration-close-code-alias.ts',
          source:
            "export const observe = (observation, event) => { const closeCode = event.code, ended = () => { const nested = closeCode === 4006; return nested; }; if (observation._tag === 'reconnectAttempt' && ended()) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-close-code-destructured-alias.ts',
          source:
            "export const observe = (observation, event) => { const { code: closeCode } = event; if (observation._tag === 'reconnectAttempt' && closeCode === 4006) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-close-code-computed-destructured-alias.ts',
          source:
            "export const observe = (observation, event) => { const key = 'code'; const { [key]: closeCode } = event; if (observation._tag === 'reconnectAttempt' && closeCode === 4006) return observation.attempt; };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-same-line-close-code.ts',
          source:
            "export const observe = (observation, event) => { if (observation._tag === 'reconnectAttempt') { const ended = event.code === 4006; return ended ? observation.attempt : 0; } };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-switch-close-code.ts',
          source:
            "export const observe = (observation, event) => { if (observation._tag !== 'reconnectAttempt') return 0; switch (event.code) { case 4006: return observation.attempt; default: return 0; } };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-switch-close-code-constant.ts',
          source:
            "const MATCH_ENDED_CLOSE_CODE = 4006; export const observe = (observation, event) => { if (observation._tag !== 'reconnectAttempt') return 0; switch (event.code) { case MATCH_ENDED_CLOSE_CODE: return observation.attempt; default: return 0; } };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-switch-close-code-case-alias.ts',
          source:
            "export const observe = (observation, event) => { const ended = 4006; if (observation._tag !== 'reconnectAttempt') return 0; switch (event.code) { case ended: return observation.attempt; default: return 0; } };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-switch-computed-close-code.ts',
          source:
            "export const observe = (observation, event) => { if (observation._tag !== 'reconnectAttempt') return 0; switch (event['code']) { case 4006: return observation.attempt; default: return 0; } };\n",
          violation: 'close-event classification',
        },
        {
          name: 'client-reconnect-observation-retry-policy-receiver.ts',
          source:
            "export const observe = (observation, retryPolicy) => { if (observation._tag === 'reconnectAttempt') retryPolicy.reconnectAttempts = observation.attempt; };\n",
          violation: 'reconnect observation projection receiver',
        },
        {
          name: 'client-reconnect-observation-computed-retry-policy-receiver.ts',
          source:
            "export const observe = (observation, retryPolicy) => { if (observation._tag === 'reconnectAttempt') retryPolicy['reconnectAttempts'] = observation.attempt; };\n",
          violation: 'reconnect observation projection receiver',
        },
        {
          name: 'client-reconnect-observation-same-declaration-computed-retry-policy-receiver.ts',
          source:
            "export const observe = (observation, retryPolicy) => { const key = 'reconnectAttempts', leaked = retryPolicy[key] = observation.attempt; if (observation._tag === 'reconnectAttempt') return leaked; };\n",
          violation: 'reconnect observation projection receiver',
        },
        {
          name: 'client-reconnect-observation-nested-same-declaration-computed-retry-policy-receiver.ts',
          source:
            "export const observe = (observation, retryPolicy) => { const key = 'reconnectAttempts', leaked = () => { const nested = retryPolicy[key] = observation.attempt; return nested; }; if (observation._tag === 'reconnectAttempt') return leaked(); };\n",
          violation: 'reconnect observation projection receiver',
        },
        {
          name: 'client-reconnect-observation-cap-before-projection.ts',
          source:
            "export const observe = (observation) => { const reconnectAttemptCap = 6; if (observation._tag === 'reconnectAttempt') return observation.attempt; };\n",
          violation: 'reconnect attempt policy',
        },
        {
          name: 'client-reconnect-observation-cap-after-projection.ts',
          source:
            "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') return observation.attempt; const reconnectAttemptCap = 6; };\n",
          violation: 'reconnect attempt policy',
        },
        {
          name: 'client-reconnect-observation-backoff-before-projection.ts',
          source:
            "export const observe = (observation) => { const reconnectBackoff = 250; if (observation._tag === 'reconnectAttempt') return observation.attempt; };\n",
          violation: 'reconnect attempt policy',
        },
        {
          name: 'client-reconnect-observation-backoff-after-projection.ts',
          source:
            "export const observe = (observation) => { if (observation._tag === 'reconnectAttempt') return observation.attempt; const reconnectBackoff = 250; };\n",
          violation: 'reconnect attempt policy',
        },
      ] as const;
      for (const fixture of adversarialReconnectObservationFixtures) {
        const filePath = writeFixture(fixture.name, fixture.source);
        expect(clientViolationsFor(filePath)).toContain(
          `${fixture.violation}: ${relativeRepoPath(filePath)}:1`,
        );
      }

      const combinedSameLineFixture = writeFixture(
        'client-reconnect-observation-combined-same-line-aliases.ts',
        "export const observe = (observation, event, retryPolicy) => { const codeKey = 'code', attemptKey = 'reconnectAttempts', closeCode = event[codeKey], ended = closeCode === 4006, leaked = retryPolicy[attemptKey] = observation.attempt; if (observation._tag === 'reconnectAttempt' && ended) return leaked; };\n",
      );
      expect(clientViolationsFor(combinedSameLineFixture)).toContain(
        `close-event classification: ${relativeRepoPath(combinedSameLineFixture)}:1`,
      );
      expect(clientViolationsFor(combinedSameLineFixture)).toContain(
        `reconnect observation projection receiver: ${relativeRepoPath(combinedSameLineFixture)}:1`,
      );

      const clientReconnectCapFixture = writeFixture(
        'client-reconnect-cap.ts',
        'const reconnectAttemptCap = 6;\nexport const cap = reconnectAttemptCap;\n',
      );
      expect(clientViolationsFor(clientReconnectCapFixture)).toContain(
        `reconnect attempt policy: ${relativeRepoPath(clientReconnectCapFixture)}:1`,
      );

      const clientReconnectBackoffFixture = writeFixture(
        'client-reconnect-backoff.ts',
        'const reconnectBackoff = 250;\nexport const backoff = reconnectBackoff;\n',
      );
      expect(clientViolationsFor(clientReconnectBackoffFixture)).toContain(
        `reconnect attempt policy: ${relativeRepoPath(clientReconnectBackoffFixture)}:1`,
      );

      const clientReconnectTimerFixture = writeFixture(
        'client-reconnect-timer.ts',
        'export const reconnectTimer = setTimeout(() => reconnect(), 1000);\n',
      );
      expect(clientViolationsFor(clientReconnectTimerFixture)).toContain(
        `reconnect timer policy: ${relativeRepoPath(clientReconnectTimerFixture)}:1`,
      );

      const clientReconnectFetchFixture = writeFixture(
        'client-reconnect-fetch.ts',
        "export const reconnectFetch = () => fetch('/rooms/reconnect');\n",
      );
      expect(clientViolationsFor(clientReconnectFetchFixture)).toContain(
        `reconnect fetch wrapper: ${relativeRepoPath(clientReconnectFetchFixture)}:1`,
      );

      const clientManualReconnectAttemptFixture = writeFixture(
        'client-manual-reconnect-attempt.ts',
        'export const bump = (state) => state.reconnectAttempts++;\n',
      );
      expect(clientViolationsFor(clientManualReconnectAttemptFixture)).toContain(
        `manual reconnect attempt increment: ${relativeRepoPath(clientManualReconnectAttemptFixture)}:1`,
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('keeps the canonical reusable client transport owner in packages/runtime/src/net', () => {
    const runtimeNetFiles = walkFiles({ rootDir: RUNTIME_NET_ROOT, extensions: ['.ts'] });
    const runtimeNetText = runtimeNetFiles
      .map((filePath) => fs.readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(runtimeNetText).toMatch(/\bmakeBrowserWebSocketTransport\b/);
    expect(runtimeNetText).toMatch(/\bmakeNetClient\b/);
    expect(runtimeNetText).toMatch(/\bisReconnectableCloseCode\b/);
    expect(runtimeNetText).toMatch(/\breconnectAttemptCap\b/);
  });
});

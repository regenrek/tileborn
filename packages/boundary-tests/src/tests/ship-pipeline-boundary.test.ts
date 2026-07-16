import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parseSourceFile } from '../lib/import-walker.js';
import { repoRoot } from '../lib/repo-root.js';
import { sourceWithoutComments } from '../lib/source-scan.js';
import { walkFiles } from '../lib/walk-files.js';

// M5 ship-pipeline boundaries (S4): `tileborne game build` bakes assembled
// RuntimeMapPackages into the canonical game-host export for BOTH ship
// targets, and the artifact contract + target set are hard-cut. These pins
// keep the contract from drifting:
// - the BundledManifest carries hashed map-package entries (schema-level pin
//   on the interface + the manifest hash payload, not a golden file);
// - BuildTarget is exactly ["cloudflare", "local"] everywhere it is declared
//   (the "node"/"web" stub targets and their bundle.js writer are gone);
// - the M5 ship-pipeline owner modules stay plugin-NEUTRAL (no BR/brand
//   literals — the CLI init TEMPLATE data may name a default plugin, so the
//   CLI package is deliberately out of scope here).

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Pin 1: the game build artifact contract — BundledManifest map entries.
// ---------------------------------------------------------------------------

const GAME_HOST_TYPES_FILE = path.join(repoRoot, 'apps/game-host/src/types.ts');
const GAME_HOST_MANIFEST_FILE = path.join(repoRoot, 'apps/game-host/src/build/manifest.ts');

/** Property name → printed type text of one interface declaration. */
const interfaceMembers = (filePath: string, interfaceName: string): ReadonlyMap<string, string> => {
  const sourceFile = parseSourceFile(filePath);
  let members: Map<string, string> | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      members = new Map(
        node.members.flatMap((member) =>
          ts.isPropertySignature(member) &&
          ts.isIdentifier(member.name) &&
          member.type !== undefined
            ? [[member.name.text, member.type.getText()] as const]
            : [],
        ),
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (members === undefined) {
    throw new Error(`interface ${interfaceName} not found in ${relativeRepoPath(filePath)}`);
  }
  return members;
};

describe('M5 game build artifact contract (BundledManifest map packages)', () => {
  it('BundledManifest carries map-package summaries', () => {
    const manifest = interfaceMembers(GAME_HOST_TYPES_FILE, 'BundledManifest');
    expect(manifest.get('maps')).toBe('readonly BundledMapPackageSummary[]');
    expect(manifest.get('buildId')).toBe('ContentHash');
  });

  it('each bundled map package is identified and content-hashed per file', () => {
    const summary = interfaceMembers(GAME_HOST_TYPES_FILE, 'BundledMapPackageSummary');
    expect(summary.get('mapId')).toBe('string');
    expect(summary.get('packageId')).toBe('string');
    expect(summary.get('files')).toBe('readonly BundledManifestFileEntry[]');

    const entry = interfaceMembers(GAME_HOST_TYPES_FILE, 'BundledManifestFileEntry');
    expect(entry.get('path')).toBe('string');
    expect(entry.get('hash')).toBe('ContentHash');
    expect(entry.get('size')).toBe('number');
  });

  it('the manifest buildId hash covers the maps section', () => {
    // `buildId` is a content hash over the manifest payload — bundled map
    // packages must participate, so swapping a map changes the build id.
    const text = sourceWithoutComments(parseSourceFile(GAME_HOST_MANIFEST_FILE));
    expect(text).toContain('maps: payload.maps');
  });

  it('documents the workerFiles fixed-point convention next to the field', () => {
    // CONVENTION: `workerFiles` hashes the PRE-EMBED (pass-1) worker bytes.
    // The manifest is embedded into worker.js, so the builder bundles twice
    // and the shipped worker.js deliberately does NOT hash to the recorded
    // entries — `buildId` covers the pre-embed worker. The convention must
    // stay documented at the declaration (no silent exception): a verifier
    // reading the manifest as an integrity record has to learn the rule there.
    const fullText = parseSourceFile(GAME_HOST_TYPES_FILE).getFullText();
    const workerFilesIndex = fullText.indexOf('readonly workerFiles:');
    expect(workerFilesIndex).toBeGreaterThan(-1);
    const docWindow = fullText.slice(Math.max(0, workerFilesIndex - 800), workerFilesIndex);
    expect(docWindow).toContain('PRE-EMBED');
    expect(docWindow).toContain('fixed-point');
  });
});

// ---------------------------------------------------------------------------
// Pin 1b: the bundled development worker has one build owner.
// ---------------------------------------------------------------------------

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as Record<string, unknown>;

describe('game-host bundled worker build ownership', () => {
  it('keeps apps/game-host as the only TypeScript output owner for its dist directory', () => {
    const servicesBuildTsconfig = readJson('packages/services-build/tsconfig.json');
    const references = servicesBuildTsconfig.references as readonly { readonly path: string }[];

    expect(references.map((reference) => reference.path)).not.toContain('../../apps/game-host');
  });

  it('prepares the canonical bundled worker before services-build build and test', () => {
    const servicesBuildPackage = readJson('packages/services-build/package.json');
    const scripts = servicesBuildPackage.scripts as Record<string, string>;

    expect(scripts['prepare:game-host-worker']).toBe('pnpm --filter @tileborne/game-host build');
    expect(scripts.prebuild).toBe('pnpm run prepare:game-host-worker');
    expect(scripts.pretest).toBe(
      'pnpm run prepare:game-host-worker && tsc -b tsconfig.json --force',
    );
  });

  it('declares the workspace typecheck-to-services-build regression sequence', () => {
    const rootPackage = readJson('package.json');
    const scripts = rootPackage.scripts as Record<string, string>;

    expect(scripts['test:services-build-hermetic']).toBe(
      'pnpm typecheck && pnpm --filter @tileborne/game-host verify:bundled-worker && pnpm --filter @tileborne/services-build test',
    );
  });

  it('keeps bundled-worker verification with the game-host artifact owner', () => {
    const gameHostPackage = readJson('apps/game-host/package.json');
    const scripts = gameHostPackage.scripts as Record<string, string>;

    expect(scripts['verify:bundled-worker']).toBe('node scripts/verify-bundled-worker.mjs');
  });
});

// ---------------------------------------------------------------------------
// Pin 2: BuildTarget hard cut — ["cloudflare", "local"] only (M5 S2).
// ---------------------------------------------------------------------------

const BUILD_TARGET_DECLARATION_FILES = [
  'packages/services-build/src/model.ts',
  'packages/ipc-contracts/src/contracts/builds.ts',
] as const;

/** String elements of `BuildTarget = Schema.Literals([...])` in one file. */
const buildTargetLiterals = (filePath: string): readonly string[] => {
  const sourceFile = parseSourceFile(filePath);
  let literals: readonly string[] | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BuildTarget' &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer)
    ) {
      const argument = node.initializer.arguments[0];
      if (argument !== undefined && ts.isArrayLiteralExpression(argument)) {
        literals = argument.elements.flatMap((element) =>
          ts.isStringLiteral(element) ? [element.text] : [],
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (literals === undefined) {
    throw new Error(`BuildTarget literal declaration not found in ${filePath}`);
  }
  return literals;
};

describe('M5 BuildTarget hard cut', () => {
  it('every BuildTarget declaration is exactly ["cloudflare", "local"]', () => {
    for (const file of BUILD_TARGET_DECLARATION_FILES) {
      expect(buildTargetLiterals(path.join(repoRoot, file)), file).toEqual(['cloudflare', 'local']);
    }
  });

  it('no stub bundle.js writer survives in services-build', () => {
    // The retired node/web targets wrote a placeholder `bundle.js`; the real
    // pipeline emits `worker.js` via the game-host cloudflare builder.
    const violations: string[] = [];
    const files = walkFiles({
      rootDir: path.join(repoRoot, 'packages/services-build/src'),
      extensions: ['.ts'],
    }).filter((filePath) => !filePath.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const filePath of files) {
      const text = sourceWithoutComments(parseSourceFile(filePath));
      if (text.includes('bundle.js')) {
        violations.push(`${relativeRepoPath(filePath)} references the retired stub "bundle.js"`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pin 3: the M5 ship-pipeline owner modules stay plugin-neutral.
// ---------------------------------------------------------------------------

// The engine modules M5 added/rewrote. Plugin behavior is discovered via
// generic node-entry exports (`exportModeData`, `resolvePlayerModels`) and
// manifest-driven mode resolution — never plugin-id/brand literals. The CLI
// init templates (packages/cli) are exempt: template DATA may name the
// default shipped plugin, and the literal is CLI-owned
// (`DEFAULT_GAME_PLUGIN_ID` in packages/cli/src/commands/game/init-templates.ts) —
// engine packages do not bless it.
const SHIP_PIPELINE_NEUTRAL_ROOTS = [
  'packages/services-build/src/build',
  'packages/services-build/src/map-package',
  'apps/game-host/src/build',
] as const;

const SHIP_PIPELINE_NEUTRAL_FILES = [
  'packages/services-build/src/model.ts',
  'packages/services-build/src/local-game-host.ts',
  'packages/ipc-contracts/src/contracts/builds.ts',
] as const;

// Mirrors the map-package boundary denylist (brand/product/plugin names).
const FORBIDDEN_BRAND_TOKENS = [
  'petwars',
  'grassland',
  'erw:',
  '.pwmap',
  'battle-royale',
  'battleRoyale',
  'plugin-battle-royale',
  '@tileborne-plugins/',
] as const;

const shipPipelineSourceFiles = (): readonly string[] => [
  ...SHIP_PIPELINE_NEUTRAL_ROOTS.flatMap((root) =>
    walkFiles({ rootDir: path.join(repoRoot, root), extensions: ['.ts'] }),
  ).filter((filePath) => !filePath.endsWith('.test.ts')),
  ...SHIP_PIPELINE_NEUTRAL_FILES.map((file) => path.join(repoRoot, file)),
];

describe('M5 ship-pipeline neutrality', () => {
  it('scans a non-empty set of ship-pipeline source files', () => {
    expect(shipPipelineSourceFiles().length).toBeGreaterThan(SHIP_PIPELINE_NEUTRAL_FILES.length);
  });

  it('contains no brand, product, or plugin-name literals', () => {
    const violations: string[] = [];
    for (const filePath of shipPipelineSourceFiles()) {
      const text = sourceWithoutComments(parseSourceFile(filePath));
      for (const token of FORBIDDEN_BRAND_TOKENS) {
        if (text.includes(token)) {
          violations.push(
            `${relativeRepoPath(filePath)} contains forbidden brand literal "${token}"`,
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

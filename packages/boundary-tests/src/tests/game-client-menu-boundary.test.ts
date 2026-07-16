import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectImports, parseSourceFile } from '../lib/import-walker.js';
import { repoRoot } from '../lib/repo-root.js';
import { walkFiles } from '../lib/walk-files.js';

/**
 * ADR-0022 menu boundaries: the engine menu framework (`@tileborne/game-client`)
 * and the menu CONTRACTS (`plugin-api` menu additions, `core` BrandConfig) must
 * stay plugin- and brand-neutral, and `@tileborne/runtime` must stay React-free.
 * The shipped app (`apps/game-client`) IS the composition point and may import
 * plugins, so it is intentionally NOT scanned for plugin imports here.
 */

const GAME_CLIENT_ROOT = path.join(repoRoot, 'packages/game-client/src');
const RUNTIME_ROOT = path.join(repoRoot, 'packages/runtime/src');

const MENU_CONTRACT_FILES = [
  'packages/core/src/branding/index.ts',
  'packages/plugin-api/src/contributions.ts',
].map((relative) => path.join(repoRoot, relative));

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

// `@tileborne/plugin-api` is the brand-neutral CONTRACTS package (allowed); only
// concrete plugin packages are forbidden in the engine menu framework.
const PLUGIN_IMPORT_PATTERNS: readonly RegExp[] = [
  /^@tileborne-plugins\//,
  /^@tileborne\/plugin-(?!api(?:\/|$))/,
];

const BRAND_TOKEN_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'petwars literal', pattern: /\bpetwars\b/i },
  { name: 'grassland literal', pattern: /\bgrassland\b/i },
  { name: 'erw token', pattern: /\berw[:_-]/i },
  { name: 'pwmap extension', pattern: /\.pwmap\b/ },
];

const REACT_IMPORT_PATTERNS: readonly RegExp[] = [/^react$/, /^react-dom/, /^@tanstack\/react-/];

describe('ADR-0022 game-client menu boundaries', () => {
  it('engine menu framework imports no plugin packages', () => {
    const violations: string[] = [];
    for (const filePath of walkFiles({ rootDir: GAME_CLIENT_ROOT, extensions: ['.ts', '.tsx'] })) {
      const sourceFile = parseSourceFile(filePath);
      for (const collected of collectImports(sourceFile)) {
        if (PLUGIN_IMPORT_PATTERNS.some((pattern) => pattern.test(collected.moduleSpecifier))) {
          violations.push(
            `${relativeRepoPath(filePath)}:${collected.line} imports "${collected.moduleSpecifier}"`,
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('engine menu framework + menu contracts contain no plugin/brand literals', () => {
    const violations: string[] = [];
    const files = [
      ...walkFiles({ rootDir: GAME_CLIENT_ROOT, extensions: ['.ts', '.tsx', '.css'] }),
      ...MENU_CONTRACT_FILES,
    ];
    for (const filePath of files) {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const token of BRAND_TOKEN_PATTERNS) {
          if (token.pattern.test(line)) {
            violations.push(`${token.name}: ${relativeRepoPath(filePath)}:${index + 1}`);
          }
        }
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('keeps @tileborne/runtime React-free (the React home is @tileborne/game-client)', () => {
    const violations: string[] = [];
    for (const filePath of walkFiles({ rootDir: RUNTIME_ROOT, extensions: ['.ts', '.tsx'] })) {
      const sourceFile = parseSourceFile(filePath);
      for (const collected of collectImports(sourceFile)) {
        if (REACT_IMPORT_PATTERNS.some((pattern) => pattern.test(collected.moduleSpecifier))) {
          violations.push(
            `${relativeRepoPath(filePath)}:${collected.line} imports "${collected.moduleSpecifier}"`,
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('menu slot ids are brand-neutral dotted identifiers', () => {
    const contributions = fs.readFileSync(
      path.join(repoRoot, 'packages/plugin-api/src/contributions.ts'),
      'utf8',
    );
    const slotBlock = contributions.match(/RuntimeMenuSlot = Schema\.Literals\(\[([\s\S]*?)\]\)/);
    expect(slotBlock, 'RuntimeMenuSlot literal block not found').not.toBeNull();
    const ids = [...(slotBlock?.[1] ?? '').matchAll(/["']([^"']+)["']/g)].map(
      (match) => match[1] ?? '',
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id, `slot id "${id}" must be a neutral dotted identifier`).toMatch(
        /^[a-z]+(?:\.[a-zA-Z]+)+$/,
      );
    }
  });
});

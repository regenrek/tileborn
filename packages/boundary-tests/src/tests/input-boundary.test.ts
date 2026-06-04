import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectImports, parseSourceFile } from '../lib/import-walker.js';
import { repoRoot } from '../lib/repo-root.js';
import { sourceWithoutComments } from '../lib/source-scan.js';
import { walkFiles } from '../lib/walk-files.js';

// ADR-0024: forbidden-edge / no-baked-binding / open-vocabulary / worker-safe
// boundary tests for the NEUTRAL input modules — `packages/core/src/input/**`
// (durable schema + vocabulary) and the runtime `InputResolver`
// (`packages/runtime/src/input/resolver.ts`, the single raw→action GAMEPLAY
// path). The legacy generic `input.ts` accumulator (`Button`/`InputCommand`/
// `snapshot()` — the deprecated, test-only generic-runtime/netcode harness) is
// intentionally OUT of scope: the resolver is the data-driven path the renderer
// + game-host now use; the legacy harness is not on the gameplay path.

const CORE_INPUT_SRC = path.join(repoRoot, 'packages/core/src/input');
const RESOLVER_SRC = path.join(repoRoot, 'packages/runtime/src/input/resolver.ts');

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

const inputSourceFiles = (): readonly string[] => [
  ...walkFiles({ rootDir: CORE_INPUT_SRC, extensions: ['.ts'] }).filter(
    (filePath) => !filePath.endsWith('.test.ts'),
  ),
  RESOLVER_SRC,
];

const ALLOWED_EXTERNAL_PREFIXES = ['@tileborne/core', 'effect'] as const;
const isAllowedExternalImport = (specifier: string): boolean =>
  ALLOWED_EXTERNAL_PREFIXES.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );

const FORBIDDEN_IMPORT_PATTERNS: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'must not depend on @tileborne/plugin-api', pattern: /^@tileborne\/plugin-api(?:\/|$)/ },
  { rule: 'must not import a plugin package', pattern: /^@tileborne\/plugin-/ },
  { rule: 'must not import @tileborne/ipc-contracts', pattern: /^@tileborne\/ipc-contracts(?:\/|$)/ },
  { rule: 'must not import a runtime-loaded plugin', pattern: /^@tileborne-plugins\// },
  { rule: 'must not reach into apps/desktop', pattern: /apps\/desktop/ },
  { rule: 'must not reach into apps/game-host', pattern: /apps\/game-host/ },
  { rule: 'must not reach into packages/plugin-*', pattern: /packages\/plugin-/ },
  {
    rule: 'worker-safe: no Node builtin / native module',
    pattern: /^node:|^(?:fs|path|os|crypto|child_process|url|worker_threads)$/,
  },
  { rule: 'worker-safe: no Electron', pattern: /^electron(?:\/|$)/ },
  { rule: 'worker-safe: no React', pattern: /^react(?:-dom)?(?:\/|$)|^@tanstack\/react-/ },
  { rule: 'worker-safe: no Pixi/DOM renderer', pattern: /^pixi\.js(?:\/|$)|^@pixi\// },
];

const FORBIDDEN_BRAND_TOKENS = [
  'petwars',
  'grassland',
  'erw:',
  '.pwmap',
  'battle-royale',
  'battleRoyale',
  '@tileborne-plugins/',
] as const;

// No-baked-binding: a key/button IDENTITY literal must never appear in engine
// input code — bindings come ONLY from a decoded InputMap (ADR-0024). Matched as
// whole-word patterns so neutral words like "Digital"/"digital" do not trip the
// `Digit` key-code check; the resolver's `0:${axis}` gamepad-axes key is a
// device-index lookup, not a binding identity, and matches none of these.
const FORBIDDEN_BINDING_PATTERNS: readonly RegExp[] = [
  /\bSHOOT_KEY\b/,
  /\bKey[A-Z]\b/,
  /\bArrow(?:Up|Down|Left|Right)\b/,
  /\bDigit\d\b/,
  /\bNumpad\d\b/,
  /['"`]Space['"`]/,
];

// The engine must not name what an action DOES (gameplay intent semantics live
// in the plugin adapter, ADR-0024). The neutral action VOCABULARY (Move/Aim/
// PrimaryAction/Reload/…) is allowed; BR-intent terms are not.
const FORBIDDEN_SEMANTIC_TOKENS = ['shoot', 'aimDeg', 'weaponSlot', 'projectile'] as const;

const strippedSources = (): readonly { readonly file: string; readonly text: string }[] =>
  inputSourceFiles().map((filePath) => ({
    file: relativeRepoPath(filePath),
    text: sourceWithoutComments(parseSourceFile(filePath)),
  }));

describe('ADR-0024 neutral input module boundaries', () => {
  it('scans a non-empty set of neutral input source files', () => {
    expect(inputSourceFiles().length).toBeGreaterThan(0);
  });

  it('imports only @tileborne/core, effect, or a relative sibling', () => {
    const violations: string[] = [];
    for (const filePath of inputSourceFiles()) {
      const file = relativeRepoPath(filePath);
      for (const collected of collectImports(parseSourceFile(filePath))) {
        const specifier = collected.moduleSpecifier;
        if (specifier.startsWith('.') || isAllowedExternalImport(specifier)) {
          continue;
        }
        violations.push(`${file}:${collected.line} imports "${specifier}"`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('contains none of the forbidden import edges (plugin / app / platform)', () => {
    const violations: string[] = [];
    for (const filePath of inputSourceFiles()) {
      const file = relativeRepoPath(filePath);
      for (const collected of collectImports(parseSourceFile(filePath))) {
        for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
          if (forbidden.pattern.test(collected.moduleSpecifier)) {
            violations.push(
              `${file}:${collected.line} imports "${collected.moduleSpecifier}" — ${forbidden.rule}`,
            );
          }
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('contains no brand, product, or plugin-name literals', () => {
    const violations: string[] = [];
    for (const { file, text } of strippedSources()) {
      for (const token of FORBIDDEN_BRAND_TOKENS) {
        if (text.includes(token)) {
          violations.push(`${file} contains forbidden brand literal "${token}"`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('bakes in no key/button binding identity literals (bindings come from decoded data only)', () => {
    const violations: string[] = [];
    for (const { file, text } of strippedSources()) {
      for (const pattern of FORBIDDEN_BINDING_PATTERNS) {
        const match = pattern.exec(text);
        if (match !== null) {
          violations.push(`${file} bakes in a binding literal "${match[0]}"`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('names no gameplay-intent semantics (action→intent is plugin-only)', () => {
    const violations: string[] = [];
    for (const { file, text } of strippedSources()) {
      for (const token of FORBIDDEN_SEMANTIC_TOKENS) {
        if (new RegExp(`\\b${token}\\b`, 'i').test(text)) {
          violations.push(`${file} names gameplay-intent semantics "${token}"`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

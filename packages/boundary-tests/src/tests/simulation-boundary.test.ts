import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectImports, parseSourceFile } from '../lib/import-walker.js';
import { repoRoot } from '../lib/repo-root.js';
import { sourceWithoutComments } from '../lib/source-scan.js';
import { walkFiles } from '../lib/walk-files.js';

// ADR-0018 Slice 6: forbidden-edge / worker-safe / no-balance-constant /
// no-closed-enum / no-runtime-dependency boundary tests for
// `packages/simulation/**`. The neutral combat simulation is engine-owned,
// deterministic, and worker-safe: it owns combat *algorithms + schemas*, never
// balance *numbers*, a closed game-mode enum, or any plugin/runtime edge.

const SIMULATION_SRC = path.join(repoRoot, 'packages/simulation/src');
const SIMULATION_PACKAGE_JSON = path.join(repoRoot, 'packages/simulation/package.json');

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

// Shipped engine source only; `.test.ts` files exercise the engine and are not
// part of its worker-safe runtime surface (mirrors the catalog boundary test).
const simulationSourceFiles = (): readonly string[] =>
  walkFiles({ rootDir: SIMULATION_SRC, extensions: ['.ts'] }).filter(
    (filePath) => !filePath.endsWith('.test.ts'),
  );

// The only runtime dependencies ADR-0018 permits: the neutral catalog schema and
// Effect. Everything else (a relative `./` sibling aside) is a forbidden edge.
const ALLOWED_EXTERNAL_PREFIXES = ['@tileborne/core', 'effect'] as const;

const isAllowedExternalImport = (specifier: string): boolean =>
  ALLOWED_EXTERNAL_PREFIXES.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );

// Named forbidden edges (ADR-0018 "Forbidden edges and required boundary tests").
// The positive allow-list above already rejects these; the explicit patterns
// give a precise diagnostic and assert each ADR-named edge directly.
const FORBIDDEN_IMPORT_PATTERNS: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  {
    rule: 'must not depend on @tileborne/runtime (avoids runtime→simulation cycle)',
    pattern: /^@tileborne\/runtime(?:-wasm)?(?:\/|$)/,
  },
  {
    rule: 'must not depend on @tileborne/ipc-contracts',
    pattern: /^@tileborne\/ipc-contracts(?:\/|$)/,
  },
  { rule: 'must not depend on @tileborne/plugin-api', pattern: /^@tileborne\/plugin-api(?:\/|$)/ },
  { rule: 'must not import a plugin package', pattern: /^@tileborne\/plugin-/ },
  { rule: 'must not import a services package', pattern: /^@tileborne\/services-/ },
  { rule: 'must not import a runtime-loaded plugin', pattern: /^@tileborne-plugins\// },
  { rule: 'must not import a plugin deep path', pattern: /\/plugins\/[^/]+\/(?:src|dist)\// },
  { rule: 'must not reach into packages/runtime', pattern: /packages\/runtime/ },
  { rule: 'must not reach into packages/plugin-*', pattern: /packages\/plugin-/ },
  { rule: 'must not reach into packages/ipc-contracts', pattern: /packages\/ipc-contracts/ },
  { rule: 'must not reach into apps/desktop', pattern: /apps\/desktop/ },
  { rule: 'must not reach into apps/game-host', pattern: /apps\/game-host/ },
  // Worker-unsafe platform modules: no Node builtins, Electron, React, or Pixi.
  {
    rule: 'worker-safe: no Node builtin / native module',
    pattern: /^node:|^(?:fs|path|os|crypto|child_process|url|worker_threads)$/,
  },
  { rule: 'worker-safe: no Electron', pattern: /^electron(?:\/|$)/ },
  { rule: 'worker-safe: no React', pattern: /^react(?:-dom)?(?:\/|$)|^@tanstack\/react-/ },
  { rule: 'worker-safe: no Pixi/DOM renderer', pattern: /^pixi\.js(?:\/|$)|^@pixi\// },
];

// Brand / product / plugin-name literals that must never appear in the neutral
// engine (ADR-0018: no petwars/grassland/erw:/.pwmap/plugin-name literals).
const FORBIDDEN_BRAND_TOKENS = [
  'petwars',
  'grassland',
  'erw:',
  '.pwmap',
  'battle-royale',
  'battleRoyale',
  '@tileborne-plugins/',
] as const;

// Closed BR mode/role enum literals (ADR-0018: team identity is an open neutral
// value, never a closed `solo`/`duo`/`squad` enum engine-side).
const FORBIDDEN_MODE_TOKENS = ['solo', 'duo', 'squad'] as const;

// Ambient entropy: determinism requires the injected `SeededRng` be the single
// entropy source — no `Math.random`, `Date.now`, `performance.now`, or Web/Node
// crypto randomness.
const FORBIDDEN_ENTROPY_PATTERNS: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'no Math.random (use the injected SeededRng)', pattern: /\bMath\s*\.\s*random\b/ },
  { rule: 'no Date.now (deterministic SimulationClock only)', pattern: /\bDate\s*\.\s*now\b/ },
  {
    rule: 'no performance.now (deterministic SimulationClock only)',
    pattern: /\bperformance\s*\.\s*now\b/,
  },
  {
    rule: 'no crypto.getRandomValues (use the injected SeededRng)',
    pattern: /\bgetRandomValues\b/,
  },
];

// Numeric gameplay balance constants belong to plugin weapon data, not the
// engine (ADR-0018: "no default `damage = 25`, no default cooldown"). A
// balance-named binding may only be initialised to the neutral identity values
// `0` (zeroed timer/counter state) or `1` (multiplicative identity) — any other
// numeric literal is a baked-in balance default.
const BALANCE_KEYWORDS = [
  'damage',
  'cooldown',
  'ammo',
  'magazine',
  'reload',
  'falloff',
  'knockback',
  'radius',
  'range',
  'speed',
  'spread',
  'arc',
  'impulse',
  'velocity',
  'dps',
  'ttl',
  'charge',
] as const;
const BALANCE_LITERAL_PATTERN = new RegExp(
  `\\b(?:${BALANCE_KEYWORDS.join('|')})\\w*\\s*[:=]\\s*(-?(?:\\d+\\.\\d+|\\d+|\\.\\d+))`,
  'gi',
);
const NEUTRAL_BALANCE_VALUES = new Set([0, 1]);

const strippedSources = (): readonly { readonly file: string; readonly text: string }[] =>
  simulationSourceFiles().map((filePath) => ({
    file: relativeRepoPath(filePath),
    text: sourceWithoutComments(parseSourceFile(filePath)),
  }));

describe('ADR-0018 neutral combat simulation boundaries', () => {
  it('scans a non-empty set of simulation source files', () => {
    expect(simulationSourceFiles().length).toBeGreaterThan(0);
  });

  it('imports only @tileborne/core and effect (no runtime/plugin/platform edge)', () => {
    const violations: string[] = [];
    for (const filePath of simulationSourceFiles()) {
      const file = relativeRepoPath(filePath);
      for (const collected of collectImports(parseSourceFile(filePath))) {
        const specifier = collected.moduleSpecifier;
        if (specifier.startsWith('.') || isAllowedExternalImport(specifier)) {
          continue;
        }
        violations.push(
          `${file}:${collected.line} imports "${specifier}" (allowed: @tileborne/core, effect, or a relative path)`,
        );
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('contains none of the ADR-named forbidden import edges', () => {
    const violations: string[] = [];
    for (const filePath of simulationSourceFiles()) {
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

  it('declares only @tileborne/core and effect as package dependencies', () => {
    const packageJson = JSON.parse(fs.readFileSync(SIMULATION_PACKAGE_JSON, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = Object.keys(packageJson.dependencies ?? {});
    const forbidden = dependencies.filter((dependency) => !isAllowedExternalImport(dependency));
    expect(forbidden, `unexpected simulation dependencies: ${forbidden.join(', ')}`).toEqual([]);
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

  it('contains no closed mode/role enum literals (solo/duo/squad)', () => {
    const violations: string[] = [];
    for (const { file, text } of strippedSources()) {
      for (const token of FORBIDDEN_MODE_TOKENS) {
        const pattern = new RegExp(`['"\\\`]${token}['"\\\`]|\\b${token}\\b`, 'i');
        if (pattern.test(text)) {
          violations.push(`${file} contains forbidden closed-mode literal "${token}"`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('uses no ambient entropy (Math.random / Date.now / performance.now / crypto randomness)', () => {
    const violations: string[] = [];
    for (const { file, text } of strippedSources()) {
      for (const forbidden of FORBIDDEN_ENTROPY_PATTERNS) {
        if (forbidden.pattern.test(text)) {
          violations.push(`${file}: ${forbidden.rule}`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('bakes in no numeric gameplay balance constants', () => {
    const violations: string[] = [];
    for (const { file, text } of strippedSources()) {
      for (const match of text.matchAll(BALANCE_LITERAL_PATTERN)) {
        const literal = match[1];
        if (literal === undefined) {
          continue;
        }
        const value = Number(literal);
        if (!NEUTRAL_BALANCE_VALUES.has(value)) {
          violations.push(`${file} bakes in a balance constant: "${match[0].trim()}"`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

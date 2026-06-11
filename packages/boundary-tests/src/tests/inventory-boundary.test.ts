import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { collectImports, collectNamedImports, parseSourceFile } from '../lib/import-walker.js';
import { repoRoot } from '../lib/repo-root.js';
import { sourceWithoutComments } from '../lib/source-scan.js';

// ADR-0018 addendum (authoritative inventory & loot runtime), M3 S3:
// inventory-specific boundary pins on the neutral inventory/loot/grants
// modules in `packages/simulation`. The generic ADR-0018 scan in
// `simulation-boundary.test.ts` already covers the import allow-list,
// entropy, worker-safety, and the keyword-driven balance net for these files;
// this suite pins what the generic scan cannot see:
//
// 1. the EXACT closed `Schema.Literals` unions the modules may declare
//    (algorithm-level policy/reason vocabulary only — a closed item-kind /
//    tier / ammo-kind / equipment-slot content enum must fail),
// 2. no BR loot content vocabulary as quoted source literals,
// 3. no balance-constant seams (no SCREAMING_SNAKE numeric constants, no
//    numeric parameter defaults — capacities/radii/quantities stay
//    caller-supplied plugin content data),
// 4. catalog referenced BY ID ONLY: the exact `@tileborne/core` import
//    specifiers are pinned to type/id/GrantRef shapes, so a future catalog
//    resolution import (e.g. `mergeGameObjectCatalogs`) or a catalog JSON
//    import fails.

const SIMULATION_SRC = path.join(repoRoot, 'packages/simulation/src');

const INVENTORY_MODULE_FILES = [
  'ammo.ts',
  'grants.ts',
  'inventory-ops.ts',
  'inventory.ts',
  'loot.ts',
] as const;
type InventoryModuleFile = (typeof INVENTORY_MODULE_FILES)[number];

const moduleFilePath = (file: InventoryModuleFile): string => path.join(SIMULATION_SRC, file);

const relativeRepoPath = (file: InventoryModuleFile): string =>
  `packages/simulation/src/${file}`;

const strippedSource = (file: InventoryModuleFile): string =>
  sourceWithoutComments(parseSourceFile(moduleFilePath(file)));

// ---------------------------------------------------------------------------
// Pin 1: exact closed Schema.Literals unions
// ---------------------------------------------------------------------------

// The ONLY closed literal unions the inventory modules may declare: overflow
// policy and result/rejection reasons are algorithm vocabulary (they name what
// the engine DOES, not what content EXISTS). Anything else — a closed
// item-kind (`['pistol', 'rifle']`), tier (`['common', 'rare']`), ammo-kind,
// or equipment-slot union — is plugin content data and must fail this pin.
// `Schema.TaggedClass` / `Schema.TaggedErrorClass` `_tag` literals are not
// `Schema.Literals` unions and stay unaffected.
const ALLOWED_LITERAL_UNIONS: Readonly<
  Record<InventoryModuleFile, Readonly<Record<string, readonly string[]>>>
> = {
  'ammo.ts': {},
  'grants.ts': {},
  'inventory-ops.ts': {},
  'inventory.ts': {
    InventoryOverflowPolicy: ['drop-oldest', 'reject'],
    ItemDroppedReason: ['overflow', 'requested', 'defeat'],
    InventoryRejectedReason: ['capacity-full', 'not-held', 'slot-occupied', 'slot-empty'],
  },
  'loot.ts': {},
};

// Name of the variable declaration / class field a `Schema.Literals` call is
// bound to, so the pin reports `InventoryOverflowPolicy`, not an AST position.
const bindingName = (node: ts.Node): string => {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    current = current.parent;
  }
  return '(anonymous)';
};

/** Every `Schema.Literals([...])` union in the file, keyed by binding name. */
const schemaLiteralsUnions = (file: InventoryModuleFile): Record<string, readonly string[]> => {
  const sourceFile = parseSourceFile(moduleFilePath(file));
  const unions: Record<string, readonly string[]> = {};

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Schema' &&
      node.expression.name.text === 'Literals'
    ) {
      const argument = node.arguments[0];
      const members =
        argument !== undefined && ts.isArrayLiteralExpression(argument)
          ? argument.elements.flatMap((element) =>
              ts.isStringLiteralLike(element) ? [element.text] : [],
            )
          : [];
      unions[bindingName(node)] = members;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return unions;
};

// ---------------------------------------------------------------------------
// Pin 2: no BR loot content vocabulary as quoted literals
// ---------------------------------------------------------------------------

// BR loot/content vocabulary (current plugin literals plus the obvious
// nearby content words) that must never appear as a QUOTED literal in the
// neutral inventory modules — matched quote-delimited so identifiers and
// prose stay unaffected. Extends the simulation-wide brand denylist
// (`battle-royale` etc. in simulation-boundary.test.ts) with the loot-domain
// vocabulary this addendum introduces the temptation for.
const FORBIDDEN_CONTENT_VOCABULARY = [
  // item kinds (BR uses 'ammo-box' / 'supply-crate' today)
  'ammo-box',
  'supply-crate',
  'loot-crate',
  'health-pack',
  'medkit',
  'armor',
  'shield',
  'bandage',
  // rarity tiers (BR uses 'common' today)
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  // ammo kinds
  'light',
  'medium',
  'heavy',
  'shells',
  'energy',
  // weapon kinds
  'pistol',
  'rifle',
  'shotgun',
  'smg',
  'sniper',
] as const;

// ---------------------------------------------------------------------------
// Pin 3: no balance-constant seams
// ---------------------------------------------------------------------------

// SCREAMING_SNAKE constants are how BR carries its balance numbers
// (`LOOT_PICKUP_RADIUS`, `INVENTORY`); the neutral modules must declare none —
// every capacity/radius/quantity/weight is a caller argument.
const FORBIDDEN_CONSTANT_PATTERNS: readonly { readonly rule: string; readonly pattern: RegExp }[] =
  [
    {
      rule: 'no SCREAMING_SNAKE constant declaration (balance numbers are caller-supplied)',
      pattern: /\b(?:const|let|var)\s+[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*[:=]/,
    },
    {
      rule: 'no BR balance-constant identifier',
      pattern: /\b(?:LOOT_PICKUP_RADIUS|INVENTORY_CAPACITY)\b/,
    },
  ];

// Inventory-domain balance keywords the generic simulation-wide keyword net
// (damage/cooldown/radius/... in simulation-boundary.test.ts) does not carry.
// Same convention: a keyword-named binding may only be initialised to the
// neutral identity values 0/1.
const INVENTORY_BALANCE_KEYWORDS = [
  'capacity',
  'quantity',
  'weight',
  'amount',
  'stack',
  'pickup',
  'drop',
  'loot',
] as const;
const INVENTORY_BALANCE_PATTERN = new RegExp(
  `\\b(?:${INVENTORY_BALANCE_KEYWORDS.join('|')})\\w*\\s*[:=]\\s*(-?(?:\\d+\\.\\d+|\\d+|\\.\\d+))`,
  'gi',
);
const NEUTRAL_BALANCE_VALUES = new Set([0, 1]);

/** Parameter defaults that are numeric literals (incl. `-n`), per function. */
const numericParameterDefaults = (
  file: InventoryModuleFile,
): readonly { readonly line: number; readonly text: string }[] => {
  const sourceFile = parseSourceFile(moduleFilePath(file));
  const defaults: { readonly line: number; readonly text: string }[] = [];

  const isNumericLiteral = (expression: ts.Expression): boolean =>
    ts.isNumericLiteral(expression) ||
    (ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand));

  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.initializer !== undefined && isNumericLiteral(node.initializer)) {
      defaults.push({
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        text: node.getText(sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return defaults;
};

// ---------------------------------------------------------------------------
// Pin 4: catalog by id only — exact @tileborne/core import-specifier set
// ---------------------------------------------------------------------------

// The ONLY names the inventory modules may import from `@tileborne/core`:
// the catalog's grant reference union and branded ids. Catalog *resolution*
// (e.g. `mergeGameObjectCatalogs`, `GameObjectCatalog`, component schemas)
// stays caller-side — adding such an import must fail this pin.
const ALLOWED_CORE_IMPORT_SPECIFIERS = [
  'GrantRef',
  'ItemGrant',
  'WeaponGrant',
  'LootTableId',
  'ItemDefinitionId',
  'WeaponDefinitionId',
] as const;

const isCoreSpecifier = (moduleSpecifier: string): boolean =>
  moduleSpecifier === '@tileborne/core' || moduleSpecifier.startsWith('@tileborne/core/');

// Catalog JSON / plugin edges, asserted per inventory file for a precise
// diagnostic (the simulation-wide allow-list also rejects them).
const FORBIDDEN_MODULE_PATTERNS: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'must not import catalog JSON', pattern: /\.json$/ },
  { rule: 'must not import a plugin package', pattern: /^@tileborne\/plugin-|^@tileborne-plugins\// },
];

describe('ADR-0018 addendum inventory/loot module boundaries', () => {
  it('covers exactly the inventory module files (update the pin when the module grows)', () => {
    for (const file of INVENTORY_MODULE_FILES) {
      expect(fs.existsSync(moduleFilePath(file)), `${relativeRepoPath(file)} is missing`).toBe(
        true,
      );
    }
  });

  it('declares only the pinned algorithm-level Schema.Literals unions (no closed content enum)', () => {
    for (const file of INVENTORY_MODULE_FILES) {
      expect(
        schemaLiteralsUnions(file),
        `${relativeRepoPath(file)}: closed literal unions changed — a new union is a closed ` +
          'content enum unless it names engine behavior (policy/reason vocabulary)',
      ).toEqual(ALLOWED_LITERAL_UNIONS[file]);
    }
  });

  it('contains no BR loot content vocabulary as quoted literals', () => {
    const violations: string[] = [];
    for (const file of INVENTORY_MODULE_FILES) {
      const text = strippedSource(file);
      for (const token of FORBIDDEN_CONTENT_VOCABULARY) {
        if (new RegExp(`['"\`]${token}['"\`]`).test(text)) {
          violations.push(
            `${relativeRepoPath(file)} contains forbidden content literal '${token}'`,
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('declares no SCREAMING_SNAKE balance constant', () => {
    const violations: string[] = [];
    for (const file of INVENTORY_MODULE_FILES) {
      const text = strippedSource(file);
      for (const forbidden of FORBIDDEN_CONSTANT_PATTERNS) {
        if (forbidden.pattern.test(text)) {
          violations.push(`${relativeRepoPath(file)}: ${forbidden.rule}`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('bakes in no inventory-domain balance numbers (capacity/quantity/weight/... stay caller-supplied)', () => {
    const violations: string[] = [];
    for (const file of INVENTORY_MODULE_FILES) {
      const text = strippedSource(file);
      for (const match of text.matchAll(INVENTORY_BALANCE_PATTERN)) {
        const literal = match[1];
        if (literal === undefined) {
          continue;
        }
        if (!NEUTRAL_BALANCE_VALUES.has(Number(literal))) {
          violations.push(
            `${relativeRepoPath(file)} bakes in a balance constant: "${match[0].trim()}"`,
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('has no numeric parameter default (capacities/radii/quantities are explicit caller inputs)', () => {
    const violations: string[] = [];
    for (const file of INVENTORY_MODULE_FILES) {
      for (const found of numericParameterDefaults(file)) {
        violations.push(
          `${relativeRepoPath(file)}:${found.line} numeric parameter default "${found.text}"`,
        );
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('imports from @tileborne/core only the pinned type/id/GrantRef specifiers', () => {
    const violations: string[] = [];
    const allowed = new Set<string>(ALLOWED_CORE_IMPORT_SPECIFIERS);
    for (const file of INVENTORY_MODULE_FILES) {
      for (const named of collectNamedImports(parseSourceFile(moduleFilePath(file)))) {
        if (!isCoreSpecifier(named.moduleSpecifier)) {
          continue;
        }
        if (!allowed.has(named.name)) {
          violations.push(
            `${relativeRepoPath(file)}:${named.line} imports "${named.name}" from ` +
              `"${named.moduleSpecifier}" (allowed: ${[...allowed].join(', ')})`,
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('imports no catalog JSON and no plugin package', () => {
    const violations: string[] = [];
    for (const file of INVENTORY_MODULE_FILES) {
      for (const collected of collectImports(parseSourceFile(moduleFilePath(file)))) {
        for (const forbidden of FORBIDDEN_MODULE_PATTERNS) {
          if (forbidden.pattern.test(collected.moduleSpecifier)) {
            violations.push(
              `${relativeRepoPath(file)}:${collected.line} imports ` +
                `"${collected.moduleSpecifier}" — ${forbidden.rule}`,
            );
          }
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

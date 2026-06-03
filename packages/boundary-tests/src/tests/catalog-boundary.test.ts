import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectImports, collectNamedImports, parseSourceFile } from "../lib/import-walker.js";
import { repoRoot } from "../lib/repo-root.js";
import { walkFiles } from "../lib/walk-files.js";

const CATALOG_ROOT = path.join(repoRoot, "packages/core/src/catalog");
const RENDERER_ROOT = path.join(repoRoot, "apps/desktop/src/renderer");
const CATALOG_CONTRACT_FILE = path.join(
  repoRoot,
  "packages/ipc-contracts/src/contracts/catalog.ts",
);
const PLUGIN_PALETTE_CONTRIBUTIONS_FILE = path.join(
  RENDERER_ROOT,
  "lib/plugin-palette-contributions.ts",
);

// Worker-safe + plugin-neutral: the catalog runs in runtime/game-host workers
// and the editor, and must never reach into platform, plugin, or product code.
const FORBIDDEN_IMPORT_PATTERNS = [
  /^node:fs/,
  /^node:crypto/,
  /^node:os/,
  /^node:url/,
  /^electron$/,
  /^react$/,
  /^react-dom$/,
  /^pixi\.js$/,
  /^@tileborne\/plugin-/,
  /^@tileborne-plugins\//,
  /^@tileborne\/simulation/,
  /apps\/desktop/,
  /apps\/game-host/,
  /packages\/plugin-/,
  /petwars/i,
] as const;

// Brand/product/game-mode literals that must never appear in the neutral catalog.
const FORBIDDEN_TOKENS = [
  "petwars",
  "grassland",
  "erw:",
  ".pwmap",
  "battle-royale",
  "battleRoyale",
] as const;

// Numeric gameplay balance belongs to ADR-0018 / plugin data, referenced by id.
const FORBIDDEN_BALANCE_TOKENS = ["damage", "cooldown", "ammo", "falloff", "dps"] as const;

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

const sourceFiles = (): readonly string[] =>
  walkFiles({ rootDir: CATALOG_ROOT, extensions: [".ts"] }).filter(
    (filePath) => !filePath.endsWith(".test.ts"),
  );

describe("ADR-0019 game-object catalog boundaries", () => {
  it("keeps the catalog worker-safe and free of plugin/platform/product imports", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles()) {
      const file = relativeRepoPath(filePath);
      for (const collectedImport of collectImports(parseSourceFile(filePath))) {
        const specifier = collectedImport.moduleSpecifier;
        if (FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier))) {
          violations.push(`${file}:${collectedImport.line} imports ${specifier}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("contains no brand, product, or game-mode literals", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles()) {
      const file = relativeRepoPath(filePath);
      const content = fs.readFileSync(filePath, "utf8");
      for (const token of FORBIDDEN_TOKENS) {
        if (content.includes(token)) {
          violations.push(`${file} contains forbidden token "${token}"`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("contains no numeric gameplay balance fields", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles()) {
      const file = relativeRepoPath(filePath);
      const content = fs.readFileSync(filePath, "utf8").toLowerCase();
      for (const token of FORBIDDEN_BALANCE_TOKENS) {
        if (content.includes(token)) {
          violations.push(`${file} contains forbidden balance token "${token}"`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("models family/category as open branded strings, not closed literal unions", () => {
    const objectTypeSource = fs.readFileSync(path.join(CATALOG_ROOT, "object-type.ts"), "utf8");
    expect(objectTypeSource).toContain('Schema.brand("FamilyTag")');
    expect(objectTypeSource).toContain('Schema.brand("CategoryTag")');
    expect(objectTypeSource).not.toMatch(/Family\w*\s*=\s*Schema\.Literals/);
    expect(objectTypeSource).not.toMatch(/Category\w*\s*=\s*Schema\.Literals/);
  });

  it("does not reuse the asset-pack manifest as the carrier for catalog data", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles()) {
      const content = fs.readFileSync(filePath, "utf8");
      if (content.includes("AssetPackManifest")) {
        violations.push(`${relativeRepoPath(filePath)} references AssetPackManifest`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// ADR-0025 slice 2 (forbidden edges + DTO-driven browser). Scaffolded early to
// guard slices 4-8: the catalog authoring surface must stay plugin-neutral, the
// renderer catalog path must consume `catalog:*` IPC DTOs only, and the object
// palette must be a projection of the resolve DTO rather than a hardcoded plugin
// import.

// Brand/product/plugin-name literals forbidden in the neutral catalog contract.
const FORBIDDEN_CONTRACT_TOKENS = [
  "petwars",
  "grassland",
  "erw:",
  ".pwmap",
  "battle-royale",
  "battleRoyale",
  "BATTLE_ROYALE",
  "plugin-battle-royale",
] as const;

// Module specifiers the renderer catalog path must never reach for: the
// main-process-only plugin loader/merge home (`services-plugin`/`plugin-api`),
// concrete plugin packages, and plugin deep paths. The renderer consumes
// `@tileborne/core` types + `@tileborne/ipc-contracts` DTOs only.
const FORBIDDEN_CATALOG_IMPORT_PATTERNS = [
  /^@tileborne\/services-plugin(?:\/|$)/,
  /^@tileborne\/plugin-api(?:\/|$)/,
  /^@tileborne\/plugin-[^/]/,
  /^@tileborne-plugins\//,
  /\/plugins\/[^/]+\/(?:src|dist)\//,
  /\.tileborne\/plugins\//,
] as const;

// Node/Electron builtins are not available in (and must not leak into) the
// renderer catalog path.
const NODE_BUILTIN_IMPORT_PATTERN =
  /^(?:node:|electron$|fs$|fs\/|path$|os$|crypto$|child_process$|url$)/;

// The catalog-driven palette/authoring renderer surface. The battle-royale
// authoring panel (`components/plugins/battle-royale-authoring-panel.tsx`) is
// intentionally NOT in this set: it is the plugin-owned panel that may import
// its own `BATTLE_ROYALE_PALETTE_ACTIONS`; the generic catalog/palette path may
// not.
const CATALOG_RENDERER_PATH_MARKERS = [
  "catalog",
  "loot-source",
  "collision-footprint",
] as const;
const CATALOG_RENDERER_BASENAMES = new Set([
  "use-palette-actions.ts",
  "working-palette-sidebar.tsx",
  "working-palette-tab.tsx",
  "queries.ts",
]);

const catalogRendererFiles = (): readonly string[] =>
  walkFiles({ rootDir: RENDERER_ROOT, extensions: [".ts", ".tsx"] }).filter((filePath) => {
    if (filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx")) {
      return false;
    }
    const relative = relativeRepoPath(filePath);
    return (
      CATALOG_RENDERER_PATH_MARKERS.some((marker) => relative.includes(marker)) ||
      CATALOG_RENDERER_BASENAMES.has(path.basename(filePath))
    );
  });

describe("ADR-0025 catalog IPC contract neutrality", () => {
  it("contains no plugin/brand literals in contracts/catalog.ts", () => {
    const content = fs.readFileSync(CATALOG_CONTRACT_FILE, "utf8");
    const violations = FORBIDDEN_CONTRACT_TOKENS.filter((token) => content.includes(token)).map(
      (token) => `packages/ipc-contracts/src/contracts/catalog.ts contains forbidden literal "${token}"`,
    );
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("ADR-0025 renderer catalog path stays DTO-driven", () => {
  it("scans a non-empty set of catalog renderer files", () => {
    expect(catalogRendererFiles().length).toBeGreaterThan(0);
  });

  it("does not import services-plugin, the merge helper, Node/Electron, or plugin deep paths", () => {
    const violations: string[] = [];
    for (const filePath of catalogRendererFiles()) {
      const file = relativeRepoPath(filePath);
      const sourceFile = parseSourceFile(filePath);
      for (const collectedImport of collectImports(sourceFile)) {
        const specifier = collectedImport.moduleSpecifier;
        if (
          FORBIDDEN_CATALOG_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier)) ||
          NODE_BUILTIN_IMPORT_PATTERN.test(specifier)
        ) {
          violations.push(`${file}:${collectedImport.line} imports "${specifier}"`);
        }
      }
      // The merge helper is run only by the main-process catalog app service;
      // the renderer must read the projected `catalog:resolve`/`:validate` DTOs.
      const content = fs.readFileSync(filePath, "utf8");
      if (/\bmergeGameObjectCatalogs\b/.test(content)) {
        violations.push(`${file} references mergeGameObjectCatalogs (renderer must consume catalog:* DTOs)`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("ADR-0025 slice 4 object palette is resolve-DTO-driven", () => {
  it("removed the hardcoded plugin-palette-contributions.ts composition file", () => {
    expect(
      fs.existsSync(PLUGIN_PALETTE_CONTRIBUTIONS_FILE),
      `${relativeRepoPath(PLUGIN_PALETTE_CONTRIBUTIONS_FILE)} must not exist (slice-4 hard-cut)`,
    ).toBe(false);
  });

  it("no catalog/palette renderer file imports the hardcoded BR palette actions", () => {
    const forbiddenSymbols = new Set([
      "BATTLE_ROYALE_PALETTE_ACTIONS",
      "PLUGIN_PALETTE_CONTRIBUTIONS",
    ]);
    const violations: string[] = [];
    for (const filePath of catalogRendererFiles()) {
      const file = relativeRepoPath(filePath);
      const sourceFile = parseSourceFile(filePath);
      for (const named of collectNamedImports(sourceFile)) {
        if (forbiddenSymbols.has(named.name)) {
          violations.push(`${file}:${named.line} imports "${named.name}" from "${named.moduleSpecifier}"`);
        }
      }
      for (const collectedImport of collectImports(sourceFile)) {
        if (/^@tileborne\/plugin-battle-royale(?:\/|$)/.test(collectedImport.moduleSpecifier)) {
          violations.push(
            `${file}:${collectedImport.line} imports BR plugin module "${collectedImport.moduleSpecifier}"`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectImports, parseSourceFile } from "../lib/import-walker.js";
import { repoRoot } from "../lib/repo-root.js";
import { walkFiles } from "../lib/walk-files.js";

const CATALOG_ROOT = path.join(repoRoot, "packages/core/src/catalog");

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

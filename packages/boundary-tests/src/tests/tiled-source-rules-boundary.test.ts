import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectImports, parseSourceFile } from "../lib/import-walker.js";
import { repoRoot } from "../lib/repo-root.js";
import { walkFiles } from "../lib/walk-files.js";

const TILED_SOURCE_RULES_ROOT = path.join(repoRoot, "packages/sdk-tileset/src/tiled-source-rules");
const IPC_TILED_SOURCE_CONTRACT_FILES = [
  path.join(repoRoot, "packages/ipc-contracts/src/contracts/tiled-source-rules.ts"),
] as const;
const RENDERER_ROOT = path.join(repoRoot, "apps/desktop/src/renderer");

const WORKER_FORBIDDEN_IMPORTS = [
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:crypto",
  "node:os",
  "node:url",
  "node:buffer",
  "electron",
  "react",
  "react-dom",
  "pixi.js",
] as const;

const IPC_CONTRACT_FORBIDDEN_IMPORT_PATTERNS = [
  /^node:/,
  /^electron$/,
  /^apps\/desktop/,
  /^apps\/game-host/,
  /^@tileborne-plugins\//,
  /^@tileborne\/plugin-/,
  /^@tileborne\/runtime\/renderer/,
  /^@tileborne\/runtime\/net/,
  /packages\/plugin-/,
  /packages\/runtime\/renderer/,
  /packages\/runtime\/net/,
] as const;

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

const sourceFiles = (rootDir: string): readonly string[] =>
  walkFiles({ rootDir, extensions: [".ts", ".tsx"] }).filter((filePath) => !filePath.includes(`${path.sep}__tests__${path.sep}`));

describe("ADR-0016 Tiled source rule boundaries", () => {
  it("keeps the worker-safe Tiled source rule entry free of Node, Electron, React, and renderer imports", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles(TILED_SOURCE_RULES_ROOT)) {
      const file = relativeRepoPath(filePath);
      for (const collectedImport of collectImports(parseSourceFile(filePath))) {
        const specifier = collectedImport.moduleSpecifier;
        const forbidden = WORKER_FORBIDDEN_IMPORTS.some((moduleSpecifier) =>
          specifier === moduleSpecifier || specifier.startsWith(`${moduleSpecifier}/`)
        );
        const rendererReach = specifier.includes("apps/desktop") || specifier.includes("runtime/renderer");
        if (forbidden || rendererReach) {
          violations.push(`${file}:${collectedImport.line} imports ${specifier}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps desktop renderer code from importing Tiled source rule internals", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles(RENDERER_ROOT)) {
      const file = relativeRepoPath(filePath);
      for (const collectedImport of collectImports(parseSourceFile(filePath))) {
        if (collectedImport.moduleSpecifier.includes("tiled-source-rules")) {
          violations.push(`${file}:${collectedImport.line} imports ${collectedImport.moduleSpecifier}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps Tiled source IPC contracts engine-side and plugin-neutral", () => {
    const violations: string[] = [];
    for (const filePath of IPC_TILED_SOURCE_CONTRACT_FILES) {
      const file = relativeRepoPath(filePath);
      for (const collectedImport of collectImports(parseSourceFile(filePath))) {
        const specifier = collectedImport.moduleSpecifier;
        if (IPC_CONTRACT_FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier))) {
          violations.push(`${file}:${collectedImport.line} imports ${specifier}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

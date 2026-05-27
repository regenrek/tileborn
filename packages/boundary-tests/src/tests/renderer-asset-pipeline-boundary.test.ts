import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../lib/repo-root.js";
import { walkFiles } from "../lib/walk-files.js";

type ForbiddenPattern = {
  readonly name: string;
  readonly pattern: RegExp;
};

const RENDERER_ROOT = path.join(repoRoot, "apps/desktop/src/renderer");

const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  {
    name: "AssetPackManifestAsset symbol",
    pattern: /\bAssetPackManifestAsset\b/,
  },
  {
    name: "AssetPackManifest symbol",
    pattern: /\bAssetPackManifest\b/,
  },
  {
    name: "asset-pipeline import",
    pattern: /\bfrom\s+['"]@tileborne\/asset-pipeline['"]/,
  },
];

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

describe("ADR-0015 desktop renderer asset pipeline boundary", () => {
  it("keeps asset-pack manifest classes out of the renderer shell", () => {
    const violations: string[] = [];
    const files = walkFiles({ rootDir: RENDERER_ROOT, extensions: [".ts", ".tsx"] });

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? "";
        for (const forbidden of FORBIDDEN_PATTERNS) {
          if (forbidden.pattern.test(line)) {
            violations.push(
              `${forbidden.name}: ${relativeRepoPath(filePath)}:${lineIndex + 1}`,
            );
          }
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

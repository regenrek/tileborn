import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../lib/repo-root.js";
import { walkFiles } from "../lib/walk-files.js";

/**
 * ADR-0023 game-mode contract boundaries.
 *
 * The engine owns mode DISCOVERY + the neutral settings NAMESPACE as data:
 * - the game-mode contract owners (`core` game-mode/settings, `plugin-api`
 *   discovery + settings-form) must never name a concrete mode, brand, or
 *   persistence key (the namespace key is always derived from `pluginId`);
 * - the renderer must resolve modes by discovery, never a per-plugin-id
 *   `switch` or a literal-id enabled flag (`battleRoyaleEnabled` is removed);
 * - settings values persist only under `map.properties.<pluginId>` /
 *   `project.settings.<pluginId>` — no literal mode-named namespace key.
 *
 * The two-genre zero-engine-edit proof lives in
 * `packages/plugin-example-arena/src/discovery-decode.test.ts`.
 */

type ForbiddenPattern = {
  readonly name: string;
  readonly pattern: RegExp;
};

const RENDERER_ROOT = path.join(repoRoot, "apps/desktop/src/renderer");

/** Files/dirs that own the neutral game-mode contract (must stay mode-free). */
const CONTRACT_OWNER_ROOTS = [
  "packages/core/src/game-mode",
  "packages/core/src/settings",
] as const;

const CONTRACT_OWNER_FILES = [
  "packages/plugin-api/src/game-mode.ts",
  "packages/plugin-api/src/game-settings-form.ts",
] as const;

const CONTRACT_FORBIDDEN: readonly ForbiddenPattern[] = [
  { name: "mode literal", pattern: /battleRoyale|BATTLE_ROYALE|battle-royale/ },
  { name: "brand literal", pattern: /petwars|grassland|\.pwmap|erw:/ },
];

const RENDERER_FORBIDDEN: readonly ForbiddenPattern[] = [
  // The removed hardcoded inspector gate must not come back.
  { name: "literal-id enabled flag", pattern: /\bbattleRoyaleEnabled\b/ },
  // Mode resolution is a registry lookup, never a per-plugin-id switch.
  { name: "per-plugin-id switch", pattern: /switch\s*\(\s*pluginId\s*\)/ },
  // Settings persist under the per-plugin namespace, never a mode-named key.
  {
    name: "literal mode-named settings namespace",
    pattern: /properties\.battleRoyale|settings\.battleRoyale|['"]battleRoyale['"]/,
  },
];

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

const collectViolations = (
  files: readonly string[],
  patterns: readonly ForbiddenPattern[],
): string[] => {
  const violations: string[] = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      for (const forbidden of patterns) {
        if (forbidden.pattern.test(line)) {
          violations.push(`${forbidden.name}: ${relativeRepoPath(filePath)}:${lineIndex + 1}`);
        }
      }
    }
  }
  return violations;
};

describe("ADR-0023 game-mode contract boundary", () => {
  it("keeps mode/brand literals out of the game-mode contract owners", () => {
    // Source only: unit tests may use a plugin-id-shaped fixture string.
    const files = [
      ...CONTRACT_OWNER_ROOTS.flatMap((root) =>
        walkFiles({ rootDir: path.join(repoRoot, root), extensions: [".ts"] }),
      ).filter((file) => !file.endsWith(".test.ts")),
      ...CONTRACT_OWNER_FILES.map((file) => path.join(repoRoot, file)),
    ];
    const violations = collectViolations(files, CONTRACT_FORBIDDEN);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("renderer resolves modes by discovery — no id switch, enabled flag, or literal settings key", () => {
    const files = walkFiles({ rootDir: RENDERER_ROOT, extensions: [".ts", ".tsx"] });
    const violations = collectViolations(files, RENDERER_FORBIDDEN);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

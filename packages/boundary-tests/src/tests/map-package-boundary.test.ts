import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { collectImports, parseSourceFile } from "../lib/import-walker.js";
import { repoRoot } from "../lib/repo-root.js";
import { sourceWithoutComments } from "../lib/source-scan.js";
import { walkFiles } from "../lib/walk-files.js";

// ADR-0030 Slice 6: boundary tests for the neutral RuntimeMapPackage pipeline.
// `packages/core/src/map-package` owns the schema and `packages/runtime/src/
// map-package` owns the worker-safe loader + catalog registry — both must stay
// plugin-neutral: no brand/plugin literals, no closed role/genre enums (a
// placement's gameplay meaning derives from the placed type's catalog
// COMPONENTS, never a package-level role string). The BR `modeData.<pluginId>`
// section carries ONLY engine-opaque BR data, and hosts boot from the package
// — the monolithic untyped `ExportedArtifact` handoff is hard-cut.

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

// The two neutral map-package layers, each with its only permitted external
// imports (relative `./`/`../` siblings within the owning package aside).
const NEUTRAL_MAP_PACKAGE_LAYERS = [
  {
    root: "packages/core/src/map-package",
    allowedExternal: ["effect"],
  },
  {
    root: "packages/runtime/src/map-package",
    // The registry runs the canonical ADR-0019 merge from plugin-api; concrete
    // plugin packages stay forbidden.
    allowedExternal: ["@tileborne/core", "@tileborne/plugin-api", "effect"],
  },
] as const;

// Shipped source only; `.test.ts` files exercise the layer with genre-shaped
// fixtures and are not part of its neutral surface (mirrors the catalog test).
const mapPackageSourceFiles = (root: string): readonly string[] =>
  walkFiles({ rootDir: path.join(repoRoot, root), extensions: [".ts"] }).filter(
    (filePath) => !filePath.endsWith(".test.ts"),
  );

const isAllowedExternalImport = (
  specifier: string,
  allowedExternal: readonly string[],
): boolean =>
  allowedExternal.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));

// Brand / product / plugin-name literals that must never appear in the neutral
// package layer (mirrors the catalog/simulation neutrality denylists).
const FORBIDDEN_BRAND_TOKENS = [
  "petwars",
  "grassland",
  "erw:",
  ".pwmap",
  "battle-royale",
  "battleRoyale",
  "plugin-battle-royale",
  "@tileborne-plugins/",
] as const;

// BR genre vocabulary forbidden in the neutral layer (case-insensitive
// substring, so `spawnPoints`, `lootTables`, `shrinkSchedule`, and quoted role
// strings like "spawn-point"/"loot-crate" all trip). The component TAG names
// (`spawn-point`, `loot-source`, …) legitimately live in
// `packages/core/src/catalog/components.ts` — the package layer references
// catalog components generically and never names one.
const FORBIDDEN_GENRE_TOKENS = ["shrink", "loot", "spawn"] as const;

// The BR `ObjectPlacementRole` closed enum is hard-cut (ADR-0030): placements
// are role-free, so no role-named identifier or closed role literal union may
// return to the package/loader layer.
const FORBIDDEN_ROLE_PATTERNS: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  {
    rule: "no role identifier (placement meaning derives from catalog components)",
    pattern: /\b\w*[Rr]ole\w*\b/,
  },
  {
    rule: "no closed role/genre literal union",
    pattern: /Role\w*\s*=\s*Schema\.Literals/,
  },
];

const strippedLayerSources = (): readonly { readonly file: string; readonly text: string }[] =>
  NEUTRAL_MAP_PACKAGE_LAYERS.flatMap(({ root }) =>
    mapPackageSourceFiles(root).map((filePath) => ({
      file: relativeRepoPath(filePath),
      text: sourceWithoutComments(parseSourceFile(filePath)),
    })),
  );

describe("ADR-0030 neutral runtime map package boundaries", () => {
  it("scans a non-empty set of map-package source files in both layers", () => {
    for (const { root } of NEUTRAL_MAP_PACKAGE_LAYERS) {
      expect(mapPackageSourceFiles(root).length, `${root} has no source files`).toBeGreaterThan(0);
    }
  });

  it("imports only the layer's allowed neutral edges (no plugin/app/platform import)", () => {
    const violations: string[] = [];
    for (const { root, allowedExternal } of NEUTRAL_MAP_PACKAGE_LAYERS) {
      for (const filePath of mapPackageSourceFiles(root)) {
        const file = relativeRepoPath(filePath);
        for (const collected of collectImports(parseSourceFile(filePath))) {
          const specifier = collected.moduleSpecifier;
          if (specifier.startsWith(".") || isAllowedExternalImport(specifier, allowedExternal)) {
            continue;
          }
          violations.push(
            `${file}:${collected.line} imports "${specifier}" (allowed: ${allowedExternal.join(", ")}, or a relative path)`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("contains no brand, product, or plugin-name literals", () => {
    const violations: string[] = [];
    for (const { file, text } of strippedLayerSources()) {
      for (const token of FORBIDDEN_BRAND_TOKENS) {
        if (text.includes(token)) {
          violations.push(`${file} contains forbidden brand literal "${token}"`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("contains no BR genre vocabulary (shrink/loot/spawn)", () => {
    const violations: string[] = [];
    for (const { file, text } of strippedLayerSources()) {
      const lowered = text.toLowerCase();
      for (const token of FORBIDDEN_GENRE_TOKENS) {
        if (lowered.includes(token)) {
          violations.push(`${file} contains forbidden genre token "${token}"`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps placements role-free — no role identifiers or closed role enums", () => {
    const violations: string[] = [];
    for (const { file, text } of strippedLayerSources()) {
      for (const forbidden of FORBIDDEN_ROLE_PATTERNS) {
        if (forbidden.pattern.test(text)) {
          violations.push(`${file}: ${forbidden.rule}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// The BR `modeData.<pluginId>` section (ADR-0030 slice 5) carries ONLY what
// the engine cannot represent neutrally. boundary-tests has no plugin
// dependency, so the key set is pinned by parsing the schema source rather
// than importing `@tileborne/plugin-battle-royale` (the plugin-local
// counterpart pin lives in `packages/plugin-battle-royale/src/
// mode-data.test.ts`).

const MODE_DATA_SCHEMA_FILE = path.join(
  repoRoot,
  "packages/plugin-battle-royale/src/mode-data-schema.ts",
);

// The full permitted wire shape of `modeData.<br-plugin-id>`.
const ALLOWED_MODE_DATA_FIELDS = [
  "battleRoyale",
  "lootTables",
  "maxPlayers",
  "schemaVersion",
  "shrinkSchedule",
] as const;

// Neutral package sections that must NEVER be duplicated into mode data.
const FORBIDDEN_MODE_DATA_FIELDS = [
  "spawnPoints",
  "spawnAnchors",
  "placements",
  "objectPlacements",
  "playerModels",
  "overlayVisuals",
  "weaponVisuals",
  "collision",
  "tilesetPack",
  "map",
  "catalog",
] as const;

/** Field names of the `Schema.Class` object literal backing BattleRoyaleModeData. */
const battleRoyaleModeDataFields = (): readonly string[] => {
  const sourceFile = parseSourceFile(MODE_DATA_SCHEMA_FILE);
  let fields: readonly string[] | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === "BattleRoyaleModeData" &&
      node.heritageClauses !== undefined
    ) {
      for (const clause of node.heritageClauses) {
        for (const heritageType of clause.types) {
          // `extends Schema.Class<...>("BattleRoyaleModeData")({ ...fields })`
          const call = heritageType.expression;
          const argument = ts.isCallExpression(call) ? call.arguments[0] : undefined;
          if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
            fields = argument.properties.flatMap((property) =>
              ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
                ? [property.name.text]
                : [],
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (fields === undefined) {
    throw new Error(
      `BattleRoyaleModeData Schema.Class fields not found in ${relativeRepoPath(MODE_DATA_SCHEMA_FILE)}`,
    );
  }
  return fields;
};

describe("ADR-0030 BR modeData section stays engine-opaque", () => {
  it("carries only the engine-opaque BR fields", () => {
    expect([...battleRoyaleModeDataFields()].sort()).toEqual([...ALLOWED_MODE_DATA_FIELDS]);
  });

  it("duplicates no neutral package section into the mode data", () => {
    const fields = new Set(battleRoyaleModeDataFields());
    const violations = FORBIDDEN_MODE_DATA_FIELDS.filter((field) => fields.has(field)).map(
      (field) => `BattleRoyaleModeData duplicates neutral package section "${field}"`,
    );
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// Hosts boot from the encoded RuntimeMapPackage handed over via
// `RuntimePluginHost.getMapPackage()` / `mapPackage` room storage — the
// retired untyped artifact handoff identifiers must never return.

const HOST_ROOTS = ["apps/desktop/src/main", "apps/game-host/src"] as const;

// M5 S4 extension: the retired identifiers must not reappear in ANY engine
// package either — the ship pipeline (game build → bundled map packages →
// packageless /rooms/create) replaced the artifact handoff end to end.
const ENGINE_PACKAGE_ROOTS = [
  "packages/core/src",
  "packages/runtime/src",
  "packages/simulation/src",
  "packages/services-app/src",
  "packages/services-build/src",
  "packages/services-foundation/src",
  "packages/services-plugin/src",
  "packages/plugin-api/src",
  "packages/ipc-contracts/src",
] as const;

const FORBIDDEN_HOST_IDENTIFIER = /\b(?:runtimeArtifact|exportArtifact|getArtifact)\b/;

// Host inputs that must reference the package by its `mapPackage` handle.
const MAP_PACKAGE_CARRIER_FILES = [
  "apps/game-host/src/rooms/storage-schema.ts",
  "packages/ipc-contracts/src/contracts/runtime.ts",
] as const;

const PLAYTEST_HOST_FILE = "apps/desktop/src/main/playtest-runtime-host.ts";

const hostSourceFiles = (): readonly string[] =>
  HOST_ROOTS.flatMap((root) =>
    walkFiles({ rootDir: path.join(repoRoot, root), extensions: [".ts", ".tsx"] }),
  );

const engineSourceFiles = (): readonly string[] =>
  ENGINE_PACKAGE_ROOTS.flatMap((root) =>
    walkFiles({ rootDir: path.join(repoRoot, root), extensions: [".ts", ".tsx"] }),
  );

const retiredIdentifierViolations = (files: readonly string[]): readonly string[] => {
  const violations: string[] = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      if (FORBIDDEN_HOST_IDENTIFIER.test(line)) {
        violations.push(`${relativeRepoPath(filePath)}:${lineIndex + 1}: ${line.trim()}`);
      }
    }
  }
  return violations;
};

describe("ADR-0030 host package boundary", () => {
  it("scans a non-empty set of host source files", () => {
    expect(hostSourceFiles().length).toBeGreaterThan(0);
  });

  it("no host references the retired untyped-artifact identifiers", () => {
    const violations = retiredIdentifierViolations(hostSourceFiles());
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("no engine package references the retired untyped-artifact identifiers (M5)", () => {
    expect(engineSourceFiles().length).toBeGreaterThan(0);
    const violations = retiredIdentifierViolations(engineSourceFiles());
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("room and playtest host inputs carry the runtime map package", () => {
    for (const file of MAP_PACKAGE_CARRIER_FILES) {
      const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
      expect(content, `${file} must carry a mapPackage input`).toContain("mapPackage");
    }
    const playtestHost = fs.readFileSync(path.join(repoRoot, PLAYTEST_HOST_FILE), "utf8");
    expect(
      playtestHost,
      `${PLAYTEST_HOST_FILE} must hand plugins the package via getMapPackage`,
    ).toContain("getMapPackage");
  });

  // `modeData` is engine-OPAQUE (ADR-0030; codified at the M2 review, F2/N3):
  // hosts may store/forward the `modeData` object itself, but never read INTO
  // its per-plugin sections — capacity comes from the neutral
  // `manifest.playerCapacity`, diagnostics from the neutral sections. The scan
  // is pragmatic: property/key access on `modeData` and key enumeration over
  // it are both section reads. Tests are excluded — they build genre-shaped
  // fixtures by design.
  const MODE_DATA_SECTION_READS: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
    {
      rule: "indexes into a modeData section (modeData.<key> / modeData[...])",
      pattern: /\bmodeData\s*(?:\.\s*[A-Za-z_$]|\[)/,
    },
    {
      rule: "enumerates modeData sections (Object.keys/values/entries)",
      pattern: /Object\.(?:keys|values|entries)\([^)]*\bmodeData\b/,
    },
  ];

  it("no host reads modeData contents — the sections stay engine-opaque", () => {
    const violations: string[] = [];
    for (const filePath of hostSourceFiles()) {
      if (filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx")) {
        continue;
      }
      const text = sourceWithoutComments(parseSourceFile(filePath));
      for (const forbidden of MODE_DATA_SECTION_READS) {
        if (forbidden.pattern.test(text)) {
          violations.push(`${relativeRepoPath(filePath)}: ${forbidden.rule}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

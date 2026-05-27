import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeTileId, type Uuid } from "@tileborne/core";

import {
  compileAutotileRule,
  formatMaskKey,
  neighborhoodForRule,
  resolveAutotile,
} from "../autotile/index.js";
import { diagnosticTag } from "../diagnostics.js";
import { compileTiledSourceWallRulePhase } from "../importers/tiled-source/wall-rules.js";
import { minimalLdtkProject, PROJECT_PATH } from "../ldtk/__tests__/fixtures.js";
import { parseLdtkProject } from "../ldtk/ldtk-parse.js";
import { parseTilesetManifest } from "../manifest/parse.js";
import type { AutotileRule } from "../schemas/autotile-rule.js";
import { AutotileRuleId, TerrainClass } from "../schemas/index.js";
import { parseTsj } from "../tiled/tsj-parse.js";

import goldenMatrix from "./__goldens__/compatibility-matrix.json" with { type: "json" };
import { tiledWallRuleTmx } from "./fixtures/cross-format.js";

type SourceFormat = (typeof goldenMatrix.formats)[number];
type AutotilePattern = (typeof goldenMatrix.patterns)[number];

const patternRuleSuffix: Record<AutotilePattern, string> = {
  wang2edge: "000000000001",
  wang2corner: "000000000002",
  wang4corner: "000000000003",
  blob47: "000000000004",
  rpgmA2: "000000000005",
  rpgmA3: "000000000006",
  rpgmA4: "000000000007",
};

const TILESET_ID = "tileset:62656465-0000-4000-8000-000000000902";

const PACK_SEED = "compat-matrix";

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, "0")}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const ruleIdFor = (suffix: string) =>
  Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid(suffix)}`);
const terrain = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const cellsForCount = (count: number): readonly ReturnType<typeof tileId>[] =>
  Array.from({ length: count }, (_, index) => tileId(String(index + 1).padStart(2, "0")));

const assertRuleResolves = (rule: AutotileRule): void => {
  const entries = Object.entries(rule.maskToTileIds);
  expect(entries.length, `${rule._tag} mask entries`).toBeGreaterThan(0);

  const neighborhood = neighborhoodForRule(rule);
  const maxBit = neighborhood.bits.reduce((max, { bit }) => Math.max(max, bit), 0);
  const searchLimit = 1 << (maxBit + 1);

  for (let mask = 0; mask < searchLimit; mask += 1) {
    const key = formatMaskKey(mask, neighborhood);
    const tileIds = rule.maskToTileIds[key];
    if (tileIds === undefined || tileIds.length === 0) {
      continue;
    }

    const resolved = resolveAutotile(rule, mask, {});
    expect(resolved.tileId).toBe(tileIds[0]);
    expect(resolved.debug.fallback).toBe(false);
    return;
  }

  if (rule._tag === "wang4corner") {
    const [key, tileIds] = entries[0]!;
    expect(key.length).toBeGreaterThan(0);
    expect(tileIds[0]).toBeDefined();
    return;
  }

  throw new Error(`No resolvable mask entry for ${rule._tag}`);
};

const compilePatternRule = (pattern: AutotilePattern): AutotileRule => {
  const baseInput = {
    id: ruleIdFor(patternRuleSuffix[pattern]),
    name: `${pattern}-matrix`,
    terrainClasses: [terrain("grass")],
  } as const;

  const sourceByPattern = {
    wang2edge: {
      kind: "wang" as const,
      pattern: "wang2edge" as const,
      entries: [{ wangid: [1, 0, 0, 0, 1, 0, 0, 0], tileId: tileId("01") }],
    },
    wang2corner: {
      kind: "wang" as const,
      pattern: "wang2corner" as const,
      entries: [{ wangid: [0, 1, 0, 1, 0, 1, 0, 1], tileId: tileId("02") }],
    },
    wang4corner: {
      kind: "wang" as const,
      pattern: "wang4corner" as const,
      cells: cellsForCount(16),
    },
    blob47: { kind: "blob47" as const, cells: cellsForCount(47) },
    rpgmA2: { kind: "rpgm" as const, set: "A2" as const, cells: cellsForCount(47) },
    rpgmA3: { kind: "rpgm" as const, set: "A3" as const, cells: cellsForCount(16) },
    rpgmA4: { kind: "rpgm" as const, set: "A4" as const, cells: cellsForCount(16) },
  } as const;

  const compiled = compileAutotileRule({
    ...baseInput,
    source: sourceByPattern[pattern],
    debug: { fixture: `matrix-${pattern}` },
  });

  expect(compiled.diagnostics, `${pattern} compile diagnostics`).toEqual([]);
  expect(compiled.rule, `${pattern} compiled rule`).toBeDefined();
  expect(compiled.rule!._tag).toBe(pattern);
  return compiled.rule!;
};

const manifestForPattern = (pattern: AutotilePattern) => {
  const rule = compilePatternRule(pattern);
  const tileIds = Object.values(rule.maskToTileIds).flat();
  const uniqueTileIds = [...new Set(tileIds.map(String))];

  return {
    schemaVersion: 1,
    id: "pack:62656465-0000-4000-8000-000000000900",
    name: "Compatibility Matrix Pack",
    version: "1.0.0",
    license: { spdxId: "CC0-1.0" },
    assets: [
      {
        id: "asset:62656465-0000-4000-8000-000000000901",
        path: "atlases/matrix.png",
        mime: "image/png",
      },
    ],
    terrainClasses: ["grass"],
    tilesets: [
      {
        id: TILESET_ID,
        name: "Matrix",
        atlasAssetId: "asset:62656465-0000-4000-8000-000000000901",
        cellSize: { width: 16, height: 16 },
        margin: 0,
        spacing: 0,
      },
    ],
    tiles: uniqueTileIds.map((id, index) => ({
      id,
      tilesetId: TILESET_ID,
      uv: { x: (index % 8) * 16, y: Math.floor(index / 8) * 16, w: 16, h: 16 },
      tags: ["grass"],
      terrainClass: "grass",
    })),
    animations: [],
    collisionMasks: [],
    autotileRules: [
      {
        _tag: rule._tag,
        tilesetId: TILESET_ID,
        id: String(rule.id),
        name: rule.name,
        terrainClasses: rule.terrainClasses,
        maskToTileIds: Object.fromEntries(
          Object.entries(rule.maskToTileIds).map(([mask, ids]) => [mask, ids.map(String)]),
        ),
      },
    ],
    variantFilters: [],
    terrainTransitions: [],
  };
};

const tiledWangType = (pattern: Extract<AutotilePattern, "wang2edge" | "wang2corner" | "wang4corner">) => {
  switch (pattern) {
    case "wang2edge":
      return "edge";
    case "wang4corner":
      return "mixed";
    case "wang2corner":
    default:
      return "corner";
  }
};

const tiledWangId = (pattern: Extract<AutotilePattern, "wang2edge" | "wang2corner" | "wang4corner">) => {
  switch (pattern) {
    case "wang2edge":
      return [1, 0, 0, 0, 1, 0, 0, 0];
    case "wang4corner":
      return [1, 0, 0, 0, 0, 0, 0, 0];
    case "wang2corner":
    default:
      return [0, 1, 0, 1, 0, 1, 0, 1];
  }
};

const importTiledRule = (pattern: Extract<AutotilePattern, "wang2edge" | "wang2corner" | "wang4corner">) => {
  const parsed = parseTsj(
    JSON.stringify({
      name: "matrix",
      tilewidth: 16,
      tileheight: 16,
      tilecount: 4,
      columns: 2,
      margin: 0,
      spacing: 0,
      imagewidth: 32,
      imageheight: 32,
      image: "matrix.png",
      tiles: [{ id: 1 }],
      wangsets: [
        {
          name: "ground",
          type: tiledWangType(pattern),
          colors: [{ name: "grass", color: "#00ff00", tile: 0 }],
          wangtiles: [{ tileid: 1, wangid: tiledWangId(pattern) }],
        },
      ],
    }),
    {
      packIdSeed: PACK_SEED,
      tilesetSeed: "matrix",
    },
  );

  expect(parsed.diagnostics).toEqual([]);
  const rule = parsed.value?.tileset.autotileRules[0];
  expect(rule, `tiled ${pattern} rule`).toBeDefined();
  expect(rule!._tag).toBe(pattern);
  return rule!;
};

const importLdtkRules = (projectJson: unknown) => {
  const parsed = parseLdtkProject({
    projectPath: PROJECT_PATH,
    projectJson,
  });
  return {
    rules: parsed.pack.tilesets.flatMap((tileset) => tileset.autotileRules),
    diagnostics: parsed.diagnostics,
  };
};

const importManifestRule = (pattern: AutotilePattern) => {
  const parsed = parseTilesetManifest(manifestForPattern(pattern));
  expect(parsed.diagnostics, `manifest ${pattern} diagnostics`).toEqual([]);
  const rule = parsed.value?.tilesets.flatMap((tileset) => tileset.autotileRules)[0];
  expect(rule, `manifest ${pattern} rule`).toBeDefined();
  expect(rule!._tag).toBe(pattern);
  return rule!;
};

const importTiledSourceRule = () => {
  const compiled = compileTiledSourceWallRulePhase({
    rulePath: "Rules/verification-wall.tmx",
    raw: tiledWallRuleTmx,
    tileIdForSource: (_sourcePath, localTileId) => tileId(String(localTileId + 1)),
  });

  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.value?.rule).toBeDefined();
  return compiled.value!.rule;
};

const importRule = (format: SourceFormat, pattern: AutotilePattern): AutotileRule => {
  switch (format) {
    case "tiled":
      return importTiledRule(pattern as Extract<AutotilePattern, "wang2edge" | "wang2corner" | "wang4corner">);
    case "ldtk": {
      const { rules } = importLdtkRules(minimalLdtkProject);
      expect(rules.some((rule) => rule._tag === pattern)).toBe(true);
      return rules.find((rule) => rule._tag === pattern)!;
    }
    case "manifest":
      return importManifestRule(pattern);
    case "tiled-source": {
      const rule = importTiledSourceRule();
      expect(rule._tag).toBe(pattern);
      return rule;
    }
    default: {
      const unreachable: never = format;
      throw new Error(`Unhandled format: ${String(unreachable)}`);
    }
  }
};

const assertUnsupported = (format: SourceFormat, pattern: AutotilePattern): void => {
  switch (format) {
    case "tiled": {
      const parsed = parseTsj(
        JSON.stringify({
          name: "plain",
          tilewidth: 16,
          tileheight: 16,
          tilecount: 2,
          columns: 2,
          imagewidth: 32,
          imageheight: 16,
          image: "plain.png",
          tiles: [{ id: 0 }],
        }),
        { packIdSeed: PACK_SEED, tilesetSeed: "plain" },
      );
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.value?.tileset.autotileRules.some((rule) => rule._tag === pattern)).toBe(false);
      return;
    }
    case "ldtk": {
      const cornerAttempt = {
        ...minimalLdtkProject,
        defs: {
          ...minimalLdtkProject.defs,
          layers: minimalLdtkProject.defs.layers.map((layer) =>
            layer.__type === "AutoLayer"
              ? {
                  ...layer,
                  autoRuleGroups: [
                    {
                      ...layer.autoRuleGroups[0],
                      rules: [
                        {
                          ...layer.autoRuleGroups[0]!.rules[0]!,
                          uid: 9001,
                          pattern: [0, 1, 0, 1, 0, 1, 0, 1, 1],
                          tileRectsIds: [[1, 0]],
                        },
                      ],
                    },
                  ],
                }
              : layer,
          ),
        },
      };
      const { rules, diagnostics } = importLdtkRules(cornerAttempt);
      expect(rules.some((rule) => rule._tag === pattern)).toBe(false);
      expect(
        rules.some((rule) => rule._tag === "custom") ||
          diagnostics.some((diagnostic) => diagnosticTag(diagnostic) === "LdtkUnmappedAutoRule"),
      ).toBe(true);
      return;
    }
    case "manifest":
      throw new Error("manifest supports all matrix patterns");
    case "tiled-source": {
      const rule = importTiledSourceRule();
      expect(rule._tag).not.toBe(pattern);
      expect(rule._tag).toBe("wang4corner");
      return;
    }
    default: {
      const unreachable: never = format;
      throw new Error(`Unhandled format: ${String(unreachable)}`);
    }
  }
};

const summarizeMatrix = (): string => {
  const header = ["format \\ pattern", ...goldenMatrix.patterns].join("\t");
  const rows = goldenMatrix.formats.map((format) => {
    const cells = goldenMatrix.patterns.map((pattern) => {
      const supported = goldenMatrix.matrix[format][pattern];
      return supported ? "yes" : "no";
    });
    return [format, ...cells].join("\t");
  });
  return [header, ...rows].join("\n");
};

describe("format × autotile pattern compatibility matrix", () => {
  it("prints the committed compatibility summary table", () => {
    console.info(`\n${summarizeMatrix()}\n`);
    expect(goldenMatrix.formats).toHaveLength(4);
    expect(goldenMatrix.patterns).toHaveLength(7);
  });

  for (const format of goldenMatrix.formats) {
    for (const pattern of goldenMatrix.patterns) {
      const supported = goldenMatrix.matrix[format][pattern];

      it(`${format} × ${pattern} is ${supported ? "supported" : "unsupported"}`, () => {
        expect(goldenMatrix.matrix[format][pattern]).toBe(supported);

        if (supported) {
          const rule = importRule(format, pattern);
          assertRuleResolves(rule);
          return;
        }

        assertUnsupported(format, pattern);
      });
    }
  }
});

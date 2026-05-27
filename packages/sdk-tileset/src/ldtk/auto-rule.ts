import { Option } from "effect";

import type { ParseDiagnostic } from "../diagnostics.js";
import {
  CustomAutotileRule,
  Wang2EdgeAutotileRule,
  type AutotileRule,
} from "../schemas/autotile-rule.js";
import type { TileId } from "../schemas/ids.js";
import type { TerrainClass } from "../schemas/terrain-class.js";
import { formatMaskKey } from "../autotile/mask.js";
import { Around8Bits, Edge4Bits, NEIGHBORHOODS } from "../autotile/neighborhoods.js";

import { ldtkAutotileRuleId } from "./deterministic-id.js";

type LdtkAutoRule = {
  readonly uid: number;
  readonly active: boolean;
  readonly size: number;
  readonly pattern: readonly number[];
  readonly tileRectsIds: readonly (readonly number[])[];
  readonly tileMode: string;
  readonly checker: string;
  readonly perlinActive: boolean;
  readonly chance: number;
  readonly xModulo: number;
  readonly yModulo: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
};

const PATTERN_NEIGHBOR_BITS: ReadonlyArray<{ readonly index: number; readonly bit: number }> = [
  { index: 1, bit: Around8Bits.N },
  { index: 2, bit: Around8Bits.NE },
  { index: 5, bit: Around8Bits.E },
  { index: 8, bit: Around8Bits.SE },
  { index: 7, bit: Around8Bits.S },
  { index: 6, bit: Around8Bits.SW },
  { index: 3, bit: Around8Bits.W },
  { index: 0, bit: Around8Bits.NW },
];

const EDGE_NEIGHBORS = [
  { index: 1, bit: Edge4Bits.N },
  { index: 5, bit: Edge4Bits.E },
  { index: 7, bit: Edge4Bits.S },
  { index: 3, bit: Edge4Bits.W },
] as const;

const CORNER_PATTERN_INDICES = [0, 2, 6, 8] as const;

const isExoticRule = (rule: LdtkAutoRule): boolean =>
  !rule.active ||
  rule.size !== 3 ||
  rule.tileMode !== "Single" ||
  rule.checker !== "None" ||
  rule.perlinActive ||
  rule.chance < 1 ||
  rule.xModulo !== 1 ||
  rule.yModulo !== 1 ||
  rule.flipX ||
  rule.flipY;

const patternValueAt = (pattern: readonly number[], index: number): number | undefined =>
  index >= 0 && index < pattern.length ? pattern[index] : undefined;

const buildAround8Mask = (pattern: readonly number[]): string | undefined => {
  if (patternValueAt(pattern, 4) !== 1) {
    return undefined;
  }

  let mask = 0;
  for (const { index, bit } of PATTERN_NEIGHBOR_BITS) {
    const value = patternValueAt(pattern, index);
    if (value === 0) {
      return undefined;
    }
    if (value === 1) {
      mask |= 1 << bit;
    }
  }

  return formatMaskKey(mask, NEIGHBORHOODS.around8);
};

const buildWang2EdgeMask = (pattern: readonly number[]): string | undefined => {
  if (patternValueAt(pattern, 4) !== 1) {
    return undefined;
  }

  for (const index of CORNER_PATTERN_INDICES) {
    const value = patternValueAt(pattern, index);
    if (value !== 0 && value !== undefined) {
      return undefined;
    }
  }

  let mask = 0;
  for (const { index, bit } of EDGE_NEIGHBORS) {
    const value = patternValueAt(pattern, index);
    if (value === 0) {
      return undefined;
    }
    if (value === 1) {
      mask |= 1 << bit;
    }
  }

  return formatMaskKey(mask, NEIGHBORHOODS.edge4);
};

const tileIndexFromRect = (
  rect: readonly number[],
  columns: number,
): number | undefined => {
  if (rect.length === 1) {
    return rect[0];
  }
  if (rect.length >= 2) {
    const [x, y] = rect;
    return y! * columns + x!;
  }
  return undefined;
};

const tileIdsFromRects = (
  tileRectsIds: readonly (readonly number[])[],
  columns: number,
  tileIdForIndex: (index: number) => TileId,
): readonly TileId[] => {
  const ids: TileId[] = [];
  for (const rect of tileRectsIds) {
    const index = tileIndexFromRect(rect, columns);
    if (index !== undefined) {
      ids.push(tileIdForIndex(index));
    }
  }
  return ids;
};

export type CompileAutoRulesParams = {
  readonly projectPath: string;
  readonly layerUid: number;
  readonly layerIdentifier: string;
  readonly tilesetUid: number;
  readonly columns: number;
  readonly terrainClasses: readonly TerrainClass[];
  readonly ruleGroups: readonly { readonly rules: readonly LdtkAutoRule[] }[];
  readonly tileIdForIndex: (index: number) => TileId;
};

export type CompileAutoRulesResult = {
  readonly rules: readonly AutotileRule[];
  readonly diagnostics: readonly ParseDiagnostic[];
};

/** Convert LDtk auto-layer rule groups into Tileborne autotile rules. */
export const compileLdtkAutoRules = (params: CompileAutoRulesParams): CompileAutoRulesResult => {
  const rules: AutotileRule[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const maskAccumulator = new Map<string, TileId[]>();

  for (const group of params.ruleGroups) {
    for (const rule of group.rules) {
      const path = `/defs/layers/${params.layerIdentifier}/autoRuleGroups/${rule.uid}`;

      if (isExoticRule(rule)) {
        diagnostics.push({
          _tag: "LdtkUnmappedAutoRule",
          path,
          message: "Auto-layer rule uses unsupported LDtk features",
          severity: "warning",
          ruleUid: rule.uid,
          layerUid: params.layerUid,
          reason: "exotic-features",
        });
        continue;
      }

      const edgeMask = buildWang2EdgeMask(rule.pattern);
      const around8Mask = buildAround8Mask(rule.pattern);
      const mask = edgeMask ?? around8Mask;

      if (mask === undefined) {
        diagnostics.push({
          _tag: "LdtkUnmappedAutoRule",
          path,
          message: "Auto-layer rule pattern could not be mapped to a Wang mask",
          severity: "warning",
          ruleUid: rule.uid,
          layerUid: params.layerUid,
          reason: "unmapped-pattern",
        });
        continue;
      }

      const tileIds = tileIdsFromRects(rule.tileRectsIds, params.columns, params.tileIdForIndex);
      if (tileIds.length === 0) {
        diagnostics.push({
          _tag: "LdtkUnmappedAutoRule",
          path,
          message: "Auto-layer rule has no resolvable tile rectangles",
          severity: "warning",
          ruleUid: rule.uid,
          layerUid: params.layerUid,
          reason: "missing-tiles",
        });
        continue;
      }

      const existing = maskAccumulator.get(mask) ?? [];
      maskAccumulator.set(mask, [...existing, ...tileIds]);
    }
  }

  if (maskAccumulator.size === 0) {
    return { rules, diagnostics };
  }

  const maskToTileIds = Object.fromEntries(
    [...maskAccumulator.entries()]
      .filter(([, tileIds]) => tileIds.length > 0)
      .map(([mask, tileIds]) => [mask, tileIds as [TileId, ...TileId[]]]),
  );

  const ruleTag = [...maskAccumulator.keys()].every((mask) => mask.length === 4)
    ? "wang2edge"
    : "custom";

  if (ruleTag === "wang2edge") {
    rules.push(
      new Wang2EdgeAutotileRule({
        id: ldtkAutotileRuleId(params.projectPath, params.layerUid, params.layerUid),
        name: `${params.layerIdentifier}-auto`,
        terrainClasses: [...params.terrainClasses],
        maskToTileIds,
        fallbackTileId: Option.none(),
      }),
    );
    return { rules, diagnostics };
  }

  rules.push(
    new CustomAutotileRule({
      id: ldtkAutotileRuleId(params.projectPath, params.layerUid, params.layerUid),
      name: `${params.layerIdentifier}-auto`,
      terrainClasses: [...params.terrainClasses],
      maskToTileIds,
      fallbackTileId: Option.none(),
      source: {
        provider: "ldtk",
        layerUid: params.layerUid,
        tilesetUid: params.tilesetUid,
      },
    }),
  );

  return { rules, diagnostics };
};

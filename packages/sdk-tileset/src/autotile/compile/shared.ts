import { Option } from "effect";

import type { ParseDiagnostic } from "../../diagnostics.js";
import type { AutotileRule } from "../../schemas/autotile-rule.js";
import type { AutotileRuleId, TileId } from "../../schemas/ids.js";
import type { TerrainClass } from "../../schemas/terrain-class.js";
import { formatMaskKey, projectBlobMask } from "../mask.js";
import { NEIGHBORHOODS, type Neighborhood } from "../neighborhoods.js";

export type MaskToTileIds = Record<string, readonly [TileId, ...TileId[]]>;

export type CompileDebug = {
  readonly pattern: string;
  readonly mappedMaskCount: number;
  readonly sourceTileIndexes?: readonly number[];
  readonly sourceWangIds?: ReadonlyArray<ReadonlyArray<number>>;
};

export type CompileResult = {
  readonly rule?: AutotileRule;
  readonly debug: CompileDebug;
  readonly diagnostics: readonly ParseDiagnostic[];
};

export type RuleBaseInput = {
  readonly id: AutotileRuleId;
  readonly name: string;
  readonly terrainClasses: readonly TerrainClass[];
  readonly fallbackTileId?: TileId;
};

export const malformedLayout = (
  path: string,
  pattern: string,
  expectedCells: number,
  actualCells: number,
  message?: string,
): ParseDiagnostic => ({
  _tag: "MalformedAutotileLayout",
  path,
  message:
    message ??
    `Expected ${expectedCells} atlas cells for ${pattern}, received ${actualCells}`,
  severity: "error",
  pattern,
  expectedCells,
  actualCells,
});

export const appendTileForMask = (
  maskToTileIds: MaskToTileIds,
  key: string,
  tileId: TileId,
): void => {
  const existing = maskToTileIds[key];
  maskToTileIds[key] = existing ? [...existing, tileId] : [tileId];
};

export const compileFromMaskIndexTable = (input: {
  readonly path: string;
  readonly pattern: string;
  readonly cells: readonly (TileId | undefined)[];
  readonly expectedCells: number;
  readonly neighborhood: Neighborhood;
  readonly maskToIndex: Readonly<Record<number, number>>;
  readonly projectMask?: (mask: number) => number;
}): {
  readonly maskToTileIds: MaskToTileIds;
  readonly sourceTileIndexes: readonly number[];
  readonly diagnostics: readonly ParseDiagnostic[];
} => {
  const diagnostics: ParseDiagnostic[] = [];
  const definedCells = input.cells.filter((cell): cell is TileId => cell !== undefined);

  if (input.cells.length !== input.expectedCells) {
    diagnostics.push(
      malformedLayout(input.path, input.pattern, input.expectedCells, input.cells.length),
    );
  }

  const maskToTileIds: MaskToTileIds = {};
  const sourceTileIndexes: number[] = [];
  const project = input.projectMask ?? ((mask: number) => mask);

  for (const [maskValue, tileIndex] of Object.entries(input.maskToIndex)) {
    const mask = project(Number(maskValue));
    const key = formatMaskKey(mask, input.neighborhood);
    const tileId = input.cells[tileIndex];
    if (!tileId) {
      diagnostics.push({
        _tag: "MalformedAutotileLayout",
        path: `${input.path}/cells/${tileIndex}`,
        message: `Missing tile for ${input.pattern} atlas index ${tileIndex}`,
        severity: "error",
        pattern: input.pattern,
        expectedCells: input.expectedCells,
        actualCells: definedCells.length,
      });
      continue;
    }
    appendTileForMask(maskToTileIds, key, tileId);
    sourceTileIndexes.push(tileIndex);
  }

  return { maskToTileIds, sourceTileIndexes, diagnostics };
};

export const finalizeRule = <TRule extends AutotileRule>(
  rule: TRule,
  debug: Omit<CompileDebug, "mappedMaskCount"> & { readonly mappedMaskCount?: number },
  diagnostics: readonly ParseDiagnostic[],
): CompileResult => ({
  rule,
  debug: {
    ...debug,
    mappedMaskCount: Object.keys(rule.maskToTileIds).length,
  },
  diagnostics,
});

export const ruleBase = (
  input: RuleBaseInput,
  maskToTileIds: MaskToTileIds,
): {
  readonly id: AutotileRuleId;
  readonly name: string;
  readonly terrainClasses: readonly TerrainClass[];
  readonly maskToTileIds: MaskToTileIds;
  readonly fallbackTileId: Option.Option<TileId>;
} => ({
  id: input.id,
  name: input.name,
  terrainClasses: input.terrainClasses,
  maskToTileIds,
  fallbackTileId:
    input.fallbackTileId === undefined ? Option.none() : Option.some(input.fallbackTileId),
});

export const blobProjectMask = (mask: number): number => projectBlobMask(mask);

export const around8Neighborhood = NEIGHBORHOODS.around8;
export const edge4Neighborhood = NEIGHBORHOODS.edge4;
export const corner4Neighborhood = NEIGHBORHOODS.corner4;

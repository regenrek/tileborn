import { Blob47AutotileRule } from "../../schemas/autotile-rule.js";
import type { TileId } from "../../schemas/ids.js";

import { formatMaskKey } from "../mask.js";
import { NEIGHBORHOODS } from "../neighborhoods.js";
import {
  appendTileForMask,
  around8Neighborhood,
  blobProjectMask,
  compileFromMaskIndexTable,
  finalizeRule,
  ruleBase,
  type CompileResult,
  type RuleBaseInput,
} from "./shared.js";
import { BLOB47_MASK_TO_TILE_INDEX, BLOB47_TILE_COUNT } from "./tables.js";

export type CompileBlob47Input = RuleBaseInput & {
  readonly path?: string;
  readonly cells: readonly (TileId | undefined)[];
};

/** Compile a standard 47-tile blob manifest into a {@link Blob47AutotileRule}. */
export const compileBlob47 = (input: CompileBlob47Input): CompileResult => {
  const path = input.path ?? "/autotile/blob47";
  const { maskToTileIds, sourceTileIndexes, diagnostics } = compileFromMaskIndexTable({
    path,
    pattern: "blob47",
    cells: input.cells,
    expectedCells: BLOB47_TILE_COUNT,
    neighborhood: around8Neighborhood,
    maskToIndex: BLOB47_MASK_TO_TILE_INDEX,
    projectMask: blobProjectMask,
  });

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (hasErrors) {
    return {
      debug: { pattern: "blob47", mappedMaskCount: 0, sourceTileIndexes },
      diagnostics,
    };
  }

  const rule = new Blob47AutotileRule(ruleBase(input, maskToTileIds));
  return finalizeRule(rule, { pattern: "blob47", sourceTileIndexes }, diagnostics);
};

/** Map a projected around-8 mask to a blob47 atlas cell index, if known. */
export const blob47TileIndexForMask = (mask: number): number | undefined => {
  const projected = blobProjectMask(mask);
  return BLOB47_MASK_TO_TILE_INDEX[projected];
};

/** Register an explicit mask override on an in-progress blob table. */
export const assignBlob47Mask = (
  maskToTileIds: Record<string, readonly [TileId, ...TileId[]]>,
  mask: number,
  tileId: TileId,
): void => {
  const key = formatMaskKey(blobProjectMask(mask), NEIGHBORHOODS.around8);
  appendTileForMask(maskToTileIds, key, tileId);
};

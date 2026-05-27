import { cellsNeedingRefresh, NEIGHBORHOODS, neighborhoodForRule } from "../autotile/index.js";
import type { AutotileRuleId } from "../schemas/ids.js";
import type { AutotileRule } from "../schemas/autotile-rule.js";
import type { TerrainTransition } from "../schemas/terrain-transition.js";

import type { GridCell } from "./types.js";

const cellKey = (cell: GridCell): string => `${cell.x},${cell.y}`;

export type TransitionRefreshInput = {
  readonly changedCell: GridCell;
  readonly transitions: ReadonlyArray<TerrainTransition>;
  readonly ruleForId?: (ruleId: AutotileRuleId) => AutotileRule | undefined;
};

/**
 * Cells whose transition overlays depend on `changedCell` and need re-resolution
 * after that cell's terrain changes.
 */
export const transitionCellsToRefresh = ({
  changedCell,
  transitions,
  ruleForId,
}: TransitionRefreshInput): ReadonlyArray<GridCell> => {
  const seen = new Set<string>();
  const cells: GridCell[] = [];

  const addCells = (nextCells: ReadonlyArray<GridCell>): void => {
    for (const cell of nextCells) {
      const key = cellKey(cell);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      cells.push(cell);
    }
  };

  for (const transition of transitions) {
    const rule = ruleForId?.(transition.ruleId);
    const neighborhood = rule === undefined ? undefined : neighborhoodForRule(rule);
    if (neighborhood === undefined) {
      continue;
    }
    addCells(cellsNeedingRefresh(changedCell, neighborhood));
  }

  if (cells.length === 0 && transitions.length > 0) {
    addCells(cellsNeedingRefresh(changedCell, NEIGHBORHOODS.around8));
  }

  return cells;
};

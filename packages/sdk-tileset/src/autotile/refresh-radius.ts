import type { Neighborhood } from './neighborhoods.js';

export type GridCell = {
  readonly x: number;
  readonly y: number;
};

const cellKey = (cell: GridCell): string => `${cell.x},${cell.y}`;

/**
 * Cells whose autotile mask depends on `changedCell` and therefore need
 * re-resolution after that cell's terrain changes.
 */
export const cellsNeedingRefresh = (
  changedCell: GridCell,
  neighborhood: Neighborhood,
): ReadonlyArray<GridCell> => {
  const seen = new Set<string>();
  const cells: GridCell[] = [];

  const add = (x: number, y: number): void => {
    const cell = { x, y };
    const key = cellKey(cell);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    cells.push(cell);
  };

  add(changedCell.x, changedCell.y);

  for (const { dx, dy } of neighborhood.offsets) {
    add(changedCell.x - dx, changedCell.y - dy);
  }

  return cells;
};

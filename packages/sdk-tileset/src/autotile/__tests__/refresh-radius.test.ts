import { describe, expect, it } from 'vitest';

import { NEIGHBORHOODS, cellsNeedingRefresh } from '../index.js';

const asSet = (cells: ReadonlyArray<{ x: number; y: number }>) =>
  new Set(cells.map((cell) => `${cell.x},${cell.y}`));

describe('cellsNeedingRefresh', () => {
  const changedCell = { x: 4, y: 6 };

  it('returns the changed cell plus four cardinal neighbors for edge4', () => {
    const refreshed = cellsNeedingRefresh(changedCell, NEIGHBORHOODS.edge4);

    expect(refreshed).toHaveLength(5);
    expect(asSet(refreshed)).toEqual(
      asSet([changedCell, { x: 4, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 7 }, { x: 3, y: 6 }]),
    );
  });

  it('returns the changed cell plus eight surrounding neighbors for around8', () => {
    const refreshed = cellsNeedingRefresh(changedCell, NEIGHBORHOODS.around8);

    expect(refreshed).toHaveLength(9);
    expect(asSet(refreshed)).toEqual(
      asSet([
        changedCell,
        { x: 4, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
        { x: 4, y: 7 },
        { x: 3, y: 7 },
        { x: 3, y: 6 },
        { x: 3, y: 5 },
      ]),
    );
  });

  it('deduplicates corner4 refresh cells that overlap the changed cell', () => {
    const refreshed = cellsNeedingRefresh(changedCell, NEIGHBORHOODS.corner4);

    expect(refreshed).toHaveLength(4);
    expect(asSet(refreshed)).toEqual(
      asSet([changedCell, { x: 3, y: 6 }, { x: 3, y: 5 }, { x: 4, y: 5 }]),
    );
  });
});

import type { ParseDiagnostic } from '../diagnostics.js';
import type { CollisionMask } from '../schemas/collision-mask.js';

import type { CollisionCellSize } from './types.js';

const bitmaskCellCount = (subgrid: CollisionCellSize): number => subgrid.width * subgrid.height;

const bitmaskLimit = (cellCount: number): number =>
  cellCount >= 31 ? Number.MAX_SAFE_INTEGER : (1 << cellCount) - 1;

const usedBitmaskBits = (value: number): number => {
  if (value <= 0) {
    return 0;
  }
  return value.toString(2).length;
};

const validateBitmaskCollision = (
  mask: Extract<CollisionMask, { readonly _tag: 'bitmask' }>,
  subgrid: CollisionCellSize,
  tileId: string,
  path: string,
): ReadonlyArray<ParseDiagnostic> => {
  const expectedCells = bitmaskCellCount(subgrid);
  const expectedBits = usedBitmaskBits(bitmaskLimit(expectedCells));
  const actualBits = Math.max(usedBitmaskBits(mask.passable), usedBitmaskBits(mask.blocked));

  if (actualBits > expectedBits) {
    return [
      {
        _tag: 'CollisionMaskSizeMismatch',
        path,
        message: `Collision bitmask uses ${actualBits} bits but cell grid expects ${expectedCells} cells (${subgrid.width}x${subgrid.height})`,
        severity: 'error',
        tileId,
        expected: expectedCells,
        actual: actualBits,
      },
    ];
  }

  return [];
};

const validatePolygonCollision = (
  mask: Extract<CollisionMask, { readonly _tag: 'polygon' }>,
  cellSize: CollisionCellSize,
  tileId: string,
  path: string,
): ReadonlyArray<ParseDiagnostic> => {
  const diagnostics: ParseDiagnostic[] = [];

  for (const edge of mask.edges) {
    for (const [axis, value] of [
      ['x1', edge.x1],
      ['y1', edge.y1],
      ['x2', edge.x2],
      ['y2', edge.y2],
    ] as const) {
      const max = axis.startsWith('x') ? cellSize.width : cellSize.height;
      if (value < 0 || value > max) {
        diagnostics.push({
          _tag: 'InvalidCollisionVertex',
          path,
          message: `Collision polygon vertex ${axis}=${value} is outside tile bounds ${cellSize.width}x${cellSize.height}`,
          severity: 'error',
          tileId,
          axis,
          value,
          max,
        });
      }
    }
  }

  if (mask.edges.length > 0 && mask.edges.length < 3 && !mask.passable) {
    diagnostics.push({
      _tag: 'CollisionMaskSizeMismatch',
      path,
      message: 'Collision mask edge count does not match tile size',
      severity: 'error',
      tileId,
      expected: 4,
      actual: mask.edges.length,
    });
  }

  return diagnostics;
};

/** Validate collision mask geometry against tile cell size and optional subgrid resolution. */
export const validateCollisionMask = (
  mask: CollisionMask,
  cellSize: CollisionCellSize,
  options: {
    readonly tileId?: string;
    readonly path?: string;
    readonly subgrid?: CollisionCellSize;
  } = {},
): ReadonlyArray<ParseDiagnostic> => {
  const tileId = options.tileId ?? 'unknown';
  const path = options.path ?? '/collisionMask';
  const subgrid = options.subgrid ?? { width: 2, height: 2 };

  switch (mask._tag) {
    case 'bitmask':
      return validateBitmaskCollision(mask, subgrid, tileId, path);
    case 'polygon':
      return validatePolygonCollision(mask, cellSize, tileId, path);
    default: {
      const unreachable: never = mask;
      throw new Error(`Unsupported collision mask tag: ${String(unreachable)}`);
    }
  }
};

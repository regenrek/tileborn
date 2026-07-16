import { Around8Bits, Edge4Bits, type Neighborhood } from './neighborhoods.js';

/** Compute a bitmask from neighbor terrain membership. */
export const computeMask = (
  neighborhood: Neighborhood,
  sameTerrainAt: (dx: number, dy: number) => boolean,
): number => {
  let mask = 0;
  for (const { offset, bit } of neighborhood.bits) {
    if (sameTerrainAt(offset.dx, offset.dy)) {
      mask |= 1 << bit;
    }
  }
  return mask;
};

const bothEdgesSet = (mask: number, edgeA: number, edgeB: number): boolean =>
  (mask & (edgeA | edgeB)) === (edgeA | edgeB);

/**
 * Blob / 47-tile corner culling: unset a diagonal corner when either adjacent
 * cardinal edge is missing (Tiled Wang filler convention).
 */
export const projectBlobMask = (mask: number): number => {
  let projected = mask;

  if (!bothEdgesSet(projected, 1 << Edge4Bits.N, 1 << Edge4Bits.E)) {
    projected &= ~(1 << Around8Bits.NE);
  }
  if (!bothEdgesSet(projected, 1 << Edge4Bits.E, 1 << Edge4Bits.S)) {
    projected &= ~(1 << Around8Bits.SE);
  }
  if (!bothEdgesSet(projected, 1 << Edge4Bits.S, 1 << Edge4Bits.W)) {
    projected &= ~(1 << Around8Bits.SW);
  }
  if (!bothEdgesSet(projected, 1 << Edge4Bits.W, 1 << Edge4Bits.N)) {
    projected &= ~(1 << Around8Bits.NW);
  }

  return projected;
};

/** Format a mask as a compact binary lookup key in ascending bit order. */
export const formatMaskKey = (mask: number, neighborhood: Neighborhood): string =>
  [...neighborhood.bits]
    .sort((left, right) => left.bit - right.bit)
    .map(({ bit }) => ((mask >> bit) & 1).toString())
    .join('');

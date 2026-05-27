import { Effect } from "effect";

import { BroadphaseInputError } from "../errors.js";

export interface AabbId {
  readonly value: number;
}

export interface Aabb {
  readonly id: AabbId;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface BroadphasePair {
  readonly a: AabbId;
  readonly b: AabbId;
}

const overlaps1D = (minA: number, maxA: number, minB: number, maxB: number): boolean =>
  minA <= maxB && minB <= maxA;

const overlaps = (left: Aabb, right: Aabb): boolean =>
  overlaps1D(left.minX, left.maxX, right.minX, right.maxX) &&
  overlaps1D(left.minY, left.maxY, right.minY, right.maxY);

const normalizePair = (left: AabbId, right: AabbId): BroadphasePair => {
  if (left.value <= right.value) {
    return { a: left, b: right };
  }
  return { a: right, b: left };
};

const pairKey = (pair: BroadphasePair): string => `${pair.a.value}:${pair.b.value}`;

/**
 * Sweep-and-prune broadphase on axis X.
 * Boxes are sorted by minX; each box is tested against later boxes until minX > maxX.
 */
export const findBroadphasePairs = (
  boxes: readonly Aabb[],
): Effect.Effect<readonly BroadphasePair[], BroadphaseInputError> =>
  Effect.gen(function* () {
    for (const box of boxes) {
      if (box.minX > box.maxX || box.minY > box.maxY) {
        return yield* Effect.fail(
          new BroadphaseInputError({ message: `invalid AABB for id ${box.id.value}` }),
        );
      }
    }

    if (boxes.length <= 1) {
      return [];
    }

    const sorted = [...boxes].sort((left, right) => {
      if (left.minX !== right.minX) {
        return left.minX - right.minX;
      }
      if (left.maxX !== right.maxX) {
        return left.maxX - right.maxX;
      }
      return left.id.value - right.id.value;
    });

    const pairs = new Map<string, BroadphasePair>();

    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      if (!current) {
        continue;
      }
      for (let otherIndex = index + 1; otherIndex < sorted.length; otherIndex += 1) {
        const candidate = sorted[otherIndex];
        if (!candidate) {
          continue;
        }
        if (candidate.minX > current.maxX) {
          break;
        }
        if (overlaps(current, candidate)) {
          const pair = normalizePair(current.id, candidate.id);
          pairs.set(pairKey(pair), pair);
        }
      }
    }

    return [...pairs.values()].sort((left, right) => {
      if (left.a.value !== right.a.value) {
        return left.a.value - right.a.value;
      }
      return left.b.value - right.b.value;
    });
  });

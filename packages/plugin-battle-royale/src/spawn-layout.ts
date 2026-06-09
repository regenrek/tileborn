export interface SpawnLayoutPoint {
  readonly x: number;
  readonly y: number;
}

export interface SpawnClearancePair<TPoint extends SpawnLayoutPoint> {
  readonly left: TPoint;
  readonly right: TPoint;
  readonly distance: number;
}

export const MIN_SPAWN_CLEARANCE = 8;

export const distanceSq = (left: SpawnLayoutPoint, right: SpawnLayoutPoint): number => {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
};

const minDistanceSqToSelected = <TPoint extends SpawnLayoutPoint>(
  point: TPoint,
  selected: readonly TPoint[],
): number => {
  let minDistanceSq = Number.POSITIVE_INFINITY;
  for (const selectedPoint of selected) {
    minDistanceSq = Math.min(minDistanceSq, distanceSq(point, selectedPoint));
  }
  return minDistanceSq;
};

export const spreadOrderSpawnPoints = <TPoint extends SpawnLayoutPoint>(
  points: readonly TPoint[],
  compare: (left: TPoint, right: TPoint) => number,
): readonly TPoint[] => {
  const remaining = [...points].sort(compare);
  const first = remaining.shift();
  if (first === undefined) {
    return [];
  }

  const ordered: TPoint[] = [first];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistanceSq = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const candidateDistanceSq = minDistanceSqToSelected(candidate, ordered);
      const bestCandidate = remaining[bestIndex]!;
      if (
        candidateDistanceSq > bestDistanceSq ||
        (candidateDistanceSq === bestDistanceSq && compare(candidate, bestCandidate) < 0)
      ) {
        bestDistanceSq = candidateDistanceSq;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return ordered;
};

export const findClosestSpawnPair = <TPoint extends SpawnLayoutPoint>(
  points: readonly TPoint[],
): SpawnClearancePair<TPoint> | undefined => {
  let closest: SpawnClearancePair<TPoint> | undefined;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const left = points[leftIndex]!;
      const right = points[rightIndex]!;
      const distance = Math.sqrt(distanceSq(left, right));
      if (closest === undefined || distance < closest.distance) {
        closest = { left, right, distance };
      }
    }
  }
  return closest;
};

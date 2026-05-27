import { Effect } from "effect";

import { PathfindingInputError, PathNotFoundError } from "../errors.js";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export type HeuristicMode = "manhattan" | "octile";

export interface PathfindingGrid {
  readonly width: number;
  readonly height: number;
  /** Flat row-major walkability flags; true means blocked. */
  readonly blocked: ReadonlyArray<boolean>;
}

export interface PathfindingRequest {
  readonly grid: PathfindingGrid;
  readonly start: GridPoint;
  readonly goal: GridPoint;
  readonly heuristic?: HeuristicMode;
}

const ORTHOGONAL: readonly GridPoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DIAGONAL: readonly GridPoint[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

const ORTHOGONAL_COST = 10;
const DIAGONAL_COST = 14;

const cellKey = (x: number, y: number): string => `${x},${y}`;

const inBounds = (grid: PathfindingGrid, point: GridPoint): boolean =>
  point.x >= 0 && point.y >= 0 && point.x < grid.width && point.y < grid.height;

const isBlocked = (grid: PathfindingGrid, point: GridPoint): boolean => {
  if (!inBounds(grid, point)) {
    return true;
  }
  const index = point.y * grid.width + point.x;
  return grid.blocked[index] ?? true;
};

const heuristic = (from: GridPoint, to: GridPoint, mode: HeuristicMode): number => {
  const dx = Math.abs(from.x - to.x);
  const dy = Math.abs(from.y - to.y);
  if (mode === "manhattan") {
    return (dx + dy) * ORTHOGONAL_COST;
  }
  const min = Math.min(dx, dy);
  const max = Math.max(dx, dy);
  return DIAGONAL_COST * min + ORTHOGONAL_COST * (max - min);
};

interface OpenNode {
  readonly point: GridPoint;
  readonly f: number;
  readonly g: number;
  readonly h: number;
  readonly order: number;
}

const compareOpen = (left: OpenNode, right: OpenNode): number => {
  if (left.f !== right.f) {
    return left.f - right.f;
  }
  if (left.h !== right.h) {
    return left.h - right.h;
  }
  if (left.point.y !== right.point.y) {
    return left.point.y - right.point.y;
  }
  if (left.point.x !== right.point.x) {
    return left.point.x - right.point.x;
  }
  return left.order - right.order;
};

const neighborsFor = (mode: HeuristicMode): readonly GridPoint[] =>
  mode === "manhattan" ? ORTHOGONAL : [...ORTHOGONAL, ...DIAGONAL];

const moveCost = (delta: GridPoint, mode: HeuristicMode): number => {
  if (mode === "manhattan") {
    return ORTHOGONAL_COST;
  }
  return delta.x !== 0 && delta.y !== 0 ? DIAGONAL_COST : ORTHOGONAL_COST;
};

const reconstructPath = (
  cameFrom: ReadonlyMap<string, GridPoint>,
  current: GridPoint,
): readonly GridPoint[] => {
  const path: GridPoint[] = [current];
  let cursor = current;
  while (true) {
    const previous = cameFrom.get(cellKey(cursor.x, cursor.y));
    if (!previous) {
      break;
    }
    path.unshift(previous);
    cursor = previous;
  }
  return path;
};

export const findPathOnGrid = (request: PathfindingRequest): Effect.Effect<readonly GridPoint[], PathfindingInputError | PathNotFoundError> =>
  Effect.gen(function* () {
    const mode = request.heuristic ?? "manhattan";
    const { grid, start, goal } = request;

    if (grid.width <= 0 || grid.height <= 0) {
      return yield* Effect.fail(
        new PathfindingInputError({ message: "grid dimensions must be positive" }),
      );
    }
    if (grid.blocked.length !== grid.width * grid.height) {
      return yield* Effect.fail(
        new PathfindingInputError({ message: "blocked array length must equal width * height" }),
      );
    }
    if (!inBounds(grid, start) || !inBounds(grid, goal)) {
      return yield* Effect.fail(new PathfindingInputError({ message: "start or goal is out of bounds" }));
    }
    if (isBlocked(grid, start) || isBlocked(grid, goal)) {
      return yield* Effect.fail(new PathfindingInputError({ message: "start or goal is blocked" }));
    }
    if (start.x === goal.x && start.y === goal.y) {
      return [start];
    }

    const open: OpenNode[] = [];
    const cameFrom = new Map<string, GridPoint>();
    const gScore = new Map<string, number>();
    const closed = new Set<string>();
    let insertion = 0;

    const startKey = cellKey(start.x, start.y);
    const startH = heuristic(start, goal, mode);
    open.push({ point: start, f: startH, g: 0, h: startH, order: insertion++ });
    gScore.set(startKey, 0);

    while (open.length > 0) {
      open.sort(compareOpen);
      const current = open.shift();
      if (!current) {
        break;
      }

      const currentKey = cellKey(current.point.x, current.point.y);
      if (closed.has(currentKey)) {
        continue;
      }
      closed.add(currentKey);

      if (current.point.x === goal.x && current.point.y === goal.y) {
        return reconstructPath(cameFrom, current.point);
      }

      for (const delta of neighborsFor(mode)) {
        const next: GridPoint = { x: current.point.x + delta.x, y: current.point.y + delta.y };
        if (isBlocked(grid, next)) {
          continue;
        }

        const nextKey = cellKey(next.x, next.y);
        const tentativeG = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + moveCost(delta, mode);
        if (tentativeG >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }

        cameFrom.set(nextKey, current.point);
        gScore.set(nextKey, tentativeG);
        const h = heuristic(next, goal, mode);
        open.push({
          point: next,
          f: tentativeG + h,
          g: tentativeG,
          h,
          order: insertion++,
        });
      }
    }

    return yield* Effect.fail(new PathNotFoundError({ message: "no path exists between start and goal" }));
  });

export const makeBlockedGrid = (
  width: number,
  height: number,
  blockedCells: readonly GridPoint[],
): PathfindingGrid => {
  const blocked = Array.from({ length: width * height }, () => false);
  for (const cell of blockedCells) {
    if (cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height) {
      blocked[cell.y * width + cell.x] = true;
    }
  }
  return { width, height, blocked };
};

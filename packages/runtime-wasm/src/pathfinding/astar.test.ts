import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { findPathOnGrid, makeBlockedGrid, type GridPoint } from "./astar.js";
import { PathfindingInputError, PathNotFoundError } from "../errors.js";

const runPath = (request: Parameters<typeof findPathOnGrid>[0]) => Effect.runPromise(findPathOnGrid(request));

describe("findPathOnGrid", () => {
  it("returns start when start equals goal", async () => {
    const grid = makeBlockedGrid(3, 3, []);
    const path = await runPath({ grid, start: { x: 1, y: 1 }, goal: { x: 1, y: 1 } });
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it("finds the shortest manhattan path around a center wall", async () => {
    const grid = makeBlockedGrid(3, 3, [{ x: 1, y: 1 }]);
    const path = await runPath({
      grid,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 2 },
      heuristic: "manhattan",
    });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("finds an octile diagonal path on an open grid", async () => {
    const grid = makeBlockedGrid(4, 4, []);
    const path = await runPath({
      grid,
      start: { x: 0, y: 0 },
      goal: { x: 3, y: 3 },
      heuristic: "octile",
    });
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 3, y: 3 });
    expect(path.length).toBe(4);
  });

  it("fails when no path exists", async () => {
    const blocked: GridPoint[] = [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ];
    const grid = makeBlockedGrid(3, 3, blocked);
    await expect(
      runPath({ grid, start: { x: 0, y: 1 }, goal: { x: 2, y: 1 } }),
    ).rejects.toBeInstanceOf(PathNotFoundError);
  });

  it("rejects out-of-bounds coordinates", async () => {
    const grid = makeBlockedGrid(2, 2, []);
    await expect(
      runPath({ grid, start: { x: -1, y: 0 }, goal: { x: 1, y: 1 } }),
    ).rejects.toBeInstanceOf(PathfindingInputError);
  });

  it("rejects blocked start cells", async () => {
    const grid = makeBlockedGrid(2, 2, [{ x: 0, y: 0 }]);
    await expect(
      runPath({ grid, start: { x: 0, y: 0 }, goal: { x: 1, y: 1 } }),
    ).rejects.toBeInstanceOf(PathfindingInputError);
  });

  it("rejects blocked goal cells", async () => {
    const grid = makeBlockedGrid(2, 2, [{ x: 1, y: 1 }]);
    await expect(
      runPath({ grid, start: { x: 0, y: 0 }, goal: { x: 1, y: 1 } }),
    ).rejects.toBeInstanceOf(PathfindingInputError);
  });
});

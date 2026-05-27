import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { findBroadphasePairs, type Aabb } from "./sweep-prune.js";
import { createProcgenRng } from "../procgen/rng.js";
import { BroadphaseInputError } from "../errors.js";

const runPairs = (boxes: readonly Aabb[]) => Effect.runPromise(findBroadphasePairs(boxes));

const box = (id: number, minX: number, minY: number, maxX: number, maxY: number): Aabb => ({
  id: { value: id },
  minX,
  minY,
  maxX,
  maxY,
});

describe("findBroadphasePairs (sweep-and-prune)", () => {
  it("returns no pairs for empty input", async () => {
    await expect(runPairs([])).resolves.toEqual([]);
  });

  it("returns no pairs for a single AABB", async () => {
    await expect(runPairs([box(1, 0, 0, 1, 1)])).resolves.toEqual([]);
  });

  it("returns no pairs for well-separated boxes", async () => {
    const pairs = await runPairs([
      box(1, 0, 0, 1, 1),
      box(2, 5, 5, 6, 6),
      box(3, 10, 0, 11, 1),
    ]);
    expect(pairs).toEqual([]);
  });

  it("finds overlapping cluster pairs in stable order", async () => {
    const pairs = await runPairs([
      box(3, 0, 0, 2, 2),
      box(1, 1, 1, 3, 3),
      box(2, 1, 1, 4, 4),
    ]);
    expect(pairs).toEqual([
      { a: { value: 1 }, b: { value: 2 } },
      { a: { value: 1 }, b: { value: 3 } },
      { a: { value: 2 }, b: { value: 3 } },
    ]);
  });

  it("rejects invalid AABB dimensions", async () => {
    await expect(runPairs([box(1, 5, 0, 1, 1)])).rejects.toBeInstanceOf(BroadphaseInputError);
  });

  it("produces a deterministic pair count for 10k seeded random AABBs", async () => {
    const rng = createProcgenRng(0xdecafbad);
    const boxes: Aabb[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      const minX = rng.uniformInt(0, 900);
      const minY = rng.uniformInt(0, 900);
      const sizeX = rng.uniformInt(1, 20);
      const sizeY = rng.uniformInt(1, 20);
      boxes.push(box(index, minX, minY, minX + sizeX, minY + sizeY));
    }
    const pairs = await runPairs(boxes);
    expect(pairs.length).toBe(29_920);
    const rerun = await runPairs(boxes);
    expect(rerun.length).toBe(pairs.length);
    expect(rerun[0]).toEqual(pairs[0]);
    expect(rerun[pairs.length - 1]).toEqual(pairs[pairs.length - 1]);
  });
});

import { describe, expect, it } from "vitest";

import { ProcgenInputError } from "../errors.js";
import { createProcgenRng } from "./rng.js";

describe("Xoshiro256** procgen RNG", () => {
  it("produces the same sequence for the same seed", () => {
    const left = createProcgenRng(42);
    const right = createProcgenRng(42);
    const leftSeq = Array.from({ length: 8 }, () => left.nextUint32());
    const rightSeq = Array.from({ length: 8 }, () => right.nextUint32());
    expect(leftSeq).toEqual(rightSeq);
    expect(leftSeq).toEqual([
      506754766, 97072630, 3919741598, 1600436310, 3689584393, 2145971369, 2692428735, 3166924350,
    ]);
  });

  it("produces different sequences for different seeds", () => {
    const a = createProcgenRng(1);
    const b = createProcgenRng(2);
    const aSeq = Array.from({ length: 4 }, () => a.nextUint32());
    const bSeq = Array.from({ length: 4 }, () => b.nextUint32());
    expect(aSeq).not.toEqual(bSeq);
  });

  it("uniformInt stays within bounds", () => {
    const rng = createProcgenRng(99);
    for (let index = 0; index < 100; index += 1) {
      const value = rng.uniformInt(-3, 3);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThanOrEqual(3);
    }
  });

  it("pick selects deterministically from an array", () => {
    const rng = createProcgenRng(7);
    expect(rng.pick(["a", "b", "c", "d"])).toBe("c");
    expect(rng.pick(["a", "b", "c", "d"])).toBe("c");
  });

  it("weighted selection is stable for fixed weights", () => {
    const rng = createProcgenRng(1234);
    const items = ["common", "rare", "epic"] as const;
    const weights = [70, 25, 5];
    const picks = Array.from({ length: 5 }, () => rng.weighted(items, weights));
    expect(picks).toEqual(["common", "common", "common", "common", "common"]);
  });

  it("rejects invalid weighted input", () => {
    const rng = createProcgenRng(1);
    expect(() => rng.weighted(["a"], [0])).toThrow(ProcgenInputError);
  });

  it("uniformInt is deterministic for a fixed seed and range", () => {
    const a = createProcgenRng(2026);
    const b = createProcgenRng(2026);
    const seqA = Array.from({ length: 16 }, () => a.uniformInt(0, 9));
    const seqB = Array.from({ length: 16 }, () => b.uniformInt(0, 9));
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v <= 9)).toBe(true);
  });

  it("uniformInt distribution is roughly uniform across a small odd range", () => {
    // Sanity check for the unbiased rejection-sampling path: with 60k samples
    // across a 7-bucket range each bucket should land within ~3% of 1/7.
    const rng = createProcgenRng(0xdeadbeefn);
    const buckets = new Array<number>(7).fill(0);
    const samples = 60_000;
    for (let index = 0; index < samples; index += 1) {
      const value = rng.uniformInt(0, 6);
      buckets[value] = (buckets[value] ?? 0) + 1;
    }
    const expected = samples / 7;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.03);
    }
  }, 15_000);
});

import { describe, expect, it } from "vitest";

import { generateMap } from "./generate-map.js";

describe("generateMap", () => {
  it("returns identical output for the same seed", () => {
    const opts = { width: 40, height: 40, spawnCount: 6, lootDensity: 0.35 };
    const first = generateMap("seed-alpha", opts);
    const second = generateMap("seed-alpha", opts);
    expect(first).toEqual(second);
  });

  it("honors requested width and height", () => {
    const map = generateMap("sized", { width: 52, height: 44, spawnCount: 4, lootDensity: 0.25 });
    expect(map.size).toEqual({ width: 52, height: 44 });
  });
});

import { describe, expect, it } from "vitest";

import { generatePresetTiles, MAP_GENERATE_PRESETS } from "./generator.js";

describe("generatePresetTiles", () => {
  it("generates deterministic dungeon layouts for the same seed", () => {
    const first = generatePresetTiles("dungeon", 32, 32, 42);
    const second = generatePresetTiles("dungeon", 32, 32, 42);
    expect(first).toEqual(second);
    expect(first.some((tile) => tile === 0)).toBe(true);
    expect(first.some((tile) => tile === 1)).toBe(true);
  });

  it("covers all presets", () => {
    for (const preset of MAP_GENERATE_PRESETS) {
      const tiles = generatePresetTiles(preset, 16, 16, 7);
      expect(tiles).toHaveLength(16 * 16);
    }
  });
});

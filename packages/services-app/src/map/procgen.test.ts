import { describe, expect, it } from "vitest";

import { makeGeneratedLayers, MAP_GENERATE_PRESETS } from "./procgen.js";

describe("makeGeneratedLayers", () => {
  it("generates deterministic dungeon layouts for the same seed", () => {
    const first = makeGeneratedLayers("dungeon", 32, 32, 42);
    const second = makeGeneratedLayers("dungeon", 32, 32, 42);
    const firstTiles = first[0]?.chunks[0]?.tiles ?? [];
    const secondTiles = second[0]?.chunks[0]?.tiles ?? [];
    expect(firstTiles).toEqual(secondTiles);
    expect(firstTiles.some((tile) => tile === 1)).toBe(true);
    expect(firstTiles.some((tile) => tile === 2)).toBe(true);
  });

  it("covers all presets", () => {
    for (const preset of MAP_GENERATE_PRESETS) {
      const layers = makeGeneratedLayers(preset, 16, 16, 7);
      expect(layers).toHaveLength(3);
      expect(layers.map((layer) => layer.name)).toEqual(["terrain", "props", "entities"]);
      expect(layers[0]?.chunks[0]?.tiles).toHaveLength(16 * 16);
    }
  });
});

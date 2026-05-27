import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseTilesetManifest } from "@tileborne/sdk-tileset/manifest";
import { describe, expect, it } from "vitest";

import { makeGeneratedLayers } from "./procgen.js";
import { projectGeneratedTerrainLayers } from "./terrain-projection.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const sampleFixture = path.join(
  repoRoot,
  "packages/test-fixtures/fixtures/asset-packs/smoke-pack/tileborne-asset-pack.json",
);

const loadSamplePack = () => {
  const parsed = JSON.parse(readFileSync(sampleFixture, "utf8")) as unknown;
  const result = parseTilesetManifest(parsed);
  if (result.value === undefined) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  }
  return result.value;
};

describe("generated terrain projection", () => {
  it("projects dungeon semantic indices to concrete Tiled source terrain and wall tile indices", () => {
    const pack = loadSamplePack();
    const layers = makeGeneratedLayers("dungeon", 16, 16, 42);

    const projection = projectGeneratedTerrainLayers({
      layers,
      pack,
      preset: "dungeon",
      seed: 42,
    });
    const terrain = projection.layers[0]?._tag === "tile" ? projection.layers[0] : undefined;
    const nonZeroTiles = terrain?.chunks[0]?.tiles.filter((tile) => tile !== 0) ?? [];

    expect(projection.diagnostics).toEqual([]);
    expect(projection.floor?.tilesetName).toBe("Terrain - Sample Tileset");
    expect(projection.wall?.tilesetName).toMatch(/^wall-/);
    expect(projection.wall?.tilesetName).not.toMatch(/transp|transparent/i);
    expect(projection.floor?.tileIndex).toBeGreaterThan(2);
    expect(projection.wall?.tileIndex).toBeGreaterThan(2);
    expect(nonZeroTiles).not.toContain(1);
    expect(nonZeroTiles).not.toContain(2);
    expect(new Set(nonZeroTiles)).toEqual(
      new Set([projection.floor!.tileIndex, projection.wall!.tileIndex]),
    );
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeLayerId, TileChunk, TileLayer, type Uuid } from "@tileborne/core";
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

const uuid = (suffix: string): Uuid =>
  `660e8400-e29b-41d4-a716-${suffix.padStart(12, "0")}` as Uuid;

const currentModelPackJson = {
  schemaVersion: 1,
  id: `pack:${uuid("001")}`,
  name: "Current terrain model pack",
  version: "1.0.0",
  license: { spdxId: "CC0-1.0", redistributable: true },
  assets: [
    {
      id: `asset:${uuid("010")}`,
      path: "tiles/current-terrain.png",
      mime: "image/png",
    },
  ],
  terrainClasses: [
    "Terrain---Ancient-Ruins:",
    "Ancient-Ruins-Tileset---wall-1:",
    "garden-path:",
  ],
  tilesets: [
    {
      id: `tileset:${uuid("100")}`,
      name: "Terrain - Ancient Ruins",
      atlasAssetId: `asset:${uuid("010")}`,
      cellSize: { width: 16, height: 16 },
      margin: 0,
      spacing: 0,
    },
  ],
  tiles: [
    {
      id: `tile:${uuid("201")}`,
      tilesetId: `tileset:${uuid("100")}`,
      uv: { x: 0, y: 0, w: 16, h: 16 },
      tags: [],
    },
    {
      id: `tile:${uuid("202")}`,
      tilesetId: `tileset:${uuid("100")}`,
      uv: { x: 16, y: 0, w: 16, h: 16 },
      tags: [],
    },
    {
      id: `tile:${uuid("203")}`,
      tilesetId: `tileset:${uuid("100")}`,
      uv: { x: 32, y: 0, w: 16, h: 16 },
      tags: [],
    },
  ],
  autotileRules: [
    {
      _tag: "wang2corner",
      tilesetId: `tileset:${uuid("100")}`,
      id: `autotile-rule:${uuid("301")}`,
      name: "light grass to mid tone grass",
      terrainClasses: ["Terrain---Ancient-Ruins:"],
      maskToTileIds: { "1111": [`tile:${uuid("201")}`] },
    },
    {
      _tag: "wang2corner",
      tilesetId: `tileset:${uuid("100")}`,
      id: `autotile-rule:${uuid("302")}`,
      name: "wall-1",
      terrainClasses: ["Ancient-Ruins-Tileset---wall-1:"],
      maskToTileIds: { "1111": [`tile:${uuid("202")}`] },
    },
    {
      _tag: "wang2corner",
      tilesetId: `tileset:${uuid("100")}`,
      id: `autotile-rule:${uuid("303")}`,
      name: "garden path",
      terrainClasses: ["garden-path:"],
      maskToTileIds: { "1111": [`tile:${uuid("203")}`] },
    },
  ],
  variantFilters: [],
  animations: [],
  terrainTransitions: [],
  collisionMasks: [],
} as const;

const loadCurrentModelPack = () => {
  const result = parseTilesetManifest(currentModelPackJson);
  if (result.value === undefined) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  }
  return result.value;
};

const semanticTerrainLayers = () => [
  new TileLayer({
    id: makeLayerId(uuid("401")),
    name: "terrain",
    visible: true,
    opacity: 1,
    chunks: [
      new TileChunk({
        x: 0,
        y: 0,
        width: 3,
        height: 1,
        tiles: [1, 2, 3],
      }),
    ],
  }),
];

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
    expect(projection.floor?.tileId).toBe("tile:550e8400-e29b-41d4-a716-446655440092");
    expect(projection.wall?.tileId).toBe("tile:550e8400-e29b-41d4-a716-446655440093");
    expect(projection.floor?.tileIndex).toBeGreaterThan(2);
    expect(projection.wall?.tileIndex).toBeGreaterThan(2);
    expect(nonZeroTiles).not.toContain(1);
    expect(nonZeroTiles).not.toContain(2);
    expect(new Set(nonZeroTiles)).toEqual(
      new Set([projection.floor!.tileIndex, projection.wall!.tileIndex]),
    );
  });

  it("resolves semantic tiles from current terrain-class autotile rules when asset roles are absent", () => {
    const pack = loadCurrentModelPack();

    expect(pack.semanticRoles?.some((role) => role.role === "floor")).toBe(false);

    const projection = projectGeneratedTerrainLayers({
      layers: semanticTerrainLayers(),
      pack,
      preset: "dungeon",
      seed: 7,
    });
    const terrain = projection.layers[0]?._tag === "tile" ? projection.layers[0] : undefined;

    expect(projection.diagnostics).toEqual([]);
    expect(projection.floor?.tileId).toBe(`tile:${uuid("201")}`);
    expect(projection.wall?.tileId).toBe(`tile:${uuid("202")}`);
    expect(projection.path?.tileId).toBe(`tile:${uuid("203")}`);
    expect(terrain?.chunks[0]?.tiles).toEqual([
      projection.floor?.tileIndex,
      projection.wall?.tileIndex,
      projection.path?.tileIndex,
    ]);
  });
});

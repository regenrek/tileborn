import { MapObject, makeTileborneMap } from "@tileborne/core";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { exportArtifact } from "./export-artifact.js";
import { generateMap } from "./generate-map.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { validateMap } from "./validate-map.js";

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
  properties: Record<string, string | number> = {},
): MapObject =>
  new MapObject({
    id,
    kind,
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties,
  });

describe("exportArtifact", () => {
  it("round-trips a generated fixture map into a serializable artifact", () => {
    const map = generateMap("fixture-roundtrip", {
      width: 48,
      height: 48,
      spawnCount: 4,
      lootDensity: 0.5,
    });
    expect(validateMap(map).ok).toBe(true);
    const artifact = exportArtifact(map);
    expect(JSON.parse(JSON.stringify(artifact))).toEqual(artifact);
    expect(artifact.spawnPoints.length).toBeGreaterThanOrEqual(4);
    expect(artifact.objectPlacements.length).toBe(map.objects.length);
  });

  it("applies shrink schedule defaults", () => {
    const map = generateMap("defaults", { width: 32, height: 32, spawnCount: 4, lootDensity: 0.2 });
    const artifact = exportArtifact(map);
    expect(artifact.shrinkSchedule.shrinkIntervalMs).toBe(30_000);
    expect(artifact.shrinkSchedule.damagePerSecond).toBe(5);
    expect(artifact.shrinkSchedule.startRadiusTiles).toBeGreaterThan(artifact.shrinkSchedule.endRadiusTiles);
  });

  it("normalizes loot table weights to unit sum", () => {
    const map = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], "spawn-point", 1, 1),
        makeTestObject(TEST_OBJECT_IDS[1], "spawn-point", 2, 2),
        makeTestObject(TEST_OBJECT_IDS[2], "spawn-point", 3, 3),
        makeTestObject(TEST_OBJECT_IDS[3], "spawn-point", 4, 4),
        makeTestObject(TEST_OBJECT_IDS[4], "shrink-zone-anchor", 16, 16),
        makeTestObject(TEST_OBJECT_IDS[5], "loot-crate", 8, 8, { tier: "common", weight: 2 }),
        makeTestObject(TEST_OBJECT_IDS[6], "loot-crate", 9, 9, { tier: "rare", weight: 2 }),
      ],
    });
    const artifact = exportArtifact(map);
    const total = artifact.lootTables.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 3);
  });
});

import { describe, expect, it } from "vitest";

import { DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS } from "./content-assets.js";
import { createBattleRoyaleSampleMaps } from "./sample-maps.js";
import { buildTestRuntimeArtifact } from "./test-map-package.js";
import { validateMap } from "./validate-map.js";

describe("createBattleRoyaleSampleMaps", () => {
  it("ships validated content-rich maps that package with default models and object collision", () => {
    const maps = createBattleRoyaleSampleMaps();
    expect(maps).toHaveLength(3);

    for (const sample of maps) {
      expect(validateMap(sample.map).ok).toBe(true);
      const artifact = buildTestRuntimeArtifact(sample.map, {
        playerModels: DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
      });
      expect(artifact.playerModels).toHaveLength(2);
      expect(artifact.defaultPlayerModelId).toBe("maltipoo-mae");
      expect(artifact.objectPlacements.map((placement) => placement.role)).toEqual(
        expect.arrayContaining(["spawn-point", "shrink-zone-anchor", "loot-crate", "trap", "decoy"]),
      );
      expect(artifact.objectCollisionRects?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

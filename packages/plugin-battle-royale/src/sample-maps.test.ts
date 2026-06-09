import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeGameObjectCatalog } from "@tileborne/plugin-api";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS } from "./content-assets.js";
import { exportArtifact } from "./export-artifact.js";
import { createBattleRoyaleSampleMaps } from "./sample-maps.js";
import { validateMap } from "./validate-map.js";

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../schemas/game-object-catalog.json",
);

const objectTypes = () => {
  const decoded = decodeGameObjectCatalog(
    "br-game-object-catalog",
    JSON.parse(fs.readFileSync(catalogPath, "utf8")) as unknown,
  );
  if (Result.isFailure(decoded)) {
    throw new Error(decoded.failure.message);
  }
  return decoded.success.objectTypes;
};

describe("createBattleRoyaleSampleMaps", () => {
  it("ships validated content-rich maps that export with default models and object collision", () => {
    const maps = createBattleRoyaleSampleMaps();
    expect(maps).toHaveLength(3);

    for (const sample of maps) {
      expect(validateMap(sample.map).ok).toBe(true);
      const artifact = exportArtifact(sample.map, {
        playerModels: DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
        objectTypes: objectTypes(),
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

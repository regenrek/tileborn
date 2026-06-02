import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gameObjectTypeIdForKey } from "@tileborne/core";
import { decodeGameObjectCatalog, mergeGameObjectCatalogs } from "@tileborne/plugin-api";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { LOOT_CRATE_KEY, SHRINK_ZONE_ANCHOR_KEY, SPAWN_POINT_KEY } from "../../constants.js";

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../schemas/game-object-catalog.json",
);

describe("Battle Royale game-object catalog contribution", () => {
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as unknown;

  it("decodes the shipped catalog pack against the core schema", () => {
    const decoded = decodeGameObjectCatalog("br-game-object-catalog", raw);
    expect(Result.isSuccess(decoded)).toBe(true);
  });

  it("registers exactly the BR object types keyed on derived catalog ids", () => {
    const decoded = decodeGameObjectCatalog("br-game-object-catalog", raw);
    if (Result.isFailure(decoded)) {
      throw new Error("catalog failed to decode");
    }
    const merged = mergeGameObjectCatalogs([
      { contributionId: "br-game-object-catalog", catalog: decoded.success },
    ]);
    expect(Result.isSuccess(merged)).toBe(true);
    if (Result.isSuccess(merged)) {
      expect(merged.success.byId.has(gameObjectTypeIdForKey(SPAWN_POINT_KEY))).toBe(true);
      expect(merged.success.byId.has(gameObjectTypeIdForKey(SHRINK_ZONE_ANCHOR_KEY))).toBe(true);
      expect(merged.success.byId.has(gameObjectTypeIdForKey(LOOT_CRATE_KEY))).toBe(true);
    }
  });
});

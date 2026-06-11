import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GameObjectCatalog, Result } from "@tileborne/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { BR_PRIMARY_WEAPON_ID } from "./constants.js";
import { BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS } from "./content-assets.js";
import { resolveBattleRoyaleWeaponVisuals } from "./weapon-visuals.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(packageRoot, "schemas/game-object-catalog.json");

const shippedObjectTypes = () =>
  Schema.decodeUnknownSync(GameObjectCatalog)(
    JSON.parse(fs.readFileSync(catalogPath, "utf8")),
  ).objectTypes;

describe("battle royale weapon visuals (ADR-0028 entity derivation)", () => {
  it("derives the primary weapon's visuals from the shipped weapon entity", () => {
    const result = resolveBattleRoyaleWeaponVisuals(shippedObjectTypes());

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) {
      return;
    }
    const { primary, byWeaponId } = result.success;
    expect(byWeaponId.get(BR_PRIMARY_WEAPON_ID)).toBe(primary);
    expect(String(primary.equipped.placeableId)).toBe(
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.petwarsWeapons.pulseCarbine,
    );
    expect(primary.equipped.anchors["grip"]).toBeDefined();
    expect(primary.equipped.anchors["muzzle"]).toBeDefined();
    expect(String(primary.projectile?.placeableId)).toBe(
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.projectileBolt,
    );
    expect(String(primary.muzzleFlash?.visual.placeableId)).toBe(
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.muzzleFlash,
    );
    expect(String(primary.impactVfx?.visual.placeableId)).toBe(
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.impactBurst,
    );
    expect(String(primary.pickup?.placeableId)).toBe(
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.lootCrate,
    );
  });

  it("fails when no weapon entity claims BR's primary weapon", () => {
    const withoutWeapons = shippedObjectTypes().filter(
      (objectType) => !objectType.components.some((component) => component._tag === "weapon-ref"),
    );

    const result = resolveBattleRoyaleWeaponVisuals(withoutWeapons);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain(BR_PRIMARY_WEAPON_ID);
    }
  });
});

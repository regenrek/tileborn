import {
  AssetLibraryReference,
  Result,
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  makeProjectId,
  makeProjectManifest,
  writeProjectVisualAssetRoles,
  type ProjectManifest,
  type VisualRoleKind,
} from "@tileborne/core";
import { describe, expect, it } from "vitest";

import {
  BATTLE_ROYALE_CORE_PACK_ID,
  BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS,
  DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES,
} from "./content-assets.js";
import {
  PROJECTILE_TEXTURE_ASSET_ID,
  WEAPON_RIFLE_TEXTURE_ASSET_ID,
} from "./renderer/bundled-assets.js";
import { BR_PRIMARY_WEAPON_ID } from "./weapon-catalog.js";
import {
  resolveBattleRoyaleWeaponVisualBinding,
  validateBattleRoyaleWeaponRenderableAssetIds,
} from "./weapon-visuals.js";

const PROJECT_UUID = "b4111e00-0000-4000-8000-000000000099";

const project = (): ProjectManifest =>
  makeProjectManifest({ id: makeProjectId(PROJECT_UUID), name: "BR weapon visuals" });

const role = (
  roleKind: VisualRoleKind,
  label: string,
  refId: string,
): VisualAssetRoleRef =>
  new VisualAssetRoleRef({
    id: `visual-role:${String(roleKind)}`,
    roleKind,
    label,
    ref: new AssetLibraryReference({
      packId: BATTLE_ROYALE_CORE_PACK_ID,
      kind: "placeable",
      refId,
    }),
  });

const completeRoles = (): readonly VisualAssetRoleRef[] => [
  role(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon, "Rifle", BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.rifle),
  role(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile, "Projectile bolt", BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.projectileBolt),
  role(WELL_KNOWN_VISUAL_ROLE_KINDS.pickup, "Rifle pickup", BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.lootCrate),
  role(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash, "Muzzle flash", BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.muzzleFlash),
  role(WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx, "Impact burst", BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.impactBurst),
];

describe("battle royale weapon visuals", () => {
  it("resolves the primary weapon visual binding from BR default visual roles", () => {
    const result = resolveBattleRoyaleWeaponVisualBinding(project());

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) {
      return;
    }
    expect(result.success.equippedWeapon.role.ref.refId).toBe(
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.petwarsWeapons.pulseCarbine,
    );
    expect(result.success.projectile?.role.ref.refId).toBe(
      BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.projectileBolt,
    );
    expect(
      new Set(DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES.map((entry) => entry.ref.refId)).size,
    ).toBe(DEFAULT_BATTLE_ROYALE_VISUAL_ASSET_ROLES.length);
  });

  it("resolves the primary weapon visual binding from project-assigned visual roles", () => {
    const withRoles = writeProjectVisualAssetRoles(project(), completeRoles());

    const result = resolveBattleRoyaleWeaponVisualBinding(withRoles);

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) {
      return;
    }
    expect(result.success.weaponId).toBe(BR_PRIMARY_WEAPON_ID);
    expect(result.success.equippedWeapon.role.ref.refId).toBe(BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.rifle);
    expect(result.success.projectile?.role.ref.refId).toBe(BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.projectileBolt);
    expect(result.success.muzzleFlash?.role.roleKind).toBe(
      WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash,
    );
  });

  it("fills missing project roles from default BR visual roles", () => {
    const missingProjectile = completeRoles().filter(
      (entry) => entry.roleKind !== WELL_KNOWN_VISUAL_ROLE_KINDS.projectile,
    );
    const withRoles = writeProjectVisualAssetRoles(project(), missingProjectile);

    const result = resolveBattleRoyaleWeaponVisualBinding(withRoles);

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) {
      return;
    }
    expect(result.success.projectile?.role.ref.refId).toBe(BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.projectileBolt);
  });

  it("rejects project visual roles that point at bundled placeholder texture aliases", () => {
    const placeholderRoles = [
      role(
        WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
        "Placeholder rifle",
        String(WEAPON_RIFLE_TEXTURE_ASSET_ID),
      ),
      ...completeRoles().filter(
        (entry) => entry.roleKind !== WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
      ),
    ];
    const withRoles = writeProjectVisualAssetRoles(project(), placeholderRoles);

    const result = resolveBattleRoyaleWeaponVisualBinding(withRoles);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("bundled placeholders");
      expect(result.failure.message).toContain(String(WEAPON_RIFLE_TEXTURE_ASSET_ID));
    }
  });

  it("rejects the current hardcoded weapon render manifest placeholders", () => {
    const result = validateBattleRoyaleWeaponRenderableAssetIds({
      equippedWeapon: String(WEAPON_RIFLE_TEXTURE_ASSET_ID),
      projectile: String(PROJECTILE_TEXTURE_ASSET_ID),
      pickup: BATTLE_ROYALE_CORE_VISUAL_PLACEABLE_IDS.lootCrate,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("equippedWeapon");
      expect(result.failure.message).toContain("projectile");
    }
  });
});

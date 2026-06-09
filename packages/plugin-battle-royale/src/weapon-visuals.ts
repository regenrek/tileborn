import {
  PickupVisualRef,
  ProjectileVisualRef,
  Result,
  VfxVisualRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  WeaponDefinitionId,
  WeaponVisualBinding,
  WeaponVisualRef,
  validateWeaponVisualBinding,
  type ProjectManifest,
  type VisualAssetRoleRef,
  type VisualRoleKind,
} from "@tileborne/core";
import { Schema } from "effect";

import {
  IMPACT_BURST_TEXTURE_ASSET_ID,
  LOOT_CRATE_TEXTURE_ASSET_ID,
  PROJECTILE_TEXTURE_ASSET_ID,
  WEAPON_RIFLE_TEXTURE_ASSET_ID,
} from "./renderer/bundled-assets.js";
import { resolveBattleRoyaleVisualAssetRoles } from "./content-assets.js";
import { BR_PRIMARY_WEAPON_ID } from "./weapon-catalog.js";

export const BATTLE_ROYALE_REQUIRED_WEAPON_VISUAL_ROLE_KINDS = [
  WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
  WELL_KNOWN_VISUAL_ROLE_KINDS.projectile,
  WELL_KNOWN_VISUAL_ROLE_KINDS.pickup,
  WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash,
  WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx,
] as const;

export const BATTLE_ROYALE_PLACEHOLDER_WEAPON_VISUAL_ASSET_IDS = new Set<string>([
  String(WEAPON_RIFLE_TEXTURE_ASSET_ID),
  String(PROJECTILE_TEXTURE_ASSET_ID),
  String(LOOT_CRATE_TEXTURE_ASSET_ID),
  String(IMPACT_BURST_TEXTURE_ASSET_ID),
]);

const BR_PRIMARY_CORE_WEAPON_ID = Schema.decodeUnknownSync(WeaponDefinitionId)(
  BR_PRIMARY_WEAPON_ID,
);

export interface BattleRoyaleWeaponRenderableAssetIds {
  readonly equippedWeapon?: string;
  readonly projectile?: string;
  readonly pickup?: string;
  readonly muzzleFlash?: string;
  readonly impactVfx?: string;
}

export class BattleRoyaleWeaponVisualError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BattleRoyaleWeaponVisualError";
  }
}

const roleKindLabel = (roleKind: VisualRoleKind): string => String(roleKind);

const roleByKind = (
  roles: readonly VisualAssetRoleRef[],
): ReadonlyMap<VisualRoleKind, VisualAssetRoleRef> => {
  const byKind = new Map<VisualRoleKind, VisualAssetRoleRef>();
  for (const role of roles) {
    byKind.set(role.roleKind, role);
  }
  return byKind;
};

export const validateBattleRoyaleWeaponRenderableAssetIds = (
  assetIds: BattleRoyaleWeaponRenderableAssetIds,
): Result.Result<void, BattleRoyaleWeaponVisualError> => {
  const placeholders = Object.entries(assetIds).filter(([, assetId]) =>
    assetId === undefined ? false : BATTLE_ROYALE_PLACEHOLDER_WEAPON_VISUAL_ASSET_IDS.has(assetId),
  );
  if (placeholders.length === 0) {
    return Result.succeed(undefined);
  }
  return Result.fail(
    new BattleRoyaleWeaponVisualError(
      `weapon visuals must use project asset roles, not bundled placeholders: ${placeholders
        .map(([slot, assetId]) => `${slot}=${assetId}`)
        .join(", ")}`,
    ),
  );
};

const bindingRenderableAssetIds = (
  binding: WeaponVisualBinding,
): BattleRoyaleWeaponRenderableAssetIds => ({
  equippedWeapon: binding.equippedWeapon.role.ref.refId,
  ...(binding.projectile === undefined ? {} : { projectile: binding.projectile.role.ref.refId }),
  ...(binding.pickup === undefined ? {} : { pickup: binding.pickup.role.ref.refId }),
  ...(binding.muzzleFlash === undefined
    ? {}
    : { muzzleFlash: binding.muzzleFlash.role.ref.refId }),
  ...(binding.impactVfx === undefined ? {} : { impactVfx: binding.impactVfx.role.ref.refId }),
});

export const resolveBattleRoyaleWeaponVisualBinding = (
  project: ProjectManifest | undefined,
  weaponId: WeaponDefinitionId = BR_PRIMARY_CORE_WEAPON_ID,
): Result.Result<WeaponVisualBinding, BattleRoyaleWeaponVisualError> => {
  const roles = resolveBattleRoyaleVisualAssetRoles(project);
  const byKind = roleByKind(roles);
  const missing = BATTLE_ROYALE_REQUIRED_WEAPON_VISUAL_ROLE_KINDS.filter(
    (roleKind) => !byKind.has(roleKind),
  );
  if (missing.length > 0) {
    return Result.fail(
      new BattleRoyaleWeaponVisualError(
        `weapon ${String(weaponId)} is missing visual role(s): ${missing
          .map(roleKindLabel)
          .join(", ")}`,
      ),
    );
  }

  const binding = new WeaponVisualBinding({
    weaponId,
    equippedWeapon: new WeaponVisualRef({
      role: byKind.get(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon)!,
    }),
    projectile: new ProjectileVisualRef({
      role: byKind.get(WELL_KNOWN_VISUAL_ROLE_KINDS.projectile)!,
    }),
    pickup: new PickupVisualRef({ role: byKind.get(WELL_KNOWN_VISUAL_ROLE_KINDS.pickup)! }),
    muzzleFlash: new VfxVisualRef({
      role: byKind.get(WELL_KNOWN_VISUAL_ROLE_KINDS.muzzleFlash)!,
    }),
    impactVfx: new VfxVisualRef({
      role: byKind.get(WELL_KNOWN_VISUAL_ROLE_KINDS.impactVfx)!,
    }),
  });

  const validationIssues = validateWeaponVisualBinding(binding);
  if (validationIssues.length > 0) {
    return Result.fail(
      new BattleRoyaleWeaponVisualError(
        `weapon ${String(weaponId)} visual binding is invalid: ${validationIssues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join(", ")}`,
      ),
    );
  }

  const placeholderValidation = validateBattleRoyaleWeaponRenderableAssetIds(
    bindingRenderableAssetIds(binding),
  );
  if (Result.isFailure(placeholderValidation)) {
    return Result.fail(placeholderValidation.failure);
  }

  return Result.succeed(binding);
};

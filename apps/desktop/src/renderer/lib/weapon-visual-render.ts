import type { ResolvedWeaponVisuals } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import type { BundledAssetSpec } from '@tileborne/runtime';

import type { WeaponVisualRenderData } from '@/lib/playtest-plugin-bridge';
import { buildEntityVisualRenderData } from '@/lib/entity-visual-render';
import { loadPackAssetBundledSpec } from '@/lib/runtime-asset-spec';
import type { PlaceableAtlasRef } from '@/lib/placeable-animation';

export interface BuiltWeaponVisual {
  readonly weaponId: string;
  readonly data: WeaponVisualRenderData;
  readonly atlases: readonly PlaceableAtlasRef[];
}

/**
 * Build render-ready per-weapon visuals from core-derived
 * {@link ResolvedWeaponVisuals} (ADR-0028). The equipped visual is required —
 * a weapon entity whose sprite cannot be resolved is skipped; companion
 * visuals degrade gracefully (the projector omits the effect).
 */
export const buildWeaponVisualRenderData = (
  packs: ReadonlyMap<string, TilesetPack>,
  visuals: ResolvedWeaponVisuals,
): BuiltWeaponVisual | undefined => {
  const equipped = buildEntityVisualRenderData(packs, visuals.equipped, 'weaponvisual');
  if (equipped === undefined) {
    return undefined;
  }
  const projectile =
    visuals.projectile === undefined
      ? undefined
      : buildEntityVisualRenderData(packs, visuals.projectile, 'weaponvisual');
  const muzzleFlash =
    visuals.muzzleFlash === undefined
      ? undefined
      : buildEntityVisualRenderData(packs, visuals.muzzleFlash.visual, 'weaponvisual');
  const impactVfx =
    visuals.impactVfx === undefined
      ? undefined
      : buildEntityVisualRenderData(packs, visuals.impactVfx.visual, 'weaponvisual');
  const pickup =
    visuals.pickup === undefined
      ? undefined
      : buildEntityVisualRenderData(packs, visuals.pickup, 'weaponvisual');
  return {
    weaponId: String(visuals.weaponId),
    data: {
      weaponId: String(visuals.weaponId),
      attachAnchor: visuals.attachAnchor,
      equipped: equipped.data,
      ...(projectile === undefined ? {} : { projectile: projectile.data }),
      ...(muzzleFlash === undefined ? {} : { muzzleFlash: muzzleFlash.data }),
      ...(impactVfx === undefined ? {} : { impactVfx: impactVfx.data }),
      ...(pickup === undefined ? {} : { pickup: pickup.data }),
    },
    atlases: [
      ...equipped.atlases,
      ...(projectile?.atlases ?? []),
      ...(muzzleFlash?.atlases ?? []),
      ...(impactVfx?.atlases ?? []),
      ...(pickup?.atlases ?? []),
    ],
  };
};

export const loadWeaponVisualAtlasSpec = async (
  atlas: PlaceableAtlasRef,
): Promise<BundledAssetSpec> => loadPackAssetBundledSpec(atlas);

import type { ResolvedOverlayVisual } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import type { BundledAssetSpec } from '@tileborne/runtime';

import type { SpriteVisualRenderData } from '@/lib/playtest-plugin-bridge';
import { buildEntityVisualRenderData } from '@/lib/entity-visual-render';
import { loadPackAssetBundledSpec } from '@/lib/runtime-asset-spec';
import type { PlaceableAtlasRef } from '@/lib/placeable-animation';

export interface BuiltOverlayVisual {
  readonly slot: string;
  readonly data: SpriteVisualRenderData;
  readonly atlases: readonly PlaceableAtlasRef[];
}

/**
 * Build the render-ready visual for ONE overlay slot from its core-derived
 * {@link ResolvedOverlayVisual} (entity-first: the winning `overlay-visual`
 * claimant entity's `visual-ref`). A slot whose sprite cannot be resolved is
 * skipped — the projector omits the overlay.
 */
export const buildOverlayVisualRenderData = (
  packs: ReadonlyMap<string, TilesetPack>,
  visual: ResolvedOverlayVisual,
): BuiltOverlayVisual | undefined => {
  const built = buildEntityVisualRenderData(packs, visual.visual, 'overlayvisual');
  if (built === undefined) {
    return undefined;
  }
  return {
    slot: visual.slot,
    data: built.data,
    atlases: built.atlases,
  };
};

export const loadOverlayVisualAtlasSpec = async (
  atlas: PlaceableAtlasRef,
): Promise<BundledAssetSpec> => loadPackAssetBundledSpec(atlas);

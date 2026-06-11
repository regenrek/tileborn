import type { ResolvedEntityVisual } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';

import type { SpriteVisualRenderData } from '@/lib/playtest-plugin-bridge';
import {
  buildPlaceableAnimation,
  type PlaceableAtlasRef,
} from '@/lib/placeable-animation';

const entityAnchors = (
  visual: ResolvedEntityVisual,
): SpriteVisualRenderData['anchors'] | undefined => {
  const entries = Object.entries(visual.anchors).map(([name, anchor]) => [
    name,
    {
      point: { x: anchor.point.x, y: anchor.point.y },
      rotationDeg: anchor.rotationDeg,
      zOffset: anchor.zOffset,
    },
  ] as const);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

/**
 * Resolve ONE entity visual (a `GameObjectType`'s derived `visual-ref`
 * projection) into renderable frames. Catalog visual-refs identify the sprite
 * by globally-unique `placeableId` without a pack id, so the placeable is
 * looked up across all installed packs. The render-data shape is the
 * projector's generic {@link SpriteVisualRenderData} contract: `visualId`
 * carries the placeable id as the stable animation identity.
 */
export const buildEntityVisualRenderData = (
  packs: ReadonlyMap<string, TilesetPack>,
  visual: ResolvedEntityVisual,
  namespace: string,
): { readonly data: SpriteVisualRenderData; readonly atlases: readonly PlaceableAtlasRef[] } | undefined => {
  const placeableId = visual.placeableId;
  if (placeableId === undefined) {
    return undefined;
  }
  for (const [packId, pack] of packs) {
    const animation = buildPlaceableAnimation(pack, packId, String(placeableId), undefined, namespace);
    if (animation === undefined) {
      continue;
    }
    const anchors = entityAnchors(visual);
    const renderProfile = visual.renderProfile;
    return {
      data: {
        visualId: String(placeableId),
        assetId: animation.frames[0]!.assetId,
        frames: animation.frames,
        loop: animation.loop,
        ...(animation.defaultDurationMs === undefined
          ? {}
          : { defaultDurationMs: animation.defaultDurationMs }),
        ...(renderProfile === undefined
          ? {}
          : { anchor: { x: renderProfile.pivot.x, y: renderProfile.pivot.y } }),
        ...(anchors === undefined ? {} : { anchors }),
        ...(renderProfile === undefined ? {} : { renderScale: renderProfile.scale }),
      },
      atlases: animation.atlases,
    };
  }
  return undefined;
};

import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import type { BundledAssetSpec, RenderableAnimationFrame } from '@tileborne/runtime';
import { Option } from 'effect';

import { loadPackAssetBundledSpec, renderablePackAssetId } from '@/lib/runtime-asset-spec';

export interface PlaceableAtlasRef {
  readonly renderableAssetId: string;
  readonly packId: string;
  readonly assetPath: string;
  readonly mime: string;
}

export interface BuiltPlaceableAnimation {
  readonly frames: readonly RenderableAnimationFrame[];
  readonly loop: boolean;
  readonly defaultDurationMs?: number;
  readonly atlases: readonly PlaceableAtlasRef[];
}

/**
 * Resolve a pack placeable (optionally a specific clip) into renderable frames
 * plus the atlas textures those frames crop from. Shared by per-entity weapon
 * visuals and overlay visuals (entity-first render pipeline).
 */
export const buildPlaceableAnimation = (
  pack: TilesetPack,
  packId: string,
  placeableRefId: string,
  clipId: string | undefined,
  namespace: string,
): BuiltPlaceableAnimation | undefined => {
  const placeable = pack.placeables?.find((entry) => String(entry.id) === placeableRefId);
  if (placeable === undefined) {
    return undefined;
  }
  const assetById = new Map<string, { readonly path: string; readonly mime: string }>(
    pack.assets.map((asset) => [String(asset.id), { path: asset.path, mime: asset.mime ?? 'image/png' }]),
  );
  const atlases = new Map<string, PlaceableAtlasRef>();
  const clip =
    clipId === undefined
      ? undefined
      : placeable.clips?.find((candidate) => String(candidate.id) === clipId);
  const sourceFrames = clip?.frames ?? placeable.frames;
  const frames: RenderableAnimationFrame[] = [];
  for (const frame of sourceFrames) {
    const atlasAssetId = String(frame.assetId);
    const asset = assetById.get(atlasAssetId);
    if (asset === undefined) {
      continue;
    }
    const renderableId = renderablePackAssetId(namespace, packId, atlasAssetId);
    if (!atlases.has(atlasAssetId)) {
      atlases.set(atlasAssetId, {
        renderableAssetId: renderableId,
        packId,
        assetPath: asset.path,
        mime: asset.mime,
      });
    }
    frames.push({
      assetId: renderableId,
      uv: { x: frame.uv.x, y: frame.uv.y, w: frame.uv.w, h: frame.uv.h },
      ...(Option.isSome(frame.durationMs) ? { durationMs: frame.durationMs.value } : {}),
    });
  }
  if (frames.length === 0) {
    return undefined;
  }
  return {
    frames,
    loop: clip?.loop ?? false,
    ...(clip?.defaultDurationMs === undefined ? {} : { defaultDurationMs: clip.defaultDurationMs }),
    atlases: [...atlases.values()],
  };
};

export const loadPlaceableAtlasSpec = async (
  atlas: PlaceableAtlasRef,
): Promise<BundledAssetSpec> => loadPackAssetBundledSpec(atlas);

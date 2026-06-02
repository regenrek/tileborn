import { Option } from 'effect';
import type { AssetLibraryReference } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';

import type { LibraryPreviewRef } from '@/lib/asset-library-bridge';

/** Ordered animation frames for a palette thumbnail (one crop ref per clip frame). */
export interface SpriteThumbnailFrames {
  readonly frames: readonly LibraryPreviewRef[];
  /** Per-frame durations aligned with `frames` (undefined falls back to default). */
  readonly durationsMs: readonly (number | undefined)[];
  readonly loop: boolean;
  readonly defaultDurationMs: number | undefined;
}

/**
 * Build the ordered clip-frame preview refs for a sprite/placeable working
 * palette item so its thumbnail can animate frame-identically to the Studio
 * preview and the placed object. Pure: given the loaded pack + ref it returns
 * one {@link LibraryPreviewRef} per clip frame (or `undefined` when the ref is
 * not an animatable placeable). The first authored clip (or the implicit
 * `frames[]` default) is used, matching the editor's default-clip semantics.
 */
export const spriteClipPreviewFrames = (
  pack: TilesetPack,
  ref: AssetLibraryReference,
): SpriteThumbnailFrames | undefined => {
  if (ref.kind !== 'sprite' && ref.kind !== 'placeable') {
    return undefined;
  }
  const placeable = pack.placeables?.find((entry) => String(entry.id) === ref.refId);
  if (placeable === undefined) {
    return undefined;
  }
  const assetPathById = new Map<string, string>(
    pack.assets.map((asset) => [String(asset.id), asset.path]),
  );

  // Prefer the pinned clip, then the first authored clip, then the implicit
  // top-level frames default — matching how the editor resolves a sprite clip.
  const pinnedClip =
    ref.clipId === undefined
      ? undefined
      : placeable.clips?.find((clip) => String(clip.id) === String(ref.clipId));
  const clip = pinnedClip ?? placeable.clips?.[0];
  const clipFrames = clip?.frames ?? placeable.frames;
  const loop = clip?.loop ?? true;
  const defaultDurationMs = clip?.defaultDurationMs;

  const frames: LibraryPreviewRef[] = [];
  const durationsMs: (number | undefined)[] = [];
  for (const frame of clipFrames) {
    const assetPath = assetPathById.get(String(frame.assetId));
    if (assetPath === undefined) {
      continue;
    }
    frames.push({
      assetPath,
      x: frame.uv.x,
      y: frame.uv.y,
      width: frame.uv.w,
      height: frame.uv.h,
    });
    durationsMs.push(Option.getOrUndefined(frame.durationMs));
  }

  if (frames.length === 0) {
    return undefined;
  }
  return { frames, durationsMs, loop, defaultDurationMs };
};

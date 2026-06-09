import type { PlayerModelClipKey, PlayerModelRef } from '@tileborne/core';
import { REQUIRED_PLAYER_MODEL_CLIP_KEYS } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import type { BundledAssetSpec, RenderableAnimationFrame } from '@tileborne/runtime';
import { Option } from 'effect';

import type { PlayerModelRenderData } from '@/lib/playtest-plugin-bridge';
import type { PlayerModelClipRenderData } from '@/lib/playtest-plugin-bridge';
import { loadPackAssetBundledSpec, renderablePackAssetId } from '@/lib/runtime-asset-spec';

/** A built player model: render data + the installed-pack atlas(es) it needs. */
export interface BuiltPlayerModel {
  readonly modelId: string;
  readonly data: PlayerModelRenderData;
  readonly atlases: readonly {
    readonly renderableAssetId: string;
    readonly packId: string;
    readonly assetPath: string;
    readonly mime: string;
  }[];
}

/** Stable runtime-renderable id for an installed-pack atlas asset. */
const renderableAtlasId = (packId: string, assetId: string): string =>
  renderablePackAssetId('playermodel', packId, assetId);

const renderScaleFor = (
  properties: Readonly<Record<string, unknown>>,
): number | undefined => {
  const value = properties['tileborne.player.renderScale'];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
};

/**
 * Build runtime render data (atlas id + per-frame UV animation + anchor) for a
 * {@link PlayerModelRef} from its loaded pack. Pure; the caller loads the named
 * atlas textures into the renderer before projecting. Returns `undefined` when
 * the model's placeable/clip can't be resolved in the pack.
 */
export const buildPlayerModelRenderData = (
  pack: TilesetPack,
  model: PlayerModelRef,
): BuiltPlayerModel | undefined => {
  const placeable = pack.placeables?.find((entry) => String(entry.id) === model.ref.refId);
  if (placeable === undefined) {
    return undefined;
  }
  const assetById = new Map<string, { readonly path: string; readonly mime: string }>(
    pack.assets.map((asset) => [String(asset.id), { path: asset.path, mime: asset.mime ?? 'image/png' }]),
  );
  const atlases = new Map<
    string,
    { renderableAssetId: string; packId: string; assetPath: string; mime: string }
  >();
  const buildClip = (key: PlayerModelClipKey): PlayerModelClipRenderData | undefined => {
    const clipId = model.clips[key];
    const clip = placeable.clips?.find((entry) => String(entry.id) === String(clipId));
    if (clip === undefined) {
      return undefined;
    }
    const frames: RenderableAnimationFrame[] = [];
    for (const frame of clip.frames) {
      const atlasAssetId = String(frame.assetId);
      const asset = assetById.get(atlasAssetId);
      if (asset === undefined) {
        continue;
      }
      const renderableId = renderableAtlasId(model.ref.packId, atlasAssetId);
      if (!atlases.has(atlasAssetId)) {
        atlases.set(atlasAssetId, {
          renderableAssetId: renderableId,
          packId: model.ref.packId,
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
      loop: clip.loop,
      ...(clip.defaultDurationMs === undefined ? {} : { defaultDurationMs: clip.defaultDurationMs }),
    };
  };

  const clips = Object.fromEntries(
    REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key) => [key, buildClip(key)] as const),
  ) as Record<PlayerModelClipKey, PlayerModelClipRenderData | undefined>;
  if (REQUIRED_PLAYER_MODEL_CLIP_KEYS.some((key) => clips[key] === undefined)) {
    return undefined;
  }
  const renderScale = model.renderScale ?? renderScaleFor(placeable.source.properties);

  return {
    modelId: model.id,
    data: {
      assetId: clips.idle!.frames[0]!.assetId,
      clips: clips as Record<PlayerModelClipKey, PlayerModelClipRenderData>,
      anchor: { x: model.anchor.x, y: model.anchor.y },
      ...(renderScale === undefined ? {} : { renderScale }),
      ...(model.worldSize === undefined
        ? {}
        : { worldSize: { width: model.worldSize.width, height: model.worldSize.height } }),
    },
    atlases: [...atlases.values()],
  };
};

/**
 * Fetch an installed-pack atlas via the `tileborne-asset` protocol and produce a
 * data-URL-backed {@link BundledAssetSpec} the runtime can load (Pixi resolves a
 * data URL without an extension, unlike the protocol URL). Player-model sprite
 * sheets are small, so a one-time base64 inline is acceptable.
 */
export const loadPlayerModelAtlasSpec = async (atlas: {
  readonly renderableAssetId: string;
  readonly packId: string;
  readonly assetPath: string;
  readonly mime: string;
}): Promise<BundledAssetSpec> => loadPackAssetBundledSpec(atlas);

import type { PlayerModelRef } from '@tileborne/core';
import { resolvePlayerModelClipId } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import {
  BundledAssetIdSchema,
  type BundledAssetSpec,
  type RenderableAnimationFrame,
} from '@tileborne/runtime';
import { Option, Schema } from 'effect';

import { assetProtocolUrl } from '@/lib/asset-url';
import type { PlayerModelRenderData } from '@/lib/playtest-plugin-bridge';

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
  `playermodel:${packId}:${assetId}`;

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
  const assetPathById = new Map<string, string>(
    pack.assets.map((asset) => [String(asset.id), asset.path]),
  );
  const clipId = resolvePlayerModelClipId(model);
  const clip =
    (clipId === undefined
      ? undefined
      : placeable.clips?.find((entry) => String(entry.id) === String(clipId))) ??
    placeable.clips?.[0];
  const clipFrames = clip?.frames ?? placeable.frames;
  const loop = clip?.loop ?? true;
  const defaultDurationMs = clip?.defaultDurationMs;

  const atlases = new Map<
    string,
    { renderableAssetId: string; packId: string; assetPath: string; mime: string }
  >();
  const frames: RenderableAnimationFrame[] = [];
  for (const frame of clipFrames) {
    const atlasAssetId = String(frame.assetId);
    const assetPath = assetPathById.get(atlasAssetId);
    if (assetPath === undefined) {
      continue;
    }
    const renderableId = renderableAtlasId(model.ref.packId, atlasAssetId);
    if (!atlases.has(atlasAssetId)) {
      atlases.set(atlasAssetId, {
        renderableAssetId: renderableId,
        packId: model.ref.packId,
        assetPath,
        mime: 'image/png',
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
    modelId: model.id,
    data: {
      assetId: frames[0]!.assetId,
      frames,
      loop,
      ...(defaultDurationMs === undefined ? {} : { defaultDurationMs }),
      anchor: { x: model.anchor.x, y: model.anchor.y },
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
}): Promise<BundledAssetSpec> => {
  const response = await fetch(assetProtocolUrl(atlas.packId, atlas.assetPath));
  if (!response.ok) {
    throw new Error(`failed to load player-model atlas ${atlas.assetPath}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const dataUrl = `data:${atlas.mime};base64,${btoa(binary)}`;
  return {
    assetId: Schema.decodeUnknownSync(BundledAssetIdSchema)(atlas.renderableAssetId),
    path: dataUrl,
    mime: atlas.mime,
  };
};

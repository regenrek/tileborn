import type { VisualAssetRoleRef } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import type { BundledAssetSpec, RenderableAnimationFrame } from '@tileborne/runtime';
import { Option } from 'effect';

import type { VisualRoleRenderData } from '@/lib/playtest-plugin-bridge';
import { loadPackAssetBundledSpec, renderablePackAssetId } from '@/lib/runtime-asset-spec';

export interface BuiltVisualAssetRole {
  readonly roleKind: string;
  readonly data: VisualRoleRenderData;
  readonly atlases: readonly {
    readonly renderableAssetId: string;
    readonly packId: string;
    readonly assetPath: string;
    readonly mime: string;
  }[];
}

const renderableVisualRoleAtlasId = (packId: string, assetId: string): string =>
  renderablePackAssetId('visualrole', packId, assetId);

const visualRoleAnchors = (
  role: VisualAssetRoleRef,
): VisualRoleRenderData['anchors'] | undefined => {
  const entries = Object.entries(role.anchors).map(([name, anchor]) => [
    name,
    {
      point: { x: anchor.point.x, y: anchor.point.y },
      rotationDeg: anchor.rotationDeg,
      zOffset: anchor.zOffset,
    },
  ] as const);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

export const buildVisualRoleRenderData = (
  pack: TilesetPack,
  role: VisualAssetRoleRef,
): BuiltVisualAssetRole | undefined => {
  if (role.ref.kind !== 'sprite' && role.ref.kind !== 'placeable') {
    return undefined;
  }
  const placeable = pack.placeables?.find((entry) => String(entry.id) === role.ref.refId);
  if (placeable === undefined) {
    return undefined;
  }
  const assetById = new Map<string, { readonly path: string; readonly mime: string }>(
    pack.assets.map((asset) => [String(asset.id), { path: asset.path, mime: asset.mime ?? 'image/png' }]),
  );
  const atlases = new Map<
    string,
    { readonly renderableAssetId: string; readonly packId: string; readonly assetPath: string; readonly mime: string }
  >();
  const clipId = role.defaultClipId ?? role.ref.clipId;
  const clip =
    clipId === undefined
      ? undefined
      : placeable.clips?.find((candidate) => String(candidate.id) === String(clipId));
  const sourceFrames = clip?.frames ?? placeable.frames;
  const frames: RenderableAnimationFrame[] = [];
  for (const frame of sourceFrames) {
    const atlasAssetId = String(frame.assetId);
    const asset = assetById.get(atlasAssetId);
    if (asset === undefined) {
      continue;
    }
    const renderableId = renderableVisualRoleAtlasId(role.ref.packId, atlasAssetId);
    if (!atlases.has(atlasAssetId)) {
      atlases.set(atlasAssetId, {
        renderableAssetId: renderableId,
        packId: role.ref.packId,
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
  const anchors = visualRoleAnchors(role);
  return {
    roleKind: String(role.roleKind),
    data: {
      roleId: role.id,
      roleKind: String(role.roleKind),
      assetId: frames[0]!.assetId,
      frames,
      loop: clip?.loop ?? false,
      ...(clip?.defaultDurationMs === undefined ? {} : { defaultDurationMs: clip.defaultDurationMs }),
      anchor: { x: role.renderProfile.pivot.x, y: role.renderProfile.pivot.y },
      ...(anchors === undefined ? {} : { anchors }),
      renderScale: role.renderProfile.scale,
    },
    atlases: [...atlases.values()],
  };
};

export const loadVisualRoleAtlasSpec = async (atlas: {
  readonly renderableAssetId: string;
  readonly packId: string;
  readonly assetPath: string;
  readonly mime: string;
}): Promise<BundledAssetSpec> => loadPackAssetBundledSpec(atlas);

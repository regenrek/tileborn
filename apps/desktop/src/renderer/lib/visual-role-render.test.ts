import {
  AssetLibraryReference,
  RenderProfile,
  AttachmentAnchor,
  VisualAnchorPoint,
  VisualAssetRoleRef,
  WELL_KNOWN_VISUAL_ROLE_KINDS,
  makeClipId,
  makePackId,
} from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildVisualRoleRenderData } from './visual-role-render';

const PACK_ID = makePackId('550e8400-e29b-4000-8000-000000000001');
const PLACEABLE_ID = 'placeable:weapon-rifle';
const ATLAS_ASSET_ID = 'asset:550e8400-e29b-4000-8000-000000000002';
const CLIP_ID = makeClipId('550e8400-e29b-4000-8000-000000000003');

const frame = (x: number, durationMs?: number) => ({
  assetId: ATLAS_ASSET_ID,
  tileId: `tile:${x}`,
  uv: { x, y: 0, w: 24, h: 16 },
  durationMs: durationMs === undefined ? Option.none() : Option.some(durationMs),
});

const pack: TilesetPack = {
  id: PACK_ID,
  assets: [{ id: ATLAS_ASSET_ID, path: 'atlases/weapons.png', mime: 'image/png' }],
  placeables: [
    {
      id: PLACEABLE_ID,
      name: 'Rifle',
      size: { width: 24, height: 16 },
      frames: [frame(0)],
      clips: [
        {
          id: CLIP_ID,
          name: 'shoot',
          frames: [frame(24, 75), frame(48, 75)],
          loop: true,
          defaultDurationMs: 75,
        },
      ],
      source: { properties: {} },
    },
  ],
} as unknown as TilesetPack;

const role = (clip = CLIP_ID): VisualAssetRoleRef =>
  new VisualAssetRoleRef({
    id: 'visual-role:equipped-weapon',
    roleKind: WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon,
    label: 'Rifle',
    ref: new AssetLibraryReference({
      packId: PACK_ID,
      kind: 'sprite',
      refId: PLACEABLE_ID,
      clipId: clip,
    }),
    renderProfile: new RenderProfile({
      scale: 1.5,
      pivot: new VisualAnchorPoint({ x: 0.4, y: 0.6 }),
    }),
    anchors: {
      hand: new AttachmentAnchor({ point: new VisualAnchorPoint({ x: 0.4, y: 0.6 }) }),
      muzzle: new AttachmentAnchor({ point: new VisualAnchorPoint({ x: 0.9, y: 0.5 }) }),
    },
  });

describe('buildVisualRoleRenderData', () => {
  it('builds atlas-backed render data for a selected visual role clip', () => {
    const built = buildVisualRoleRenderData(pack, role());

    expect(built?.roleKind).toBe(WELL_KNOWN_VISUAL_ROLE_KINDS.equippedWeapon);
    expect(built?.data.assetId).toContain('visualrole:');
    expect(built?.data.frames).toHaveLength(2);
    expect(built?.data.frames[0]?.uv).toEqual({ x: 24, y: 0, w: 24, h: 16 });
    expect(built?.data.loop).toBe(true);
    expect(built?.data.defaultDurationMs).toBe(75);
    expect(built?.data.anchor).toEqual({ x: 0.4, y: 0.6 });
    expect(built?.data.anchors?.hand?.point).toEqual({ x: 0.4, y: 0.6 });
    expect(built?.data.anchors?.muzzle?.point).toEqual({ x: 0.9, y: 0.5 });
    expect(built?.data.renderScale).toBe(1.5);
    expect(built?.atlases).toEqual([
      {
        renderableAssetId: built?.data.assetId,
        packId: PACK_ID,
        assetPath: 'atlases/weapons.png',
        mime: 'image/png',
      },
    ]);
  });

  it('falls back to the placeable default frames when the role has no clip', () => {
    const noClip = new VisualAssetRoleRef({
      ...role(),
      ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'placeable', refId: PLACEABLE_ID }),
    });

    const built = buildVisualRoleRenderData(pack, noClip);

    expect(built?.data.frames).toHaveLength(1);
    expect(built?.data.frames[0]?.uv).toEqual({ x: 0, y: 0, w: 24, h: 16 });
    expect(built?.data.loop).toBe(false);
  });

  it('returns undefined when the referenced placeable is missing', () => {
    const missing = new VisualAssetRoleRef({
      ...role(),
      ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'placeable', refId: 'placeable:missing' }),
    });

    expect(buildVisualRoleRenderData(pack, missing)).toBeUndefined();
  });
});

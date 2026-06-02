import { AssetLibraryReference, PlayerModelRef, makeClipId, makePackId } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlayerModelRenderData } from './player-model-render';

const PACK_ID = makePackId('550e8400-e29b-41d4-a716-446655440999');
const PLACEABLE_ID = 'placeable:hero';
const ATLAS_ASSET_ID = 'asset:hero-atlas';
const CLIP_ID = makeClipId('550e8400-e29b-41d4-a716-446655440aaa');

const frame = (x: number, durationMs?: number) => ({
  assetId: ATLAS_ASSET_ID,
  tileId: `tile:${x}`,
  uv: { x, y: 0, w: 32, h: 32 },
  durationMs: durationMs === undefined ? Option.none() : Option.some(durationMs),
});

const pack: TilesetPack = {
  id: PACK_ID as string,
  assets: [{ id: ATLAS_ASSET_ID, path: 'atlases/hero.png', mime: 'image/png' }],
  placeables: [
    {
      id: PLACEABLE_ID,
      name: 'Hero',
      size: { width: 32, height: 32 },
      frames: [frame(0), frame(32)],
      clips: [
        {
          id: CLIP_ID,
          name: 'idle',
          frames: [frame(0, 120), frame(32, 120)],
          loop: true,
          defaultDurationMs: 120,
        },
      ],
      source: { properties: {} },
    },
  ],
} as unknown as TilesetPack;

const model = new PlayerModelRef({
  id: 'model:hero',
  label: 'Hero',
  ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'sprite', refId: PLACEABLE_ID, clipId: CLIP_ID }),
  defaultClipId: CLIP_ID,
  anchor: { x: 0.5, y: 1 },
});

describe('buildPlayerModelRenderData', () => {
  it('builds runtime render data with per-frame UV animation + anchor', () => {
    const built = buildPlayerModelRenderData(pack, model);
    expect(built?.modelId).toBe('model:hero');
    expect(built?.data.frames).toHaveLength(2);
    expect(built?.data.frames[0]?.uv).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    expect(built?.data.frames[1]?.uv).toEqual({ x: 32, y: 0, w: 32, h: 32 });
    expect(built?.data.loop).toBe(true);
    expect(built?.data.anchor).toEqual({ x: 0.5, y: 1 });
    // entity assetId + frame assetIds + atlas spec id are the same stable id.
    const atlasId = built!.atlases[0]!.renderableAssetId;
    expect(built?.data.assetId).toBe(atlasId);
    expect(built?.data.frames.every((f) => f.assetId === atlasId)).toBe(true);
    expect(atlasId).toContain('playermodel:');
  });

  it('returns undefined when the placeable is missing from the pack', () => {
    const missing = new PlayerModelRef({
      id: 'model:nope',
      label: 'Nope',
      ref: new AssetLibraryReference({ packId: PACK_ID, kind: 'sprite', refId: 'placeable:nope' }),
      anchor: { x: 0, y: 0 },
    });
    expect(buildPlayerModelRenderData(pack, missing)).toBeUndefined();
  });
});

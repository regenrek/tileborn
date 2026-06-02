import { AssetLibraryReference, makePackId } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { spriteClipPreviewFrames } from './sprite-thumbnail-frames';

const PACK_ID = makePackId('550e8400-e29b-41d4-a716-446655440777');
const PLACEABLE_ID = 'placeable:hero';
const ATLAS_ASSET_ID = 'asset:atlas';

const frameRef = (x: number, durationMs?: number) => ({
  assetId: ATLAS_ASSET_ID,
  tileId: `tile:${x}`,
  uv: { x, y: 0, w: 32, h: 32 },
  durationMs: durationMs === undefined ? Option.none() : Option.some(durationMs),
});

const buildPack = (clip?: {
  readonly frames: readonly ReturnType<typeof frameRef>[];
  readonly loop: boolean;
  readonly defaultDurationMs: number;
}): TilesetPack =>
  ({
    id: PACK_ID as string,
    assets: [{ id: ATLAS_ASSET_ID, path: 'atlases/hero.png', mime: 'image/png' }],
    placeables: [
      {
        id: PLACEABLE_ID,
        name: 'Hero',
        size: { width: 32, height: 32 },
        frames: [frameRef(0), frameRef(32), frameRef(64), frameRef(96)],
        clips: clip === undefined ? undefined : [{ id: 'clip:default', name: 'default', ...clip }],
      },
    ],
  }) as unknown as TilesetPack;

const spriteRef = () =>
  new AssetLibraryReference({
    packId: PACK_ID,
    kind: 'sprite',
    refId: PLACEABLE_ID,
  });

describe('spriteClipPreviewFrames', () => {
  it('falls back to the implicit frames default clip (one crop per frame)', () => {
    const result = spriteClipPreviewFrames(buildPack(), spriteRef());
    expect(result?.frames).toHaveLength(4);
    expect(result?.loop).toBe(true);
    expect(result?.frames.map((frame) => frame.x)).toEqual([0, 32, 64, 96]);
    expect(result?.frames.every((frame) => frame.width === 32)).toBe(true);
  });

  it('honors the first authored clip + its per-frame durations', () => {
    const result = spriteClipPreviewFrames(
      buildPack({
        frames: [frameRef(0, 120), frameRef(32, 90)],
        loop: false,
        defaultDurationMs: 100,
      }),
      spriteRef(),
    );
    expect(result?.frames).toHaveLength(2);
    expect(result?.durationsMs).toEqual([120, 90]);
    expect(result?.loop).toBe(false);
    expect(result?.defaultDurationMs).toBe(100);
  });

  it('returns undefined for non-sprite/placeable kinds', () => {
    const tileRef = new AssetLibraryReference({
      packId: PACK_ID,
      kind: 'tile',
      refId: 'tile-x',
    });
    expect(spriteClipPreviewFrames(buildPack(), tileRef)).toBeUndefined();
  });
});

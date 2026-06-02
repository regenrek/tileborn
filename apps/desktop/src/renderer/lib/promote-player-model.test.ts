import { makeClipId, makePackId } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { describe, expect, it } from 'vitest';

import { buildPlayerModelRefFromPlaceable } from './promote-player-model';

const PACK_ID = makePackId('550e8400-e29b-41d4-a716-446655440123');
const PLACEABLE_ID = 'placeable:hero';
const CLIP_ID = makeClipId('550e8400-e29b-41d4-a716-446655440456');

const pack = (anchorProps: Record<string, unknown>): TilesetPack =>
  ({
    id: PACK_ID as string,
    assets: [{ id: 'asset:atlas', path: 'atlases/hero.png', mime: 'image/png' }],
    placeables: [
      {
        id: PLACEABLE_ID,
        name: 'Hero',
        size: { width: 32, height: 32 },
        frames: [],
        clips: [{ id: CLIP_ID, name: 'idle', frames: [], loop: true, defaultDurationMs: 100 }],
        source: { properties: anchorProps },
      },
    ],
  }) as unknown as TilesetPack;

describe('buildPlayerModelRefFromPlaceable', () => {
  it('builds a sprite-backed PlayerModelRef using numeric anchor props', () => {
    const model = buildPlayerModelRefFromPlaceable(pack({ 'tileborne.anchorX': 0.5, 'tileborne.anchorY': 1 }), {
      packId: PACK_ID,
      placeableId: PLACEABLE_ID,
    });
    expect(model?.label).toBe('Hero');
    expect(model?.ref.kind).toBe('sprite');
    expect(model?.ref.refId).toBe(PLACEABLE_ID);
    expect(model?.defaultClipId).toBe(CLIP_ID);
    expect(model?.anchor).toEqual({ x: 0.5, y: 1 });
  });

  it('falls back to the named anchor then to top-left', () => {
    expect(
      buildPlayerModelRefFromPlaceable(pack({ 'tileborne.anchor': 'center' }), {
        packId: PACK_ID,
        placeableId: PLACEABLE_ID,
      })?.anchor,
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(
      buildPlayerModelRefFromPlaceable(pack({}), {
        packId: PACK_ID,
        placeableId: PLACEABLE_ID,
      })?.anchor,
    ).toEqual({ x: 0, y: 0 });
  });

  it('returns undefined when the placeable is missing', () => {
    expect(
      buildPlayerModelRefFromPlaceable(pack({}), { packId: PACK_ID, placeableId: 'placeable:nope' }),
    ).toBeUndefined();
  });
});

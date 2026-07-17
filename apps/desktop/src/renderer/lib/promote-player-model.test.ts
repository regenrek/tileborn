import { REQUIRED_PLAYER_MODEL_CLIP_KEYS, makeClipId, makePackId } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { describe, expect, it } from 'vitest';

import { buildPlayerModelRefFromPlaceable } from './promote-player-model';

const PACK_ID = makePackId('550e8400-e29b-41d4-a716-446655440123');
const PLACEABLE_ID = 'placeable:hero';
const CLIP_ID = makeClipId('550e8400-e29b-41d4-a716-446655440456');
const OUTSIDE_CLIP_ID = makeClipId('550e8400-e29b-41d4-a716-446655440999');
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

const playerGeometry = {
  'tileborne.anchorX': 0.5,
  'tileborne.anchorY': 1,
  'tileborne.player.hitboxX': 0.25,
  'tileborne.player.hitboxY': 0.1,
  'tileborne.player.hitboxW': 0.5,
  'tileborne.player.hitboxH': 0.85,
  'tileborne.player.handX': 0.75,
  'tileborne.player.handY': 0.45,
} as const;

const geometryWithoutAnchor = {
  'tileborne.player.hitboxX': 0.25,
  'tileborne.player.hitboxY': 0.1,
  'tileborne.player.hitboxW': 0.5,
  'tileborne.player.hitboxH': 0.85,
  'tileborne.player.handX': 0.75,
  'tileborne.player.handY': 0.45,
} as const;

const requiredClips = () =>
  REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key, index) => ({
    id: key === 'idle' ? CLIP_ID : clipIdAt(index),
    name: key,
    frames: [],
    loop: true,
    defaultDurationMs: 100,
  }));

const pack = (properties: Record<string, unknown>, clips = requiredClips()): TilesetPack =>
  ({
    id: PACK_ID as string,
    assets: [{ id: 'asset:atlas', path: 'atlases/hero.png', mime: 'image/png' }],
    placeables: [
      {
        id: PLACEABLE_ID,
        name: 'Hero',
        size: { width: 32, height: 32 },
        frames: [],
        clips,
        source: { properties },
      },
    ],
  }) as unknown as TilesetPack;

describe('buildPlayerModelRefFromPlaceable', () => {
  it('builds a sprite-backed PlayerModelRef from complete player-model metadata', () => {
    const model = buildPlayerModelRefFromPlaceable(pack({ ...playerGeometry }), {
      packId: PACK_ID,
      placeableId: PLACEABLE_ID,
    });
    expect(model?.label).toBe('Hero');
    expect(model?.ref.kind).toBe('sprite');
    expect(model?.ref.refId).toBe(PLACEABLE_ID);
    expect(model?.defaultClipId).toBe(CLIP_ID);
    expect(Object.keys(model?.clips ?? {})).toEqual([...REQUIRED_PLAYER_MODEL_CLIP_KEYS]);
    expect(model?.anchor).toEqual({ x: 0.5, y: 1 });
    expect(model?.hitbox).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.85 });
    expect(model?.anchors.hand?.point).toEqual({ x: 0.75, y: 0.45 });
  });

  it('supports a named anchor when geometry metadata is otherwise complete', () => {
    expect(
      buildPlayerModelRefFromPlaceable(
        pack({ ...geometryWithoutAnchor, 'tileborne.anchor': 'center' }),
        {
          packId: PACK_ID,
          placeableId: PLACEABLE_ID,
        },
      )?.anchor,
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it('rejects placeables without the required clips or geometry metadata', () => {
    expect(
      buildPlayerModelRefFromPlaceable(pack({}), {
        packId: PACK_ID,
        placeableId: PLACEABLE_ID,
      }),
    ).toBeUndefined();
    expect(
      buildPlayerModelRefFromPlaceable(pack({ ...playerGeometry }, requiredClips().slice(0, 1)), {
        packId: PACK_ID,
        placeableId: PLACEABLE_ID,
      }),
    ).toBeUndefined();
  });

  it('rejects placeables with invalid normalized geometry or selected clips', () => {
    expect(
      buildPlayerModelRefFromPlaceable(pack({ ...playerGeometry, 'tileborne.player.hitboxW': 2 }), {
        packId: PACK_ID,
        placeableId: PLACEABLE_ID,
      }),
    ).toBeUndefined();
    expect(
      buildPlayerModelRefFromPlaceable(pack({ ...playerGeometry }), {
        packId: PACK_ID,
        placeableId: PLACEABLE_ID,
        clipId: OUTSIDE_CLIP_ID,
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the placeable is missing', () => {
    expect(
      buildPlayerModelRefFromPlaceable(pack({ ...playerGeometry }), {
        packId: PACK_ID,
        placeableId: 'placeable:nope',
      }),
    ).toBeUndefined();
  });
});

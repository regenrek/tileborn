import { REQUIRED_PLAYER_MODEL_CLIP_KEYS, makeClipId, type PlayerModelClipKey } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import type { SpritePickerSelection } from '@/lib/sprite-picker-model';

import { buildPlayerModelRelink } from './player-model-relink';

const selection = (clipKeys: readonly PlayerModelClipKey[]): SpritePickerSelection => ({
  placeableId: 'placeable:550e8400-e29b-41d4-a716-446655440010',
  packId: 'pack:550e8400-e29b-41d4-a716-446655440011',
  name: 'Hero',
  width: 32,
  height: 32,
  clips: clipKeys.map((key, index) => ({
    id: makeClipId(`550e8400-e29b-41d4-a716-${String(446655440100 + index).padStart(12, '0')}`),
    name: key,
  })),
});

describe('player-model safe relink', () => {
  it('atomically replaces the asset ref and semantic clip bindings', () => {
    const result = buildPlayerModelRelink(
      selection(REQUIRED_PLAYER_MODEL_CLIP_KEYS),
      REQUIRED_PLAYER_MODEL_CLIP_KEYS,
    );

    expect(result.missingClipKeys).toEqual([]);
    expect(result.ref).toMatchObject({
      kind: 'placeable',
      refId: 'placeable:550e8400-e29b-41d4-a716-446655440010',
    });
    expect(result.ref?.clipId).toBe(result.clips?.idle);
    expect(result.clips?.shoot).not.toBe(result.clips?.death);
  });

  it('rejects an incompatible target without returning a partial relink', () => {
    const result = buildPlayerModelRelink(selection(['idle', 'walk']), REQUIRED_PLAYER_MODEL_CLIP_KEYS);

    expect(result.ref).toBeUndefined();
    expect(result.clips).toBeUndefined();
    expect(result.missingClipKeys).toContain('shoot');
    expect(result.missingClipKeys).toContain('death');
  });
});

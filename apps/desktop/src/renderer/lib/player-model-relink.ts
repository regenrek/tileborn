import {
  AssetLibraryReference,
  PlayerModelClipSet,
  type ClipId,
  type PlayerModelClipKey,
} from '@tileborne/core';

import type { SpritePickerSelection } from '@/lib/sprite-picker-model';

export interface PlayerModelRelinkResult {
  readonly ref?: AssetLibraryReference | undefined;
  readonly clips?: PlayerModelClipSet | undefined;
  readonly missingClipKeys: readonly PlayerModelClipKey[];
}

/**
 * Builds an all-or-nothing player-model relink. Clip ids are resolved by their
 * semantic names so changing packs never silently keeps ids from the old atlas.
 */
export const buildPlayerModelRelink = (
  selection: SpritePickerSelection,
  requiredClipKeys: readonly PlayerModelClipKey[],
): PlayerModelRelinkResult => {
  const clipsByName = new Map(
    selection.clips.map((clip) => [clip.name.trim().toLowerCase(), clip.id as ClipId]),
  );
  const missingClipKeys = requiredClipKeys.filter(
    (key) => clipsByName.get(String(key).toLowerCase()) === undefined,
  );
  if (missingClipKeys.length > 0) {
    return { missingClipKeys };
  }
  const clipId = (key: PlayerModelClipKey): ClipId => clipsByName.get(key)!;
  const clips = new PlayerModelClipSet({
    idle: clipId('idle'),
    walk: clipId('walk'),
    run: clipId('run'),
    shoot: clipId('shoot'),
    reload: clipId('reload'),
    hit: clipId('hit'),
    death: clipId('death'),
    dash: clipId('dash'),
    pickup: clipId('pickup'),
  });
  return {
    missingClipKeys: [],
    ref: new AssetLibraryReference({
      packId: selection.packId as AssetLibraryReference['packId'],
      kind: 'placeable',
      refId: selection.placeableId,
      clipId: clips.idle,
    }),
    clips,
  };
};

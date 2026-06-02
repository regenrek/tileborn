import {
  AssetLibraryReference,
  PlayerModelRef,
  type ClipId,
  type JsonValue,
  type PackId,
} from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';

/**
 * Sprite → player-model bridge. Imported sprites flow today only into a
 * placeable brush; this builds the missing {@link PlayerModelRef} (sprite ref +
 * default clip + anchor pivot) so a sprite can be PROMOTED into a game-mode's
 * player-model roster (BR selectable set) or fixed model (RPG). Pure: given the
 * loaded pack + the placeable id it returns a ready-to-persist model ref.
 */
const NAMED_ANCHOR_PIVOT: Record<string, { readonly x: number; readonly y: number }> = {
  'top-left': { x: 0, y: 0 },
  center: { x: 0.5, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
};

const readNumber = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Derive the normalized pivot for a placeable from its persisted anchor properties. */
const anchorFor = (
  properties: Readonly<Record<string, JsonValue>>,
): { readonly x: number; readonly y: number } => {
  const x = readNumber(properties['tileborne.anchorX']);
  const y = readNumber(properties['tileborne.anchorY']);
  if (x !== undefined && y !== undefined) {
    return { x, y };
  }
  const named = properties['tileborne.anchor'];
  if (typeof named === 'string' && named in NAMED_ANCHOR_PIVOT) {
    return NAMED_ANCHOR_PIVOT[named]!;
  }
  return { x: 0, y: 0 };
};

export interface PromotePlayerModelInput {
  readonly packId: PackId;
  readonly placeableId: string;
  readonly clipId?: ClipId | undefined;
}

/** Build a PlayerModelRef from a placeable/sprite reference in the loaded pack. */
export const buildPlayerModelRefFromPlaceable = (
  pack: TilesetPack,
  input: PromotePlayerModelInput,
): PlayerModelRef | undefined => {
  const placeable = pack.placeables?.find((entry) => String(entry.id) === input.placeableId);
  if (placeable === undefined) {
    return undefined;
  }
  const defaultClipId = (input.clipId ?? placeable.clips?.[0]?.id) as ClipId | undefined;
  return new PlayerModelRef({
    id: `model:${input.placeableId}`,
    label: placeable.name,
    ref: new AssetLibraryReference({
      packId: input.packId,
      kind: 'sprite',
      refId: input.placeableId,
      ...(defaultClipId === undefined ? {} : { clipId: defaultClipId }),
    }),
    ...(defaultClipId === undefined ? {} : { defaultClipId }),
    anchor: anchorFor(placeable.source.properties),
  });
};

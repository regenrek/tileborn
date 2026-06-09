import {
  AssetLibraryReference,
  PlayerModelRef,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  validatePlayerModelRef,
  type ClipId,
  type JsonValue,
  type PackId,
  type PlayerModelClipSet,
} from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';

/**
 * Sprite → player-model bridge. Imported sprites flow today only into a
 * placeable brush; this builds the missing {@link PlayerModelRef} only when the
 * placeable already carries the complete production player-model metadata:
 * required semantic clips, anchor, hitbox, and muzzle. Pure: given the loaded
 * pack + the placeable id it returns a ready-to-persist model ref.
 */
const NAMED_ANCHOR_PIVOT: Record<string, { readonly x: number; readonly y: number }> = {
  'top-left': { x: 0, y: 0 },
  center: { x: 0.5, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
};

const readNumber = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readFirstNumber = (
  properties: Readonly<Record<string, JsonValue>>,
  keys: readonly string[],
): number | undefined => {
  for (const key of keys) {
    const value = readNumber(properties[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

/** Derive the normalized pivot for a placeable from its persisted anchor properties. */
const anchorFor = (
  properties: Readonly<Record<string, JsonValue>>,
): { readonly x: number; readonly y: number } | undefined => {
  const x = readNumber(properties['tileborne.anchorX']);
  const y = readNumber(properties['tileborne.anchorY']);
  if (x !== undefined && y !== undefined) {
    return { x, y };
  }
  const named = properties['tileborne.anchor'];
  if (typeof named === 'string' && named in NAMED_ANCHOR_PIVOT) {
    return NAMED_ANCHOR_PIVOT[named]!;
  }
  return undefined;
};

const normalizedHitboxFor = (
  properties: Readonly<Record<string, JsonValue>>,
):
  | { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | undefined => {
  const x = readFirstNumber(properties, ['tileborne.player.hitboxX', 'tileborne.hitboxX']);
  const y = readFirstNumber(properties, ['tileborne.player.hitboxY', 'tileborne.hitboxY']);
  const width = readFirstNumber(properties, ['tileborne.player.hitboxW', 'tileborne.hitboxW']);
  const height = readFirstNumber(properties, ['tileborne.player.hitboxH', 'tileborne.hitboxH']);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
};

const muzzleFor = (
  properties: Readonly<Record<string, JsonValue>>,
): { readonly x: number; readonly y: number } | undefined => {
  const x = readFirstNumber(properties, ['tileborne.player.muzzleX', 'tileborne.muzzleX']);
  const y = readFirstNumber(properties, ['tileborne.player.muzzleY', 'tileborne.muzzleY']);
  return x === undefined || y === undefined ? undefined : { x, y };
};

const clipSetFor = (placeable: NonNullable<TilesetPack['placeables']>[number]): PlayerModelClipSet | undefined => {
  const byName = new Map(
    (placeable.clips ?? []).map((clip) => [clip.name.trim().toLowerCase(), clip.id as ClipId]),
  );
  const entries = REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key) => [key, byName.get(key)] as const);
  if (entries.some(([, clipId]) => clipId === undefined)) {
    return undefined;
  }
  return Object.fromEntries(entries) as PlayerModelClipSet;
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
  const clips = clipSetFor(placeable);
  const anchor = anchorFor(placeable.source.properties);
  const hitbox = normalizedHitboxFor(placeable.source.properties);
  const muzzle = muzzleFor(placeable.source.properties);
  if (clips === undefined || anchor === undefined || hitbox === undefined || muzzle === undefined) {
    return undefined;
  }
  const defaultClipId = input.clipId ?? clips.idle;
  const model = new PlayerModelRef({
    id: `model:${input.placeableId}`,
    label: placeable.name,
    ref: new AssetLibraryReference({
      packId: input.packId,
      kind: 'sprite',
      refId: input.placeableId,
      clipId: defaultClipId,
    }),
    defaultClipId,
    clips,
    anchor,
    hitbox,
    muzzle,
  });
  return validatePlayerModelRef(model).length === 0 ? model : undefined;
};

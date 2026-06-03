import type {
  CollisionFootprintComponent,
  CollisionFootprintPart,
  GameObjectType,
  JsonObject,
  JsonValue,
  MapObject,
} from '@tileborne/core';

/**
 * Renderer-owned, plugin-neutral helpers that bridge a resolved catalog
 * `GameObjectType`'s read-only `CollisionFootprintComponent` (decision `c-q83p`:
 * a "preset" IS an object-type carrying a footprint — no new primitive) to the
 * editor's viewport footprint overlay and inspector preview (ADR-0025 slice 6).
 *
 * Footprint geometry lives on the object-TYPE definition and is never mutated
 * here (decision `c-cgsd`). The only editor-authored, instance-scoped value is a
 * per-instance footprint OFFSET persisted on `MapObject.properties` — the ADR's
 * "per-instance footprint adjustment where the type permits". These functions
 * are pure so the inspector panel, the viewport controller, and their tests all
 * share one source of truth for the property key + offset shape.
 */

/** Find an object type's collision-footprint component, if any. */
export const findCollisionFootprint = (
  objectType: GameObjectType,
): CollisionFootprintComponent | undefined =>
  objectType.components.find(
    (component): component is CollisionFootprintComponent =>
      component._tag === 'collision-footprint',
  );

/**
 * Whether a type "permits" per-instance footprint adjustment (ADR-0025 §5).
 * Hand-authored (`manual`) footprints are author-controlled and tunable per
 * placement; `tiled`/`generated` footprints are machine-derived from art or
 * tooling and are surfaced read-only (re-derive at the source, never hand-tweak
 * a single instance).
 */
export const footprintAllowsInstanceAdjust = (
  footprint: CollisionFootprintComponent,
): boolean => footprint.source === 'manual';

/** The reserved `MapObject.properties` key holding the per-instance footprint offset. */
export const COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY = 'collisionFootprintOffset';

/** A placed object's per-instance footprint offset, in object-local pixels. */
export interface FootprintOffset {
  readonly x: number;
  readonly y: number;
}

export const ZERO_FOOTPRINT_OFFSET: FootprintOffset = { x: 0, y: 0 };

const isPlainRecord = (
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read the effective per-instance footprint offset for a placed object: the
 * value persisted under {@link COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY}, else a
 * zero offset (an untouched instance sits exactly on its type's footprint).
 */
export const readFootprintOffset = (object: MapObject): FootprintOffset => {
  const raw = object.properties[COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY];
  if (!isPlainRecord(raw)) {
    return ZERO_FOOTPRINT_OFFSET;
  }
  const x = raw.x;
  const y = raw.y;
  return {
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
  };
};

/** Serialize a footprint offset into the JSON record persisted on the object. */
export const footprintOffsetRecord = (offset: FootprintOffset): JsonObject => ({
  x: offset.x,
  y: offset.y,
});

/**
 * Compute the next `properties` bag with the per-instance footprint offset
 * applied. Pure: returns a new object and never touches the type definition.
 */
export const mergeFootprintOffset = (object: MapObject, offset: FootprintOffset): JsonObject => ({
  ...object.properties,
  [COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY]: footprintOffsetRecord(offset),
});

/** One footprint part placed into map/world pixel space, ready to draw. */
export interface PositionedFootprintRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly blocksMovement: boolean;
  readonly blocksProjectiles: boolean;
  readonly blocksVision: boolean;
}

/**
 * Place a type's footprint parts (object-local pixel offsets) into world pixel
 * space for a single placed object, shifted by the object's per-instance offset.
 * Returns an empty array for an object whose type carries no footprint parts —
 * the overlay renders nothing for objects without a footprint component.
 */
export const positionedFootprintRects = (
  object: MapObject,
  parts: readonly CollisionFootprintPart[],
): readonly PositionedFootprintRect[] => {
  const offset = readFootprintOffset(object);
  return parts.map((part) => ({
    x: object.x + offset.x + part.x,
    y: object.y + offset.y + part.y,
    width: part.width,
    height: part.height,
    blocksMovement: part.blocksMovement,
    blocksProjectiles: part.blocksProjectiles,
    blocksVision: part.blocksVision,
  }));
};

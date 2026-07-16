import type { JsonObject, JsonValue } from '../project/index.js';

/** Reserved `MapObject.properties` key holding a per-instance footprint offset. */
export const COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY = 'collisionFootprintOffset';

/** A placed object's per-instance footprint offset, in object-local pixels. */
export interface FootprintOffset {
  readonly x: number;
  readonly y: number;
}

export const ZERO_FOOTPRINT_OFFSET: FootprintOffset = { x: 0, y: 0 };

const isPlainRecord = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readCollisionFootprintOffset = (properties: JsonObject): FootprintOffset => {
  const raw = properties[COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY];
  if (!isPlainRecord(raw)) {
    return ZERO_FOOTPRINT_OFFSET;
  }
  return {
    x: typeof raw.x === 'number' ? raw.x : 0,
    y: typeof raw.y === 'number' ? raw.y : 0,
  };
};

export const footprintOffsetRecord = (offset: FootprintOffset): JsonObject => ({
  x: offset.x,
  y: offset.y,
});

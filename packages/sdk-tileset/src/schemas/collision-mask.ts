import { Schema } from 'effect';

/** One edge segment in a polygon collision mask. */
export class CollisionEdge extends Schema.Class<CollisionEdge>('CollisionEdge')({
  x1: Schema.Int,
  y1: Schema.Int,
  x2: Schema.Int,
  y2: Schema.Int,
}) {}

/** Passable/blocked tile bitmask collision. */
export class BitmaskCollisionMask extends Schema.TaggedClass<BitmaskCollisionMask>()('bitmask', {
  passable: Schema.Int,
  blocked: Schema.Int,
}) {}

/** Polygon edge collision with movement/projectile blocking flags. */
export class PolygonCollisionMask extends Schema.TaggedClass<PolygonCollisionMask>()('polygon', {
  edges: Schema.Array(CollisionEdge),
  passable: Schema.Boolean,
  blocksMovement: Schema.Boolean,
  blocksProjectiles: Schema.Boolean,
}) {}

export const CollisionMask = Schema.Union([BitmaskCollisionMask, PolygonCollisionMask]);
export type CollisionMask = typeof CollisionMask.Type;

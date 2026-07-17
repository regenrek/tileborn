import { Schema } from 'effect';

import { AnimationId, TileId } from './ids.js';

/** One frame in a tile animation sequence. */
export class AnimationFrame extends Schema.Class<AnimationFrame>('AnimationFrame')({
  tileId: TileId,
  durationMs: Schema.Int,
}) {}

/** Tile animation metadata compiled from source formats. */
export class Animation extends Schema.Class<Animation>('Animation')({
  id: AnimationId,
  frames: Schema.NonEmptyArray(AnimationFrame),
  loop: Schema.Boolean,
}) {}

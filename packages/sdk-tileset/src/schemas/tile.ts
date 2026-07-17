import { Schema } from 'effect';

import { Animation } from './animation.js';
import { CollisionMask } from './collision-mask.js';
import { TileId } from './ids.js';
import { TerrainClass } from './terrain-class.js';
import { UVRect } from './uv-rect.js';

/** One tile inside a tileset atlas with semantic metadata. */
export class Tile extends Schema.Class<Tile>('Tile')({
  id: TileId,
  uv: UVRect,
  tags: Schema.Array(Schema.String),
  terrainClass: Schema.OptionFromUndefinedOr(TerrainClass),
  collisionMask: Schema.OptionFromUndefinedOr(CollisionMask),
  animation: Schema.OptionFromUndefinedOr(Animation),
}) {}

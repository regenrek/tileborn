import { Schema } from "effect";

import { TileId, VariantFilterId } from "./ids.js";
import { TerrainClass } from "./terrain-class.js";

/**
 * Weighted tile variant selection with a deterministic seed contract.
 * Resolution uses map seed, cell coordinates, layer id, and `seedSalt`.
 */
export class VariantFilter extends Schema.Class<VariantFilter>("VariantFilter")({
  id: VariantFilterId,
  terrainClass: Schema.OptionFromUndefinedOr(TerrainClass),
  tileIds: Schema.NonEmptyArray(TileId),
  weights: Schema.Array(Schema.Number),
  seedSalt: Schema.String,
  stableAcrossAnimationFrames: Schema.Boolean,
}) {}

import { AssetId } from "@tileborne/core";
import { Schema } from "effect";

import { AutotileRule } from "./autotile-rule.js";
import { TilesetId } from "./ids.js";
import { Tile } from "./tile.js";
import { TerrainTransition } from "./terrain-transition.js";
import { VariantFilter } from "./variant-filter.js";

/** Square grid cell dimensions for atlas slicing. */
export class CellSize extends Schema.Class<CellSize>("CellSize")({
  width: Schema.Int,
  height: Schema.Int,
}) {}

/** One tileset atlas with sliced tiles and semantic rules. */
export class Tileset extends Schema.Class<Tileset>("Tileset")({
  id: TilesetId,
  name: Schema.String,
  atlasAssetId: AssetId,
  cellSize: CellSize,
  margin: Schema.Int,
  spacing: Schema.Int,
  tiles: Schema.Array(Tile),
  autotileRules: Schema.Array(AutotileRule),
  variantFilters: Schema.Array(VariantFilter),
  terrainTransitions: Schema.Array(TerrainTransition),
}) {}

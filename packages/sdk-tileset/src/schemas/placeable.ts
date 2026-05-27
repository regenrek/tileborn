import { AssetId, JsonObject } from "@tileborne/core";
import { Schema } from "effect";

import { PlaceableId, TileId } from "./ids.js";
import { UVRect } from "./uv-rect.js";

export const PlaceablePlacementMode = Schema.Literals(["object", "tile-and-object"]);
export type PlaceablePlacementMode = typeof PlaceablePlacementMode.Type;

/** Pixel size for an object that is placed as a whole asset. */
export class PlaceableSize extends Schema.Class<PlaceableSize>("PlaceableSize")({
  width: Schema.Number,
  height: Schema.Number,
}) {}

/** One renderable frame for a placeable object. */
export class PlaceableFrameRef extends Schema.Class<PlaceableFrameRef>("PlaceableFrameRef")({
  assetId: AssetId,
  tileId: TileId,
  uv: UVRect,
  durationMs: Schema.OptionFromUndefinedOr(Schema.Int),
}) {}

/** Tiled provenance retained for image-collection tiles and tile-object placement. */
export class TiledPlaceableSource extends Schema.Class<TiledPlaceableSource>("TiledPlaceableSource")({
  format: Schema.Literal("tiled"),
  tilesetName: Schema.String,
  localTileId: Schema.Int,
  image: Schema.OptionFromUndefinedOr(Schema.String),
  imageWidth: Schema.OptionFromUndefinedOr(Schema.Int),
  imageHeight: Schema.OptionFromUndefinedOr(Schema.Int),
  objectType: Schema.OptionFromUndefinedOr(Schema.String),
  objectClass: Schema.OptionFromUndefinedOr(Schema.String),
  properties: JsonObject,
}) {}

/** Asset-pack object definition intended for object-layer placement, not cell painting. */
export class Placeable extends Schema.Class<Placeable>("Placeable")({
  id: PlaceableId,
  name: Schema.String,
  size: PlaceableSize,
  frames: Schema.NonEmptyArray(PlaceableFrameRef),
  tags: Schema.Array(Schema.String),
  placementMode: PlaceablePlacementMode,
  source: TiledPlaceableSource,
}) {}

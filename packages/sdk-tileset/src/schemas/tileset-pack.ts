import { AssetId, PackId } from "@tileborne/core";
import { Schema } from "effect";

import { Placeable } from "./placeable.js";
import { Tileset } from "./tileset.js";

/** License metadata attached to a tileset pack. */
export class TilesetPackLicense extends Schema.Class<TilesetPackLicense>("TilesetPackLicense")({
  spdxId: Schema.String,
  attribution: Schema.OptionFromUndefinedOr(Schema.String),
  sourceUrl: Schema.OptionFromUndefinedOr(Schema.String),
  notes: Schema.OptionFromUndefinedOr(Schema.String),
  redistributable: Schema.Boolean,
}) {}

/** Image or data asset referenced by a tileset pack. */
export class TilesetPackAsset extends Schema.Class<TilesetPackAsset>("TilesetPackAsset")({
  id: AssetId,
  path: Schema.String,
  mime: Schema.String,
}) {}

/** Top-level durable tileset pack container. */
export class TilesetPack extends Schema.Class<TilesetPack>("TilesetPack")({
  schemaVersion: Schema.Literal(1),
  id: PackId,
  name: Schema.String,
  version: Schema.String,
  license: TilesetPackLicense,
  tilesets: Schema.Array(Tileset),
  assets: Schema.Array(TilesetPackAsset),
  placeables: Schema.optional(Schema.Array(Placeable)),
}) {}

import { Option, Schema } from 'effect';

import { AssetId, TileId, TileSetId } from '../ids.js';
import { JsonObject } from '../project/index.js';

/** Asset library entry referenced by maps and tilesets. */
export class Asset extends Schema.Class<Asset>('Asset')({
  id: AssetId,
  kind: Schema.Union([
    Schema.Literal('image'),
    Schema.Literal('tileset'),
    Schema.Literal('animation'),
    Schema.Literal('audio'),
    Schema.Literal('data'),
  ]),
  path: Schema.String,
  properties: JsonObject,
}) {}

/** Tile definition inside a tileset (local index + optional metadata). */
export class Tile extends Schema.Class<Tile>('Tile')({
  id: TileId,
  localId: Schema.Int,
  width: Schema.Number,
  height: Schema.Number,
  properties: JsonObject,
}) {}

/** Grid or image-collection tileset surfaced to the editor/runtime. */
export class TileSet extends Schema.Class<TileSet>('TileSet')({
  id: TileSetId,
  name: Schema.String,
  kind: Schema.Union([Schema.Literal('grid'), Schema.Literal('image-collection')]),
  tileWidth: Schema.Number,
  tileHeight: Schema.Number,
  tileCount: Schema.Int,
  columns: Schema.Int,
  imageAssetId: Schema.OptionFromUndefinedOr(AssetId),
  tiles: Schema.Array(Tile),
  properties: JsonObject,
}) {}

export const AssetSchema = Asset;
export const TileSchema = Tile;
export const TileSetSchema = TileSet;

export const makeTileSet = (input: {
  id: TileSetId;
  name: string;
  kind: 'grid' | 'image-collection';
  tileWidth: number;
  tileHeight: number;
  tileCount: number;
  columns: number;
  imageAssetId?: AssetId;
  tiles?: readonly Tile[];
  properties?: JsonObject;
}): TileSet =>
  new TileSet({
    id: input.id,
    name: input.name,
    kind: input.kind,
    tileWidth: input.tileWidth,
    tileHeight: input.tileHeight,
    tileCount: input.tileCount,
    columns: input.columns,
    imageAssetId:
      input.imageAssetId !== undefined ? Option.some(input.imageAssetId) : Option.none(),
    tiles: [...(input.tiles ?? [])],
    properties: input.properties ?? {},
  });

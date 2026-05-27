import { Schema, SchemaGetter } from "effect";

import { AssetId, LayerId, MapId, ObjectId, PackId, PlaceableId, TileId } from "../ids.js";
import { JsonObject } from "../project/index.js";

/** Size in tile or pixel units. */
export class Size2D extends Schema.Class<Size2D>("Size2D")({
  width: Schema.Number,
  height: Schema.Number,
}) {}

/** Chunk of dense tile indices for large maps (spec §10). */
export class TileChunk extends Schema.Class<TileChunk>("TileChunk")({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  tiles: Schema.Array(Schema.Int),
}) {}

/** JSON-safe tile chunk shape used inside persisted map layers. */
const tileChunkPersisted = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  tiles: Schema.Array(Schema.Int),
});

const tileLayerFields = {
  id: LayerId,
  name: Schema.String,
  visible: Schema.Boolean,
  opacity: Schema.Number,
  chunks: Schema.Array(tileChunkPersisted),
} as const;

const objectLayerFields = {
  id: LayerId,
  name: Schema.String,
  visible: Schema.Boolean,
  opacity: Schema.Number,
  objectIds: Schema.Array(ObjectId),
} as const;

const imageLayerFields = {
  id: LayerId,
  name: Schema.String,
  visible: Schema.Boolean,
  opacity: Schema.Number,
  assetId: AssetId,
  x: Schema.Number,
  y: Schema.Number,
} as const;

const collisionLayerFields = {
  id: LayerId,
  name: Schema.String,
  visible: Schema.Boolean,
  opacity: Schema.Number,
  chunks: Schema.Array(tileChunkPersisted),
} as const;

/** Tile layer with chunked storage. */
export class TileLayer extends Schema.TaggedClass<TileLayer>()("tile", tileLayerFields) {}

/** Object layer referencing map objects by id. */
export class ObjectLayer extends Schema.TaggedClass<ObjectLayer>()("object", objectLayerFields) {}

/** Image layer referencing a project asset. */
export class ImageLayer extends Schema.TaggedClass<ImageLayer>()("image", imageLayerFields) {}

/** Collision overlay layer (authoritative mask metadata only). */
export class CollisionLayer extends Schema.TaggedClass<CollisionLayer>()(
  "collision",
  collisionLayerFields,
) {}

const persistedLayer = <Tag extends "tile" | "object" | "image" | "collision", Layer>(
  kind: Tag,
  layer: Layer,
  fields: Schema.Struct.Fields,
) =>
  Schema.Struct({ kind: Schema.Literal(kind), ...fields }).pipe(
    Schema.decodeTo(layer as Schema.Top, {
      decode: SchemaGetter.transform((persisted: { kind: Tag } & Record<string, unknown>) => {
        const { kind: _kind, ...rest } = persisted;
        void _kind;
        return { _tag: kind, ...rest };
      }),
      encode: SchemaGetter.transform((encoded: { _tag: Tag } & Record<string, unknown>) => {
        const { _tag, ...rest } = encoded;
        void _tag;
        return { kind, ...rest };
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- kind/_tag persistence bridge
    } as any),
  ) as Layer;

export const TileLayerPersisted = persistedLayer("tile", TileLayer, tileLayerFields);
export const ObjectLayerPersisted = persistedLayer("object", ObjectLayer, objectLayerFields);
export const ImageLayerPersisted = persistedLayer("image", ImageLayer, imageLayerFields);
export const CollisionLayerPersisted = persistedLayer(
  "collision",
  CollisionLayer,
  collisionLayerFields,
);

export const MapLayer = Schema.Union([
  TileLayerPersisted,
  ObjectLayerPersisted,
  ImageLayerPersisted,
  CollisionLayerPersisted,
]);

export type MapLayer = TileLayer | ObjectLayer | ImageLayer | CollisionLayer;

/** Reference from a map object to an asset-pack placeable. */
export class MapObjectPlacement extends Schema.Class<MapObjectPlacement>("MapObjectPlacement")({
  packId: Schema.OptionFromUndefinedOr(PackId),
  placeableId: PlaceableId,
  source: Schema.Union([Schema.Literal("manual"), Schema.Literal("tiled-object")]),
  assetId: Schema.OptionFromUndefinedOr(AssetId),
  tileId: Schema.OptionFromUndefinedOr(TileId),
  gid: Schema.OptionFromUndefinedOr(Schema.Int),
}) {}

/** Placed object instance on a map. */
export class MapObject extends Schema.Class<MapObject>("MapObject")({
  id: ObjectId,
  kind: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.OptionFromUndefinedOr(Schema.Number),
  height: Schema.OptionFromUndefinedOr(Schema.Number),
  layerId: LayerId,
  properties: JsonObject,
  placement: Schema.optional(MapObjectPlacement),
}) {}

/**
 * Authoritative map model (spec §10).
 * Viewport and renderer adapters consume normalized draw instructions derived from this shape.
 */
export class TileborneMap extends Schema.Class<TileborneMap>("TileborneMap")({
  id: MapId,
  schemaVersion: Schema.Literal(1),
  size: Size2D,
  tileSize: Size2D,
  layers: Schema.Array(MapLayer),
  objects: Schema.Array(MapObject),
  properties: JsonObject,
}) {}

export const TileborneMapSchema = TileborneMap;
export const MapLayerSchema = MapLayer;
export const MapObjectSchema = MapObject;
export const MapObjectPlacementSchema = MapObjectPlacement;
export const TileChunkSchema = TileChunk;

export const makeTileborneMap = (input: {
  id: MapId;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  layers?: readonly MapLayer[];
  objects?: readonly MapObject[];
  properties?: JsonObject;
}): TileborneMap =>
  new TileborneMap({
    id: input.id,
    schemaVersion: 1,
    size: new Size2D({ width: input.width, height: input.height }),
    tileSize: new Size2D({ width: input.tileWidth, height: input.tileHeight }),
    layers: [...(input.layers ?? [])],
    objects: [...(input.objects ?? [])],
    properties: input.properties ?? {},
  });

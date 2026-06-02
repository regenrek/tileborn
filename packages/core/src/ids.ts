import { Option, Result, Schema } from 'effect';

/** UUID v4 (case-insensitive hex). */
export const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export type Uuid = typeof Uuid.Type;

/** Scoped npm package name used for plugin identifiers. */
export const PluginId = Schema.String.check(
  Schema.isPattern(/^@[a-z0-9-][a-z0-9-._~]*\/[a-z0-9-][a-z0-9-._~]*$/i),
).pipe(Schema.brand('PluginId'));

export type PluginId = typeof PluginId.Type;

/** Content hash in `sha256:<hex>` form. */
export const ContentHash = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/)).pipe(
  Schema.brand('ContentHash'),
);

export type ContentHash = typeof ContentHash.Type;

const definePrefixedId = <Tag extends string>(prefix: string, brand: Tag) => {
  const pattern = new RegExp(
    `^${prefix}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'i',
  );
  const schema = Schema.String.check(Schema.isPattern(pattern)).pipe(Schema.brand(brand));
  const make = (uuid: Uuid): (typeof schema)['Type'] =>
    `${prefix}:${uuid}` as (typeof schema)['Type'];

  return { schema, make, prefix };
};

const asset = definePrefixedId('asset', 'AssetId');
const tile = definePrefixedId('tile', 'TileId');
const project = definePrefixedId('project', 'ProjectId');
const map = definePrefixedId('map', 'MapId');
const layer = definePrefixedId('layer', 'LayerId');
const object = definePrefixedId('object', 'ObjectId');
const placeable = definePrefixedId('placeable', 'PlaceableId');
const clip = definePrefixedId('clip', 'ClipId');
const tileset = definePrefixedId('tileset', 'TileSetId');
const runtime = definePrefixedId('runtime', 'RuntimeId');
const build = definePrefixedId('build', 'BuildId');
const pack = definePrefixedId('pack', 'PackId');
const workingPalette = definePrefixedId('working-palette', 'WorkingPaletteId');
const workingPaletteItem = definePrefixedId('working-palette-item', 'WorkingPaletteItemId');
const gameObjectType = definePrefixedId('gobj', 'GameObjectTypeId');
const itemDefinition = definePrefixedId('item', 'ItemDefinitionId');
const lootTable = definePrefixedId('loot', 'LootTableId');
const catalog = definePrefixedId('catalog', 'CatalogId');

/** Branded asset identifier (`asset:<uuid>`). */
export const AssetId = asset.schema;
export type AssetId = typeof AssetId.Type;
export const makeAssetId = asset.make;

/** Branded tile identifier (`tile:<uuid>`). */
export const TileId = tile.schema;
export type TileId = typeof TileId.Type;
export const makeTileId = tile.make;

/** Branded project identifier (`project:<uuid>`). */
export const ProjectId = project.schema;
export type ProjectId = typeof ProjectId.Type;
export const makeProjectId = project.make;

/** Branded map identifier (`map:<uuid>`). */
export const MapId = map.schema;
export type MapId = typeof MapId.Type;
export const makeMapId = map.make;

/** Branded layer identifier (`layer:<uuid>`). */
export const LayerId = layer.schema;
export type LayerId = typeof LayerId.Type;
export const makeLayerId = layer.make;

/** Branded object identifier (`object:<uuid>`). */
export const ObjectId = object.schema;
export type ObjectId = typeof ObjectId.Type;
export const makeObjectId = object.make;

/** Branded placeable identifier (`placeable:<uuid>`). */
export const PlaceableId = placeable.schema;
export type PlaceableId = typeof PlaceableId.Type;
export const makePlaceableId = placeable.make;

/** Branded animation clip identifier (`clip:<uuid>`). */
export const ClipId = clip.schema;
export type ClipId = typeof ClipId.Type;
export const makeClipId = clip.make;

/** Branded tileset identifier (`tileset:<uuid>`). */
export const TileSetId = tileset.schema;
export type TileSetId = typeof TileSetId.Type;
export const makeTileSetId = tileset.make;

/** Branded runtime identifier (`runtime:<uuid>`). */
export const RuntimeId = runtime.schema;
export type RuntimeId = typeof RuntimeId.Type;
export const makeRuntimeId = runtime.make;

/** Branded build identifier (`build:<uuid>`). */
export const BuildId = build.schema;
export type BuildId = typeof BuildId.Type;
export const makeBuildId = build.make;

/** Branded asset-pack identifier (`pack:<uuid>`). */
export const PackId = pack.schema;
export type PackId = typeof PackId.Type;
export const makePackId = pack.make;

/** Branded working-palette identifier (`working-palette:<uuid>`). */
export const WorkingPaletteId = workingPalette.schema;
export type WorkingPaletteId = typeof WorkingPaletteId.Type;
export const makeWorkingPaletteId = workingPalette.make;

/** Branded working-palette item identifier (`working-palette-item:<uuid>`). */
export const WorkingPaletteItemId = workingPaletteItem.schema;
export type WorkingPaletteItemId = typeof WorkingPaletteItemId.Type;
export const makeWorkingPaletteItemId = workingPaletteItem.make;

/** Branded game-object catalog type identifier (`gobj:<uuid>`). */
export const GameObjectTypeId = gameObjectType.schema;
export type GameObjectTypeId = typeof GameObjectTypeId.Type;
export const makeGameObjectTypeId = gameObjectType.make;

/** Branded item-definition identifier (`item:<uuid>`). */
export const ItemDefinitionId = itemDefinition.schema;
export type ItemDefinitionId = typeof ItemDefinitionId.Type;
export const makeItemDefinitionId = itemDefinition.make;

/** Branded loot-table identifier (`loot:<uuid>`). */
export const LootTableId = lootTable.schema;
export type LootTableId = typeof LootTableId.Type;
export const makeLootTableId = lootTable.make;

/** Branded catalog identifier (`catalog:<uuid>`). */
export const CatalogId = catalog.schema;
export type CatalogId = typeof CatalogId.Type;
export const makeCatalogId = catalog.make;

/** All prefixed domain id schemas keyed by prefix. */
export const PrefixedIdSchemas = {
  asset: AssetId,
  tile: TileId,
  project: ProjectId,
  map: MapId,
  layer: LayerId,
  object: ObjectId,
  placeable: PlaceableId,
  clip: ClipId,
  tileset: TileSetId,
  runtime: RuntimeId,
  build: BuildId,
  pack: PackId,
  'working-palette': WorkingPaletteId,
  'working-palette-item': WorkingPaletteItemId,
  gobj: GameObjectTypeId,
  item: ItemDefinitionId,
  loot: LootTableId,
  catalog: CatalogId,
} as const;

const decodeSchema = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  input: unknown,
): Result.Result<A, string> => {
  const result = Schema.decodeUnknownOption(schema)(input);
  return Option.match(result, {
    onNone: () => Result.fail('decode failed'),
    onSome: (value) => Result.succeed(value as A),
  });
};

/**
 * Parse arbitrary input into a branded prefixed id schema.
 * Returns `Err` with a message when the prefix or uuid is invalid.
 */
export const parsePrefixedId = <A extends string>(
  schema: Schema.Codec<A, string, never, never>,
  input: unknown,
): Result.Result<A, string> => decodeSchema(schema, input);

/** Type guard for a branded prefixed id value. */
export const isPrefixedId = <A extends string>(
  schema: Schema.Codec<A, string, never, never>,
  input: unknown,
): input is A => Option.isSome(Schema.decodeUnknownOption(schema)(input));

/** Parse plugin id or return a descriptive error string. */
export const parsePluginId = (input: unknown): Result.Result<PluginId, string> =>
  decodeSchema(PluginId, input);

/** Parse content hash or return a descriptive error string. */
export const parseContentHash = (input: unknown): Result.Result<ContentHash, string> =>
  decodeSchema(ContentHash, input);

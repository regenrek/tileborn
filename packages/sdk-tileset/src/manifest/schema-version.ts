import { AssetId, JsonObject, PERSISTED_SCHEMA_VERSIONS, PackId } from '@tileborne/core';
import { Schema } from 'effect';

import { AutotileRulePattern } from '../schemas/autotile-rule.js';
import { Animation } from '../schemas/animation.js';
import { CollisionMask } from '../schemas/collision-mask.js';
import {
  AnimationId,
  AutotileRuleId,
  ClipId,
  PlaceableId,
  TileId,
  TilesetId,
  VariantFilterId,
} from '../schemas/ids.js';
import { AssetSemanticRoleName, AssetSemanticRoleSource } from '../schemas/semantic-role.js';
import { TerrainClass } from '../schemas/terrain-class.js';
import { UVRect } from '../schemas/uv-rect.js';
import { ManifestProvenance } from './provenance.js';

/** Current durable Tileborne tileset manifest schema version. */
export const TILESET_MANIFEST_SCHEMA_VERSION = PERSISTED_SCHEMA_VERSIONS.tilesetManifest;

export type TilesetManifestSchemaVersion = typeof TILESET_MANIFEST_SCHEMA_VERSION;

/** License block in a Tileborne manifest JSON file. */
export const TilesetManifestLicense = Schema.Struct({
  spdxId: Schema.String,
  attribution: Schema.optional(Schema.String),
  sourceUrl: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
  redistributable: Schema.optional(Schema.Boolean),
});
export type TilesetManifestLicense = typeof TilesetManifestLicense.Type;

/** Asset entry in an installed pack manifest. Extra integrity fields are owned by asset services. */
export const ManifestTilesetPackAsset = Schema.Struct({
  id: AssetId,
  path: Schema.String,
  mime: Schema.String,
  size: Schema.optional(Schema.Number),
  hash: Schema.optional(Schema.Unknown),
  license: Schema.optional(Schema.Unknown),
});
export type ManifestTilesetPackAsset = typeof ManifestTilesetPackAsset.Type;

const autotileRuleFields = {
  id: AutotileRuleId,
  name: Schema.String,
  terrainClasses: Schema.Array(TerrainClass),
  maskToTileIds: Schema.Record(Schema.String, Schema.NonEmptyArray(TileId)),
  fallbackTileId: Schema.optional(TileId),
} as const;

const manifestAutotileRuleFields = {
  tilesetId: TilesetId,
  ...autotileRuleFields,
} as const;

export class ManifestWang2CornerAutotileRule extends Schema.TaggedClass<ManifestWang2CornerAutotileRule>()(
  'wang2corner',
  manifestAutotileRuleFields,
) {}

export class ManifestWang2EdgeAutotileRule extends Schema.TaggedClass<ManifestWang2EdgeAutotileRule>()(
  'wang2edge',
  manifestAutotileRuleFields,
) {}

export class ManifestWang4CornerAutotileRule extends Schema.TaggedClass<ManifestWang4CornerAutotileRule>()(
  'wang4corner',
  manifestAutotileRuleFields,
) {}

export class ManifestBlob47AutotileRule extends Schema.TaggedClass<ManifestBlob47AutotileRule>()(
  'blob47',
  manifestAutotileRuleFields,
) {}

export class ManifestRpgmA2AutotileRule extends Schema.TaggedClass<ManifestRpgmA2AutotileRule>()(
  'rpgmA2',
  manifestAutotileRuleFields,
) {}

export class ManifestRpgmA3AutotileRule extends Schema.TaggedClass<ManifestRpgmA3AutotileRule>()(
  'rpgmA3',
  manifestAutotileRuleFields,
) {}

export class ManifestRpgmA4AutotileRule extends Schema.TaggedClass<ManifestRpgmA4AutotileRule>()(
  'rpgmA4',
  manifestAutotileRuleFields,
) {}

export class ManifestCustomAutotileRule extends Schema.TaggedClass<ManifestCustomAutotileRule>()(
  'custom',
  {
    ...manifestAutotileRuleFields,
    source: Schema.Unknown,
  },
) {}

export const ManifestAutotileRule = Schema.Union([
  ManifestWang2CornerAutotileRule,
  ManifestWang2EdgeAutotileRule,
  ManifestWang4CornerAutotileRule,
  ManifestBlob47AutotileRule,
  ManifestRpgmA2AutotileRule,
  ManifestRpgmA3AutotileRule,
  ManifestRpgmA4AutotileRule,
  ManifestCustomAutotileRule,
]);
export type ManifestAutotileRule = typeof ManifestAutotileRule.Type;

/** Tileset metadata entry in a Tileborne manifest. */
export const TilesetManifestEntry = Schema.Struct({
  id: TilesetId,
  name: Schema.String,
  atlasAssetId: AssetId,
  cellSize: Schema.Struct({
    width: Schema.Int,
    height: Schema.Int,
  }),
  margin: Schema.Int,
  spacing: Schema.Int,
});
export type TilesetManifestEntry = typeof TilesetManifestEntry.Type;

/** Tile entry in a Tileborne manifest referencing a parent tileset. */
export const ManifestTile = Schema.Struct({
  id: TileId,
  tilesetId: TilesetId,
  uv: UVRect,
  tags: Schema.Array(Schema.String),
  terrainClass: Schema.optional(TerrainClass),
  animationId: Schema.optional(AnimationId),
});
export type ManifestTile = typeof ManifestTile.Type;

/** Collision mask entry keyed by tile id. */
export const ManifestCollisionMask = Schema.Struct({
  tileId: TileId,
  mask: CollisionMask,
});
export type ManifestCollisionMask = typeof ManifestCollisionMask.Type;

export const ManifestAssetSemanticRole = Schema.Struct({
  role: AssetSemanticRoleName,
  tileId: TileId,
  source: AssetSemanticRoleSource,
  confidence: Schema.Number,
});
export type ManifestAssetSemanticRole = typeof ManifestAssetSemanticRole.Type;

/** One renderable manifest frame for an object-layer placeable. */
export const ManifestPlaceableFrameRef = Schema.Struct({
  assetId: AssetId,
  tileId: TileId,
  uv: UVRect,
  durationMs: Schema.optional(Schema.Int),
});
export type ManifestPlaceableFrameRef = typeof ManifestPlaceableFrameRef.Type;

/** One named animation clip stored in the durable manifest. */
export const ManifestSpriteClip = Schema.Struct({
  id: ClipId,
  name: Schema.String,
  frames: Schema.NonEmptyArray(ManifestPlaceableFrameRef),
  loop: Schema.Boolean,
  defaultDurationMs: Schema.Int,
});
export type ManifestSpriteClip = typeof ManifestSpriteClip.Type;

/** Tiled provenance retained for image-collection object definitions. */
export const ManifestTiledPlaceableSource = Schema.Struct({
  format: Schema.Literal('tiled'),
  tilesetName: Schema.String,
  localTileId: Schema.Int,
  image: Schema.optional(Schema.String),
  imageWidth: Schema.optional(Schema.Int),
  imageHeight: Schema.optional(Schema.Int),
  objectType: Schema.optional(Schema.String),
  objectClass: Schema.optional(Schema.String),
  properties: JsonObject,
});
export type ManifestTiledPlaceableSource = typeof ManifestTiledPlaceableSource.Type;

/** Object-layer placement definition stored in the durable manifest. */
export const ManifestPlaceable = Schema.Struct({
  id: PlaceableId,
  name: Schema.String,
  size: Schema.Struct({
    width: Schema.Number,
    height: Schema.Number,
  }),
  frames: Schema.NonEmptyArray(ManifestPlaceableFrameRef),
  clips: Schema.optional(Schema.Array(ManifestSpriteClip)),
  tags: Schema.Array(Schema.String),
  placementMode: Schema.optional(Schema.Literals(['object', 'tile-and-object'])),
  source: ManifestTiledPlaceableSource,
});
export type ManifestPlaceable = typeof ManifestPlaceable.Type;

/** Variant filter entry referencing a parent tileset. */
export const ManifestVariantFilter = Schema.Struct({
  id: VariantFilterId,
  tilesetId: TilesetId,
  terrainClass: Schema.optional(TerrainClass),
  tileIds: Schema.NonEmptyArray(TileId),
  weights: Schema.Array(Schema.Number),
  seedSalt: Schema.String,
  stableAcrossAnimationFrames: Schema.Boolean,
});
export type ManifestVariantFilter = typeof ManifestVariantFilter.Type;

/** Terrain transition entry referencing a parent tileset. */
export const ManifestTerrainTransition = Schema.Struct({
  tilesetId: TilesetId,
  from: TerrainClass,
  to: TerrainClass,
  ruleId: AutotileRuleId,
});
export type ManifestTerrainTransition = typeof ManifestTerrainTransition.Type;

/** Canonical on-disk Tileborne tileset manifest JSON shape. */
export const TilesetManifest = Schema.Struct({
  schemaVersion: Schema.Literal(TILESET_MANIFEST_SCHEMA_VERSION),
  id: PackId,
  name: Schema.String,
  version: Schema.String,
  license: TilesetManifestLicense,
  assets: Schema.Array(ManifestTilesetPackAsset),
  provenance: Schema.optional(ManifestProvenance),
  terrainClasses: Schema.Array(TerrainClass),
  tilesets: Schema.Array(TilesetManifestEntry),
  tiles: Schema.Array(ManifestTile),
  autotileRules: Schema.Array(ManifestAutotileRule),
  variantFilters: Schema.Array(ManifestVariantFilter),
  animations: Schema.Array(Animation),
  terrainTransitions: Schema.Array(ManifestTerrainTransition),
  collisionMasks: Schema.Array(ManifestCollisionMask),
  assetSemanticRoles: Schema.optional(Schema.Array(ManifestAssetSemanticRole)),
  placeables: Schema.optional(Schema.Array(ManifestPlaceable)),
});
export type TilesetManifest = typeof TilesetManifest.Type;

export { AutotileRulePattern };
export type { TilesetPack } from '../schemas/tileset-pack.js';

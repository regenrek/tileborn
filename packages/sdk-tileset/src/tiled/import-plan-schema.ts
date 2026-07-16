/** Runtime schemas for the canonical Tiled import planning contract. */
import { Schema } from 'effect';

export const ImportRecordIdSchema = Schema.String.check(Schema.isPattern(/^import:[0-9a-f-]{36}$/));

export const ImportCenterSourceKindSchema = Schema.Literals([
  'tileborne-pack',
  'tiled-map',
  'tiled-tileset',
  'tiled-source-folder',
  'raw-source-folder',
]);

export const ImportCenterDiagnosticSeveritySchema = Schema.Literals(['error', 'warning', 'info']);
export const ImportCenterDiagnosticSchema = Schema.Struct({
  _tag: Schema.String,
  severity: ImportCenterDiagnosticSeveritySchema,
  path: Schema.String,
  message: Schema.String,
  feature: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
});

export const TiledScanSourceKindSchema = Schema.Literals(['map', 'tileset', 'source-folder']);

export const TiledImportScanInventorySchema = Schema.Struct({
  mapCount: Schema.Number,
  tilesetCount: Schema.Number,
  gridAtlasCount: Schema.Number,
  imageCollectionCount: Schema.Number,
  wangSetCount: Schema.Number,
  terrainClassCount: Schema.Number,
  animationCount: Schema.Number,
  collisionObjectCount: Schema.Number,
  objectLayerCount: Schema.Number,
  placeableCandidateCount: Schema.Number,
  unsupportedFeatureCount: Schema.Number,
});
export const TiledImportInventoryPreviewSchema = Schema.Struct({
  ...TiledImportScanInventorySchema.fields,
  imageAssetCount: Schema.Number,
});

export const TiledImportScanMapPreviewSchema = Schema.Struct({
  path: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  tileWidth: Schema.Number,
  tileHeight: Schema.Number,
});

export const TiledImportScanTilesetPreviewSchema = Schema.Struct({
  name: Schema.String,
  firstgid: Schema.Number,
  kind: Schema.Literals(['grid', 'image-collection']),
  tileCount: Schema.Number,
  columns: Schema.Number,
  wangSetCount: Schema.Number,
  terrainClassCount: Schema.Number,
  animationCount: Schema.Number,
  collisionObjectCount: Schema.Number,
  categories: Schema.Array(Schema.String),
  confidence: Schema.Number,
  source: Schema.optional(Schema.String),
});

export const TiledImportImageAssetPreviewSchema = Schema.Struct({
  path: Schema.String,
  tilesetName: Schema.String,
  localTileId: Schema.optional(Schema.Number),
});

export const TiledImportObjectLayerPreviewSchema = Schema.Struct({
  name: Schema.String,
  objectCount: Schema.Number,
  gidObjectCount: Schema.Number,
  categories: Schema.Array(Schema.String),
  confidence: Schema.Number,
});

export const TiledImportPlaceablePreviewSchema = Schema.Struct({
  tilesetName: Schema.String,
  localTileId: Schema.Number,
  source: Schema.Literals(['image-collection', 'tileborne-hint']),
  image: Schema.optional(Schema.String),
  width: Schema.Number,
  height: Schema.Number,
  category: Schema.optional(Schema.String),
  confidence: Schema.Number,
});

export const TiledImportCategoryPreviewSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  source: Schema.Literals(['class', 'type', 'property', 'tileborne-hint']),
  count: Schema.Number,
  confidence: Schema.Number,
});

export const TiledImportFeatureFlagsSchema = Schema.Struct({
  gridAtlas: Schema.Boolean,
  imageCollection: Schema.Boolean,
  wangSets: Schema.Boolean,
  animations: Schema.Boolean,
  collisionObjectgroups: Schema.Boolean,
  templates: Schema.Boolean,
  rotation: Schema.Boolean,
  parallax: Schema.Boolean,
  infiniteChunks: Schema.Boolean,
  unsupportedOrientation: Schema.Boolean,
  classProperties: Schema.Boolean,
  projectFiles: Schema.Boolean,
  flipFlags: Schema.Boolean,
});

export const TiledImportUnsupportedFeatureIdSchema = Schema.Literals([
  'templates',
  'infinite-chunks',
  'rotation',
  'parallax',
  'orientation',
  'class-properties',
  'project-files',
]);

export const TiledImportUnsupportedFeatureSchema = Schema.Struct({
  feature: TiledImportUnsupportedFeatureIdSchema,
  path: Schema.String,
  message: Schema.String,
  action: Schema.String,
});

export const TiledImportAmbiguousAtlasObjectSchema = Schema.Struct({
  tilesetName: Schema.String,
  localTileId: Schema.Number,
  objectId: Schema.optional(Schema.Number),
  path: Schema.String,
  message: Schema.String,
});

export const TiledImportRecommendedProfileSchema = Schema.Union([
  Schema.Literal('standard'),
  Schema.Literal('standard-plus-hints'),
  Schema.Literal('assistive-infer'),
  Schema.Literal('plugin-required'),
  Schema.Struct({
    kind: Schema.Literal('plugin'),
    id: Schema.String,
  }),
]);

export const TiledImportProfileSchema = Schema.Union([
  Schema.Literal('standard'),
  Schema.Literal('standard-plus-hints'),
  Schema.Literal('assistive-infer'),
  Schema.Struct({
    kind: Schema.Literal('plugin'),
    id: Schema.String,
  }),
]);

export const TiledImportSourceRoleKindSchema = Schema.Literals([
  'paintable-tileset',
  'placeable-object',
  'map-context',
  'review-required',
]);

export const TiledImportSourceRoleEvidenceSchema = Schema.Literals([
  'grid-tileset',
  'image-collection',
  'tileborne-placeable-hint',
  'object-layer',
  'ambiguous-atlas-object',
  'unsupported-feature',
]);

export const TiledImportBrowseTargetSchema = Schema.Literals([
  'tilesets',
  'objects',
  'maps',
  'review',
]);

export const TiledImportSourceRoleSchema = Schema.Struct({
  kind: TiledImportSourceRoleKindSchema,
  evidence: TiledImportSourceRoleEvidenceSchema,
  confidence: Schema.Number,
  count: Schema.Number,
  tilesetName: Schema.optional(Schema.String),
  layerName: Schema.optional(Schema.String),
  browseTarget: TiledImportBrowseTargetSchema,
  reviewRequired: Schema.Boolean,
  rationale: Schema.String,
});

export const TiledImportPrimaryActionSchema = Schema.Literals([
  'import-paintable-tilesets',
  'import-placeable-objects',
  'import-mixed-assets',
  'review-before-import',
  'choose-plugin-profile',
]);

export const TiledImportRecommendationSchema = Schema.Struct({
  sourceRoles: Schema.Array(TiledImportSourceRoleSchema),
  recommendedProfile: TiledImportRecommendedProfileSchema,
  primaryAction: TiledImportPrimaryActionSchema,
  browseTarget: TiledImportBrowseTargetSchema,
  rationale: Schema.String,
  reviewRequired: Schema.Boolean,
});

export const TiledImportScanSchema = Schema.Struct({
  sourceKind: TiledScanSourceKindSchema,
  sourcePath: Schema.String,
  maps: Schema.Array(TiledImportScanMapPreviewSchema),
  tilesets: Schema.Array(TiledImportScanTilesetPreviewSchema),
  imageAssets: Schema.Array(TiledImportImageAssetPreviewSchema),
  objectLayers: Schema.Array(TiledImportObjectLayerPreviewSchema),
  placeableCandidates: Schema.Array(TiledImportPlaceablePreviewSchema),
  categories: Schema.Array(TiledImportCategoryPreviewSchema),
  inventory: TiledImportScanInventorySchema,
  confidence: Schema.Number,
  featureFlags: TiledImportFeatureFlagsSchema,
  unsupportedFeatures: Schema.Array(TiledImportUnsupportedFeatureSchema),
  ambiguousAtlasObjects: Schema.Array(TiledImportAmbiguousAtlasObjectSchema),
  recommendedProfile: TiledImportRecommendedProfileSchema,
  sourceRoles: Schema.Array(TiledImportSourceRoleSchema),
  importRecommendation: TiledImportRecommendationSchema,
});

export const TiledImportPlanSuggestionSchema = Schema.Struct({
  id: Schema.String,
  block: Schema.Literals(['tileset', 'placeable', 'category', 'object-layer']),
  target: Schema.String,
  action: Schema.String,
  reason: Schema.String,
  confidence: Schema.Number,
  source: Schema.Literal('assistive-infer'),
});

export const TiledImportPlanMappingSchema = Schema.Struct({
  tilesets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      kind: Schema.Literals(['grid', 'image-collection']),
      categoryIds: Schema.Array(Schema.String),
      paintable: Schema.Boolean,
      placeable: Schema.Boolean,
      confidence: Schema.Number,
    }),
  ),
  categories: Schema.Array(TiledImportCategoryPreviewSchema),
  placeables: Schema.Array(TiledImportPlaceablePreviewSchema),
  maps: Schema.Array(TiledImportScanMapPreviewSchema),
});

export const TiledImportPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sourcePath: Schema.String,
  profile: TiledImportProfileSchema,
  scan: TiledImportScanSchema,
  importRecommendation: TiledImportRecommendationSchema,
  mappings: TiledImportPlanMappingSchema,
  suggestions: Schema.Array(TiledImportPlanSuggestionSchema),
  acceptedSuggestionIds: Schema.Array(Schema.String),
  diagnostics: Schema.Array(ImportCenterDiagnosticSchema),
});

export const TiledAppliedImportPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sourcePath: Schema.String,
  profile: TiledImportProfileSchema,
  selectedMapPath: Schema.String,
  scan: TiledImportScanSchema,
  importRecommendation: TiledImportRecommendationSchema,
  mappings: TiledImportPlanMappingSchema,
  acceptedSuggestions: Schema.Array(TiledImportPlanSuggestionSchema),
  diagnostics: Schema.Array(ImportCenterDiagnosticSchema),
});

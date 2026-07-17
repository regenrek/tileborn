/** Runtime schemas for the canonical Tiled import planning contract. */
import { Schema } from 'effect';

import type { ParseDiagnostic } from '../diagnostics.js';
import type { TiledAppliedImportPlan, TiledImportScan, TiledSourceInventory } from './types.js';

export const ImportRecordIdSchema = Schema.String.check(Schema.isPattern(/^import:[0-9a-f-]{36}$/));

export const ImportCenterSourceKindSchema = Schema.Literals([
  'tileborne-pack',
  'tiled-map',
  'tiled-tileset',
  'tiled-source-folder',
  'raw-source-folder',
]);

export const ImportCenterDiagnosticSeveritySchema = Schema.Literals(['error', 'warning', 'info']);
const diagnostic = <Tag extends string, Fields extends Schema.Struct.Fields>(
  tag: Tag,
  fields: Fields,
) =>
  Schema.Struct({
    _tag: Schema.Literal(tag),
    severity: ImportCenterDiagnosticSeveritySchema,
    path: Schema.String,
    message: Schema.String,
    ...fields,
  });

/** Exact runtime counterpart of the canonical ParseDiagnostic tagged union. */
export const ParseDiagnosticSchema = Schema.Union([
  diagnostic('MissingAtlas', { atlasAssetId: Schema.String }),
  diagnostic('InvalidCellSize', { width: Schema.Number, height: Schema.Number }),
  diagnostic('UnknownAutotilePattern', { pattern: Schema.String }),
  diagnostic('VariantWeightOutOfRange', {
    filterId: Schema.String,
    weightIndex: Schema.Number,
    weight: Schema.Number,
  }),
  diagnostic('AnimationFrameOutOfBounds', {
    animationId: Schema.String,
    frameIndex: Schema.Number,
  }),
  diagnostic('DuplicateTileId', { tileId: Schema.String }),
  diagnostic('CollisionMaskSizeMismatch', {
    tileId: Schema.String,
    expected: Schema.Number,
    actual: Schema.Number,
  }),
  diagnostic('InvalidCollisionVertex', {
    tileId: Schema.String,
    axis: Schema.Literals(['x1', 'y1', 'x2', 'y2']),
    value: Schema.Number,
    max: Schema.Number,
  }),
  diagnostic('InvalidUvRect', {
    x: Schema.Number,
    y: Schema.Number,
    w: Schema.Number,
    h: Schema.Number,
  }),
  diagnostic('InvalidMarginSpacing', { margin: Schema.Number, spacing: Schema.Number }),
  diagnostic('DuplicateAutotileRuleId', { ruleId: Schema.String }),
  diagnostic('VariantWeightCountMismatch', {
    filterId: Schema.String,
    tileCount: Schema.Number,
    weightCount: Schema.Number,
  }),
  diagnostic('InvalidAtlasGrid', {
    imageWidth: Schema.Number,
    imageHeight: Schema.Number,
    cellWidth: Schema.Number,
    cellHeight: Schema.Number,
    margin: Schema.Number,
    spacing: Schema.Number,
    columns: Schema.Number,
    rows: Schema.Number,
  }),
  diagnostic('InvalidPngImage', {
    width: Schema.optionalKey(Schema.Number),
    height: Schema.optionalKey(Schema.Number),
  }),
  diagnostic('EmptyVariantSelection', { filterId: Schema.String }),
  diagnostic('TiledExternalRefBlocked', { source: Schema.String, resolvedPath: Schema.String }),
  diagnostic('TiledUnsupportedCompression', {
    layerName: Schema.String,
    compression: Schema.String,
  }),
  diagnostic('TiledParseError', { format: Schema.Literals(['tmj', 'tmx', 'tsj', 'tsx']) }),
  diagnostic('TiledUnsupportedFeature', { feature: Schema.String }),
  diagnostic('TiledAmbiguousAtlasObject', {
    tilesetName: Schema.String,
    localTileId: Schema.Number,
    objectId: Schema.optionalKey(Schema.Number),
  }),
  diagnostic('MissingTerrainClassRef', { terrainClass: Schema.String }),
  diagnostic('MissingTransitionRule', { fromClass: Schema.String, toClass: Schema.String }),
  diagnostic('InvalidManifestField', {}),
  diagnostic('LdtkUnmappedAutoRule', {
    ruleUid: Schema.Number,
    layerUid: Schema.Number,
    reason: Schema.String,
  }),
  diagnostic('LdtkExternalLevelMissing', { externalRelPath: Schema.String }),
  diagnostic('LdtkExternalRefBlocked', {
    externalRelPath: Schema.String,
    resolvedPath: Schema.String,
  }),
  diagnostic('LdtkInvalidProject', {}),
  diagnostic('UnknownRpgmSetKind', { set: Schema.String }),
  diagnostic('MalformedAutotileLayout', {
    pattern: Schema.String,
    expectedCells: Schema.Number,
    actualCells: Schema.Number,
  }),
  diagnostic('TiledSourceWallRuleUnmapped', { rulePath: Schema.String, reason: Schema.String }),
  diagnostic('TiledSourceMissingImageRef', { imagePath: Schema.String, sourcePath: Schema.String }),
  diagnostic('TiledSourceTsxParseError', { sourcePath: Schema.String }),
  diagnostic('TiledSourceMetadataCompileError', {
    sourcePath: Schema.String,
    localTileId: Schema.Number,
  }),
]);

export const ImportCenterDiagnosticSchema = ParseDiagnosticSchema;

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
  source: Schema.optionalKey(Schema.String),
});

export const TiledImportImageAssetPreviewSchema = Schema.Struct({
  path: Schema.String,
  tilesetName: Schema.String,
  localTileId: Schema.optionalKey(Schema.Number),
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
  image: Schema.optionalKey(Schema.String),
  width: Schema.Number,
  height: Schema.Number,
  category: Schema.optionalKey(Schema.String),
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
  objectId: Schema.optionalKey(Schema.Number),
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
  tilesetName: Schema.optionalKey(Schema.String),
  layerName: Schema.optionalKey(Schema.String),
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

export const TilesetFrameIndexSchema = Schema.Struct({
  tilesetName: Schema.String,
  tilesetPath: Schema.optionalKey(Schema.String),
  localTileId: Schema.Number,
  image: Schema.optionalKey(Schema.String),
  probability: Schema.optionalKey(Schema.Number),
  animationFrameCount: Schema.Number,
  collisionObjectCount: Schema.Number,
  wangSetNames: Schema.Array(Schema.String),
});

export const TiledSourceInventoryTilesetSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(['grid', 'image-collection']),
  tileCount: Schema.Number,
  frameCount: Schema.Number,
  imageCollectionTileCount: Schema.Number,
  wangSetCount: Schema.Number,
  animationCount: Schema.Number,
  animationFrameCount: Schema.Number,
  tileProbabilityCount: Schema.Number,
  wangColorProbabilityCount: Schema.Number,
  collisionObjectCount: Schema.Number,
});

export const TiledSourceInventoryRuleSchema = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(['rules-index', 'rule-map']),
});

/** Complete runtime counterpart of TiledSourceInventory. */
export const TiledSourceInventorySchema = Schema.Struct({
  summary: Schema.Struct({
    tilesetCount: Schema.Number,
    tileCount: Schema.Number,
    frameCount: Schema.Number,
    imageCollectionTileCount: Schema.Number,
    wangSetCount: Schema.Number,
    animationCount: Schema.Number,
    animationFrameCount: Schema.Number,
    tileProbabilityCount: Schema.Number,
    wangColorProbabilityCount: Schema.Number,
    collisionObjectCount: Schema.Number,
    ruleMapCount: Schema.Number,
    rulesIndexCount: Schema.Number,
    exampleMapCount: Schema.Number,
  }),
  tilesets: Schema.Array(TiledSourceInventoryTilesetSchema),
  frames: Schema.Array(TilesetFrameIndexSchema),
  rules: Schema.Array(TiledSourceInventoryRuleSchema),
  exampleMaps: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      width: Schema.Number,
      height: Schema.Number,
      tileWidth: Schema.Number,
      tileHeight: Schema.Number,
    }),
  ),
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
  sourceInventory: Schema.optionalKey(TiledSourceInventorySchema),
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

type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type Assert<Condition extends true> = Condition;

/** Compile-time drift guards between canonical SDK types and runtime schemas. */
export type ParseDiagnosticSchemaParity = Assert<
  Equal<typeof ParseDiagnosticSchema.Type, ParseDiagnostic>
>;
export type TiledSourceInventorySchemaParity = Assert<
  Equal<typeof TiledSourceInventorySchema.Type, TiledSourceInventory>
>;
export type TiledImportScanSchemaParity = Assert<
  Equal<typeof TiledImportScanSchema.Type, TiledImportScan>
>;
export type TiledAppliedImportPlanSchemaParity = Assert<
  Equal<typeof TiledAppliedImportPlanSchema.Type, TiledAppliedImportPlan>
>;

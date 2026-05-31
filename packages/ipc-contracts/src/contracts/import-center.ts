import { MapId, PackId, ProjectId } from '@tileborne/core';
import { Schema } from 'effect';

export const ImportRecordId = Schema.String.check(Schema.isPattern(/^import:[0-9a-f-]{36}$/));
export type ImportRecordId = typeof ImportRecordId.Type;

export const ImportCenterSourceKind = Schema.Literals([
  'tileborne-pack',
  'tiled-map',
  'tiled-tileset',
  'tiled-source-folder',
  'raw-source-folder',
]);
export type ImportCenterSourceKind = typeof ImportCenterSourceKind.Type;

export const ImportCenterDiagnosticSeverity = Schema.Literals(['error', 'warning', 'info']);
export const ImportCenterDiagnostic = Schema.Struct({
  _tag: Schema.String,
  severity: ImportCenterDiagnosticSeverity,
  path: Schema.String,
  message: Schema.String,
  feature: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
});
export type ImportCenterDiagnostic = typeof ImportCenterDiagnostic.Type;

export const TiledScanSourceKind = Schema.Literals(['map', 'tileset', 'source-folder']);
export type TiledScanSourceKind = typeof TiledScanSourceKind.Type;

export const TiledImportScanInventory = Schema.Struct({
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
export const TiledImportInventoryPreview = Schema.Struct({
  ...TiledImportScanInventory.fields,
  imageAssetCount: Schema.Number,
});
export type TiledImportInventoryPreview = typeof TiledImportInventoryPreview.Type;

export const TiledImportScanMapPreview = Schema.Struct({
  path: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  tileWidth: Schema.Number,
  tileHeight: Schema.Number,
});

export const TiledImportScanTilesetPreview = Schema.Struct({
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

export const TiledImportImageAssetPreview = Schema.Struct({
  path: Schema.String,
  tilesetName: Schema.String,
  localTileId: Schema.optional(Schema.Number),
});

export const TiledImportObjectLayerPreview = Schema.Struct({
  name: Schema.String,
  objectCount: Schema.Number,
  gidObjectCount: Schema.Number,
  categories: Schema.Array(Schema.String),
  confidence: Schema.Number,
});

export const TiledImportPlaceablePreview = Schema.Struct({
  tilesetName: Schema.String,
  localTileId: Schema.Number,
  source: Schema.Literals(['image-collection', 'tileborne-hint']),
  image: Schema.optional(Schema.String),
  width: Schema.Number,
  height: Schema.Number,
  category: Schema.optional(Schema.String),
  confidence: Schema.Number,
});

export const TiledImportCategoryPreview = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  source: Schema.Literals(['class', 'type', 'property', 'tileborne-hint']),
  count: Schema.Number,
  confidence: Schema.Number,
});

export const TiledImportFeatureFlags = Schema.Struct({
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

export const TiledImportUnsupportedFeatureId = Schema.Literals([
  'templates',
  'infinite-chunks',
  'rotation',
  'parallax',
  'orientation',
  'class-properties',
  'project-files',
]);

export const TiledImportUnsupportedFeature = Schema.Struct({
  feature: TiledImportUnsupportedFeatureId,
  path: Schema.String,
  message: Schema.String,
  action: Schema.String,
});

export const TiledImportAmbiguousAtlasObject = Schema.Struct({
  tilesetName: Schema.String,
  localTileId: Schema.Number,
  objectId: Schema.optional(Schema.Number),
  path: Schema.String,
  message: Schema.String,
});

export const TiledImportRecommendedProfile = Schema.Union([
  Schema.Literal('standard'),
  Schema.Literal('standard-plus-hints'),
  Schema.Literal('assistive-infer'),
  Schema.Literal('plugin-required'),
  Schema.Struct({
    kind: Schema.Literal('plugin'),
    id: Schema.String,
  }),
]);

export const TiledImportSourceRoleKind = Schema.Literals([
  'paintable-tileset',
  'placeable-object',
  'map-context',
  'review-required',
]);

export const TiledImportSourceRoleEvidence = Schema.Literals([
  'grid-tileset',
  'image-collection',
  'tileborne-placeable-hint',
  'object-layer',
  'ambiguous-atlas-object',
  'unsupported-feature',
]);

export const TiledImportBrowseTarget = Schema.Literals(['tilesets', 'objects', 'maps', 'review']);

export const TiledImportSourceRole = Schema.Struct({
  kind: TiledImportSourceRoleKind,
  evidence: TiledImportSourceRoleEvidence,
  confidence: Schema.Number,
  count: Schema.Number,
  tilesetName: Schema.optional(Schema.String),
  layerName: Schema.optional(Schema.String),
  browseTarget: TiledImportBrowseTarget,
  reviewRequired: Schema.Boolean,
  rationale: Schema.String,
});

export const TiledImportPrimaryAction = Schema.Literals([
  'import-paintable-tilesets',
  'import-placeable-objects',
  'import-mixed-assets',
  'review-before-import',
  'choose-plugin-profile',
]);

export const TiledImportRecommendation = Schema.Struct({
  sourceRoles: Schema.Array(TiledImportSourceRole),
  recommendedProfile: TiledImportRecommendedProfile,
  primaryAction: TiledImportPrimaryAction,
  browseTarget: TiledImportBrowseTarget,
  rationale: Schema.String,
  reviewRequired: Schema.Boolean,
});
export type TiledImportRecommendation = typeof TiledImportRecommendation.Type;

export const TiledImportScan = Schema.Struct({
  sourceKind: TiledScanSourceKind,
  sourcePath: Schema.String,
  maps: Schema.Array(TiledImportScanMapPreview),
  tilesets: Schema.Array(TiledImportScanTilesetPreview),
  imageAssets: Schema.Array(TiledImportImageAssetPreview),
  objectLayers: Schema.Array(TiledImportObjectLayerPreview),
  placeableCandidates: Schema.Array(TiledImportPlaceablePreview),
  categories: Schema.Array(TiledImportCategoryPreview),
  inventory: TiledImportScanInventory,
  confidence: Schema.Number,
  featureFlags: TiledImportFeatureFlags,
  unsupportedFeatures: Schema.Array(TiledImportUnsupportedFeature),
  ambiguousAtlasObjects: Schema.Array(TiledImportAmbiguousAtlasObject),
  recommendedProfile: TiledImportRecommendedProfile,
  sourceRoles: Schema.Array(TiledImportSourceRole),
  importRecommendation: TiledImportRecommendation,
});
export type TiledImportScan = typeof TiledImportScan.Type;

export const TiledImportPlanSuggestion = Schema.Struct({
  id: Schema.String,
  block: Schema.Literals(['tileset', 'placeable', 'category', 'object-layer']),
  target: Schema.String,
  action: Schema.String,
  reason: Schema.String,
  confidence: Schema.Number,
  source: Schema.Literal('assistive-infer'),
});
export type TiledImportPlanSuggestion = typeof TiledImportPlanSuggestion.Type;

export const TiledImportPlanMapping = Schema.Struct({
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
  categories: Schema.Array(TiledImportCategoryPreview),
  placeables: Schema.Array(TiledImportPlaceablePreview),
  maps: Schema.Array(TiledImportScanMapPreview),
});

export const TiledImportPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sourcePath: Schema.String,
  profile: TiledImportRecommendedProfile,
  scan: TiledImportScan,
  importRecommendation: TiledImportRecommendation,
  mappings: TiledImportPlanMapping,
  suggestions: Schema.Array(TiledImportPlanSuggestion),
  acceptedSuggestionIds: Schema.Array(Schema.String),
  diagnostics: Schema.Array(ImportCenterDiagnostic),
});
export type TiledImportPlan = typeof TiledImportPlan.Type;

export const TiledAppliedImportPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sourcePath: Schema.String,
  profile: TiledImportRecommendedProfile,
  selectedMapPath: Schema.String,
  scan: TiledImportScan,
  importRecommendation: TiledImportRecommendation,
  mappings: TiledImportPlanMapping,
  acceptedSuggestions: Schema.Array(TiledImportPlanSuggestion),
  diagnostics: Schema.Array(ImportCenterDiagnostic),
});
export type TiledAppliedImportPlan = typeof TiledAppliedImportPlan.Type;

export const ImportCenterSourceIdentity = Schema.Struct({
  kind: ImportCenterSourceKind,
  path: Schema.String,
  detectedAt: Schema.String,
  fingerprint: Schema.optional(
    Schema.Struct({
      realPath: Schema.String,
      size: Schema.Number,
      mtimeMs: Schema.Number,
      isDirectory: Schema.Boolean,
    }),
  ),
});
export type ImportCenterSourceIdentity = typeof ImportCenterSourceIdentity.Type;

export const ImportCenterApplyReport = Schema.Struct({
  importRecordId: ImportRecordId,
  sourceIdentity: ImportCenterSourceIdentity,
  diagnostics: Schema.Array(ImportCenterDiagnostic),
  appliedPlan: TiledAppliedImportPlan,
  outputs: Schema.Struct({
    kind: Schema.Literals(['map', 'asset-pack']),
    mapId: Schema.optional(MapId),
    packId: Schema.optional(PackId),
    layerCount: Schema.optional(Schema.Number),
    objectCount: Schema.optional(Schema.Number),
  }),
});
export type ImportCenterApplyReport = typeof ImportCenterApplyReport.Type;

export const ImportRecord = Schema.Struct({
  id: ImportRecordId,
  projectId: ProjectId,
  createdAt: Schema.String,
  sourceIdentity: ImportCenterSourceIdentity,
  appliedPlan: TiledAppliedImportPlan,
  report: ImportCenterApplyReport,
});
export type ImportRecord = typeof ImportRecord.Type;

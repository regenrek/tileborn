import { Schema } from 'effect';

import {
  ContentHash,
  PackId,
  ProjectId,
  TileId,
  WorkingPaletteId,
  WorkingPaletteItemId,
} from '../ids.js';

export const AssetLibraryReferenceKind = Schema.Literals([
  'tile',
  'autotile',
  'terrain',
  'placeable',
]);
export type AssetLibraryReferenceKind = typeof AssetLibraryReferenceKind.Type;

export class AssetPackProvenance extends Schema.Class<AssetPackProvenance>('AssetPackProvenance')({
  source: Schema.Literal('tiled'),
  folderHash: ContentHash,
  importedAt: Schema.String,
}) {}

export class AssetPackLicense extends Schema.Class<AssetPackLicense>('AssetPackLicense')({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  attribution: Schema.optional(Schema.String),
  redistributable: Schema.Boolean,
}) {}

export class AssetLibraryReference extends Schema.Class<AssetLibraryReference>(
  'AssetLibraryReference',
)({
  packId: PackId,
  kind: AssetLibraryReferenceKind,
  refId: Schema.String,
  tileId: Schema.optional(TileId),
  thumbnailCacheKey: Schema.optional(Schema.String),
  thumbnailUrl: Schema.optional(Schema.String),
}) {}

export const AssetLibraryGroupKind = Schema.Literals([
  'tileset',
  'terrain',
  'autotile',
  'placeable',
  'placeable-category',
  'source',
  'tag',
]);
export type AssetLibraryGroupKind = typeof AssetLibraryGroupKind.Type;

export class AssetLibraryGroup extends Schema.Class<AssetLibraryGroup>('AssetLibraryGroup')({
  id: Schema.String,
  packId: PackId,
  kind: AssetLibraryGroupKind,
  label: Schema.String,
  count: Schema.Number,
  metadata: Schema.Record(Schema.String, Schema.String),
  searchText: Schema.String,
  primaryRef: Schema.optional(AssetLibraryReference),
  previewRefs: Schema.Array(AssetLibraryReference),
}) {}

export class AssetLibraryIndex extends Schema.Class<AssetLibraryIndex>('AssetLibraryIndex')({
  packId: PackId,
  totalGroups: Schema.Number,
  groups: Schema.Array(AssetLibraryGroup),
}) {}

export const AssetLibraryCacheState = Schema.Literals([
  'cold',
  'cached',
  'stale',
  'building',
  'error',
]);
export type AssetLibraryCacheState = typeof AssetLibraryCacheState.Type;

export class AssetLibraryCacheStatus extends Schema.Class<AssetLibraryCacheStatus>(
  'AssetLibraryCacheStatus',
)({
  packId: PackId,
  integrityHash: Schema.optional(ContentHash),
  indexSchemaVersion: Schema.Number,
  state: AssetLibraryCacheState,
  cacheKind: Schema.Literal('index-metadata'),
  groupCount: Schema.Number,
  previewRefCount: Schema.Number,
  thumbnailSheetCount: Schema.Number,
  thumbnailSheetsAvailable: Schema.Boolean,
  updatedAt: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
}) {}

export class WorkingPaletteItem extends Schema.Class<WorkingPaletteItem>('WorkingPaletteItem')({
  id: WorkingPaletteItemId,
  ref: AssetLibraryReference,
  label: Schema.String,
}) {}

export class WorkingPalette extends Schema.Class<WorkingPalette>('WorkingPalette')({
  id: WorkingPaletteId,
  projectId: ProjectId,
  name: Schema.String,
  items: Schema.Array(WorkingPaletteItem),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}

export class WorkingPaletteStore extends Schema.Class<WorkingPaletteStore>('WorkingPaletteStore')({
  schemaVersion: Schema.Literal(1),
  projectId: ProjectId,
  activePaletteId: Schema.optional(WorkingPaletteId),
  palettes: Schema.Array(WorkingPalette),
}) {}

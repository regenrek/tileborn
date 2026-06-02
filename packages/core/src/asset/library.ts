import { Schema } from 'effect';

import {
  ClipId,
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
  'sprite',
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
  /** Default animation clip for sprite references; placement pins this clip. */
  clipId: Schema.optional(ClipId),
  thumbnailCacheKey: Schema.optional(Schema.String),
  thumbnailUrl: Schema.optional(Schema.String),
}) {}

/**
 * Reusable, game-mode-agnostic reference to a renderable player avatar: a
 * sprite/placeable asset-library reference plus the clip to play and the
 * normalized pivot to render it at. This is the shared TYPE only — the policy
 * for whether a mode uses a fixed model or a selectable set lives in a
 * `@tileborne/plugin-api` contribution, and resolution into a RenderableEntity
 * lives in the runtime projector (see ADR-candidate, context c-l3l6).
 */
export class PlayerModelAnchor extends Schema.Class<PlayerModelAnchor>('PlayerModelAnchor')({
  /** Normalized pivot x (0..1, origin top-left). */
  x: Schema.Number,
  /** Normalized pivot y (0..1, origin top-left). */
  y: Schema.Number,
}) {}

/** Asset-library reference kinds that can back a player model (renderable sprites). */
export const PlayerModelRefableKinds = ['sprite', 'placeable'] as const;

export class PlayerModelRef extends Schema.Class<PlayerModelRef>('PlayerModelRef')({
  /** Stable selection id (used by rosters, lobby picks, and wire snapshots). */
  id: Schema.String,
  /** Human-facing label shown in pickers. */
  label: Schema.String,
  /** Underlying sprite/placeable reference (kind must be 'sprite' or 'placeable'). */
  ref: AssetLibraryReference,
  /** Animation clip to play; falls back to `ref.clipId` when omitted. */
  defaultClipId: Schema.optional(ClipId),
  /** Normalized pivot (0..1, origin top-left). */
  anchor: PlayerModelAnchor,
}) {}

/** True when an asset-library reference kind can be promoted to a player model. */
export const isPlayerModelRefable = (kind: AssetLibraryReferenceKind): boolean =>
  (PlayerModelRefableKinds as readonly string[]).includes(kind);

/** Resolve the effective clip id for a player model (explicit default, else ref clip). */
export const resolvePlayerModelClipId = (model: PlayerModelRef): ClipId | undefined =>
  model.defaultClipId ?? model.ref.clipId;

export const AssetLibraryGroupKind = Schema.Literals([
  'tileset',
  'terrain',
  'autotile',
  'placeable',
  'placeable-category',
  'sprite',
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

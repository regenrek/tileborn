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

export const REQUIRED_PLAYER_MODEL_CLIP_KEYS = [
  'idle',
  'walk',
  'run',
  'shoot',
  'reload',
  'hit',
  'death',
  'dash',
  'pickup',
] as const;

export type PlayerModelClipKey = (typeof REQUIRED_PLAYER_MODEL_CLIP_KEYS)[number];

export class PlayerModelClipSet extends Schema.Class<PlayerModelClipSet>('PlayerModelClipSet')({
  idle: ClipId,
  walk: ClipId,
  run: ClipId,
  shoot: ClipId,
  reload: ClipId,
  hit: ClipId,
  death: ClipId,
  dash: ClipId,
  pickup: ClipId,
}) {}

/**
 * Normalized rectangle in sprite-local space (0..1, origin top-left). Runtime
 * slices convert this to pixels once concrete frame dimensions are known.
 */
export class PlayerModelHitbox extends Schema.Class<PlayerModelHitbox>('PlayerModelHitbox')({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
}) {}

/** Normalized sprite-local point used for projectile/effect spawn origins. */
export class PlayerModelPoint extends Schema.Class<PlayerModelPoint>('PlayerModelPoint')({
  x: Schema.Number,
  y: Schema.Number,
}) {}

/** Sprite-independent world footprint used by renderers to size model frames. */
export class PlayerModelWorldSize extends Schema.Class<PlayerModelWorldSize>(
  'PlayerModelWorldSize',
)({
  width: Schema.Number,
  height: Schema.Number,
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
  /** Animation clip to play; falls back to `ref.clipId`, then the required idle clip. */
  defaultClipId: Schema.optional(ClipId),
  /** Required production animation clips by semantic action/state. */
  clips: PlayerModelClipSet,
  /** Normalized pivot (0..1, origin top-left). */
  anchor: PlayerModelAnchor,
  /** Normalized collision/damage hitbox in sprite-local coordinates. */
  hitbox: PlayerModelHitbox,
  /** Normalized muzzle origin used by shooter runtime/effects. */
  muzzle: PlayerModelPoint,
  /** Optional authored render multiplier. When omitted, pack/import defaults may apply. */
  renderScale: Schema.optional(Schema.Number),
  /** Optional authored world footprint in runtime world units. */
  worldSize: Schema.optional(PlayerModelWorldSize),
}) {}

/** True when an asset-library reference kind can be promoted to a player model. */
export const isPlayerModelRefable = (kind: AssetLibraryReferenceKind): boolean =>
  (PlayerModelRefableKinds as readonly string[]).includes(kind);

/** Resolve the effective clip id for a player model (explicit default, ref clip, else idle). */
export const resolvePlayerModelClipId = (model: PlayerModelRef): ClipId | undefined =>
  model.defaultClipId ?? model.ref.clipId ?? model.clips.idle;

export interface PlayerModelValidationIssue {
  readonly path: string;
  readonly message: string;
}

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const normalizedPointIssues = (
  path: string,
  point: { readonly x: number; readonly y: number },
): readonly PlayerModelValidationIssue[] => {
  const issues: PlayerModelValidationIssue[] = [];
  if (!isFiniteNumber(point.x) || point.x < 0 || point.x > 1) {
    issues.push({ path: `${path}.x`, message: 'must be a finite number between 0 and 1' });
  }
  if (!isFiniteNumber(point.y) || point.y < 0 || point.y > 1) {
    issues.push({ path: `${path}.y`, message: 'must be a finite number between 0 and 1' });
  }
  return issues;
};

const normalizedHitboxIssues = (
  path: string,
  hitbox: PlayerModelHitbox,
): readonly PlayerModelValidationIssue[] => {
  const issues: PlayerModelValidationIssue[] = [];
  issues.push(...normalizedPointIssues(path, hitbox));
  if (!isFiniteNumber(hitbox.width) || hitbox.width <= 0 || hitbox.width > 1) {
    issues.push({ path: `${path}.width`, message: 'must be a finite number greater than 0 and at most 1' });
  }
  if (!isFiniteNumber(hitbox.height) || hitbox.height <= 0 || hitbox.height > 1) {
    issues.push({ path: `${path}.height`, message: 'must be a finite number greater than 0 and at most 1' });
  }
  if (isFiniteNumber(hitbox.x) && isFiniteNumber(hitbox.width) && hitbox.x + hitbox.width > 1) {
    issues.push({ path, message: 'x + width must not exceed 1' });
  }
  if (isFiniteNumber(hitbox.y) && isFiniteNumber(hitbox.height) && hitbox.y + hitbox.height > 1) {
    issues.push({ path, message: 'y + height must not exceed 1' });
  }
  return issues;
};

/** Validate production player-model invariants that are semantic, not just shape. */
export const validatePlayerModelRef = (
  model: PlayerModelRef,
): readonly PlayerModelValidationIssue[] => {
  const issues: PlayerModelValidationIssue[] = [];
  if (model.id.trim().length === 0) {
    issues.push({ path: 'id', message: 'must not be empty' });
  }
  if (model.label.trim().length === 0) {
    issues.push({ path: 'label', message: 'must not be empty' });
  }
  if (!isPlayerModelRefable(model.ref.kind)) {
    issues.push({ path: 'ref.kind', message: 'must be sprite or placeable' });
  }
  issues.push(...normalizedPointIssues('anchor', model.anchor));
  issues.push(...normalizedPointIssues('muzzle', model.muzzle));
  issues.push(...normalizedHitboxIssues('hitbox', model.hitbox));
  if (
    model.renderScale !== undefined &&
    (!isFiniteNumber(model.renderScale) || model.renderScale <= 0)
  ) {
    issues.push({ path: 'renderScale', message: 'must be a finite number greater than 0' });
  }
  if (model.worldSize !== undefined) {
    if (!isFiniteNumber(model.worldSize.width) || model.worldSize.width <= 0) {
      issues.push({ path: 'worldSize.width', message: 'must be a finite number greater than 0' });
    }
    if (!isFiniteNumber(model.worldSize.height) || model.worldSize.height <= 0) {
      issues.push({ path: 'worldSize.height', message: 'must be a finite number greater than 0' });
    }
  }

  const allowedClipIds = new Set(
    REQUIRED_PLAYER_MODEL_CLIP_KEYS.map((key) => String(model.clips[key])),
  );
  if (model.ref.clipId !== undefined && !allowedClipIds.has(String(model.ref.clipId))) {
    issues.push({
      path: 'ref.clipId',
      message: 'must reference one of the required player-model clips',
    });
  }
  if (model.defaultClipId !== undefined && !allowedClipIds.has(String(model.defaultClipId))) {
    issues.push({
      path: 'defaultClipId',
      message: 'must reference one of the required player-model clips',
    });
  }
  return issues;
};

export const isValidPlayerModelRef = (model: PlayerModelRef): boolean =>
  validatePlayerModelRef(model).length === 0;

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

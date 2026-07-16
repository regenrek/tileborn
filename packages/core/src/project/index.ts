import { Schema, SchemaGetter } from 'effect';

import { ContentHash, PackId, PluginId, ProjectId } from '../ids.js';
import { PERSISTED_SCHEMA_VERSIONS } from '../versioning/persisted-schema-registry.js';

export type JsonValue = null | boolean | number | string | JsonObject | ReadonlyArray<JsonValue>;

export type JsonObject = { readonly [key: string]: JsonValue };

/** Canonical project setting keys consumed by playtest/build/ship orchestration. */
export const PROJECT_STARTUP_MAP_SETTINGS_KEY = 'startupMapId';
export const PROJECT_SHIP_TARGET_SETTINGS_KEY = 'shipTarget';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    return false;
  }
  if (
    value === undefined ||
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((entry, index) => index in value && isJsonValue(entry));
  }
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.values(value).every((entry) => entry !== undefined && isJsonValue(entry));
};

const JsonValueCore = Schema.suspend((): Schema.Codec<JsonValue> => {
  const value = Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Finite,
    Schema.String,
    Schema.Record(Schema.String, JsonValue),
    Schema.Array(JsonValue),
  ]);
  return value as Schema.Codec<JsonValue>;
});

export const JsonValue = Schema.Unknown.pipe(
  Schema.decodeTo(JsonValueCore, {
    decode: SchemaGetter.transform((input: unknown) => {
      if (!isJsonValue(input)) {
        throw new Error('value is not a finite JSON value');
      }
      return input;
    }),
    encode: SchemaGetter.transform((value) => value),
  }),
);

export const JsonArray = Schema.Array(JsonValue);

export const JsonObject = Schema.Record(Schema.String, JsonValue) as Schema.Codec<JsonObject>;

/** Plugin dependency declared by a project manifest. */
export class ProjectPluginRef extends Schema.Class<ProjectPluginRef>('ProjectPluginRef')({
  id: PluginId,
  version: Schema.String,
}) {}

/** Asset pack dependency declared by a project manifest. */
export class ProjectAssetPackRef extends Schema.Class<ProjectAssetPackRef>('ProjectAssetPackRef')({
  id: Schema.String,
  version: Schema.String,
}) {}

/** Map entry inside a project manifest. */
export class ProjectMapRef extends Schema.Class<ProjectMapRef>('ProjectMapRef')({
  id: Schema.String,
  path: Schema.String,
}) {}

/**
 * Project manifest persisted under `~/.tileborne/projects/<id>/`.
 * Shape follows spec §10.
 */
export class ProjectManifest extends Schema.Class<ProjectManifest>('ProjectManifest')({
  id: ProjectId,
  name: Schema.String,
  schemaVersion: Schema.Literal(PERSISTED_SCHEMA_VERSIONS.projectManifest),
  engineVersion: Schema.String,
  plugins: Schema.Array(ProjectPluginRef),
  assetPacks: Schema.Array(ProjectAssetPackRef),
  maps: Schema.Array(ProjectMapRef),
  /**
   * Project-level settings bag for game-mode authoring that is shared across all
   * of the project's maps (e.g. the Battle Royale per-project player-model
   * roster). Optional for back-compat with manifests written before this field.
   */
  settings: Schema.optional(JsonObject),
}) {}

/**
 * Identity slice of an on-disk asset pack manifest (spec §9).
 * Full asset lists and license validation live in `@tileborne/asset-pipeline`.
 */
export class AssetPackManifestSummary extends Schema.Class<AssetPackManifestSummary>(
  'AssetPackManifestSummary',
)({
  id: Schema.String,
  version: Schema.String,
  displayName: Schema.String,
  kind: Schema.Literal('pack'),
  contentHash: ContentHash,
  schemaVersion: Schema.Literal(1),
}) {}

/**
 * Brand splash + lobby copy injected by product repos (runtime spec §5.1).
 * Logo and legal fields are product-specific extensions outside this summary.
 */
export class BrandConfigSummary extends Schema.Class<BrandConfigSummary>('BrandConfigSummary')({
  title: Schema.String,
  schemaVersion: Schema.Literal(1),
  palette: Schema.Record(Schema.String, Schema.String),
  lobbyCopy: Schema.Struct({
    tagline: Schema.String,
    cta: Schema.String,
  }),
}) {}

export const ProjectManifestSchema = ProjectManifest;
export const AssetPackManifestSummarySchema = AssetPackManifestSummary;
export const BrandConfigSummarySchema = BrandConfigSummary;

/** Convenience factory for tests and fixtures. */
export const makeProjectManifest = (input: {
  id: ProjectId;
  name: string;
  engineVersion?: string;
  plugins?: readonly ProjectPluginRef[];
  assetPacks?: readonly ProjectAssetPackRef[];
  maps?: readonly ProjectMapRef[];
  settings?: JsonObject;
}): ProjectManifest =>
  new ProjectManifest({
    id: input.id,
    name: input.name,
    schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectManifest,
    engineVersion: input.engineVersion ?? '0.1.0',
    plugins: [...(input.plugins ?? [])],
    assetPacks: [...(input.assetPacks ?? [])],
    maps: [...(input.maps ?? [])],
    ...(input.settings === undefined ? {} : { settings: input.settings }),
  });

export const makeAssetPackManifestSummary = (input: {
  id: string;
  version: string;
  displayName: string;
  contentHash: ContentHash;
}): AssetPackManifestSummary =>
  new AssetPackManifestSummary({
    id: input.id,
    version: input.version,
    displayName: input.displayName,
    kind: 'pack',
    contentHash: input.contentHash,
    schemaVersion: 1,
  });

export { PackId };

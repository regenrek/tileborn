import { ContentHash, GameObjectCatalog, PluginId } from "@tileborne/core";
import { MAX_PACK_BYTES } from "@tileborne/asset-pipeline";
import { PluginContributions, PluginManifest, WeaponCatalog } from "@tileborne/plugin-api";
import { Schema } from "effect";

export const PLUGIN_MANIFEST_FILE = "tileborne-plugin.json";
export const PLUGIN_LOCK_FILE = "lock.json";
export const MAX_PLUGIN_BYTES = Math.min(MAX_PACK_BYTES, 100 * 1024 * 1024);
export const MAX_PLUGIN_FILES = 10_000;

export class NpmPluginSource extends Schema.TaggedClass<NpmPluginSource>()("npm", {
  packageName: Schema.String,
  version: Schema.OptionFromOptional(Schema.String),
}) {}

export class LocalPluginSource extends Schema.TaggedClass<LocalPluginSource>()("local", {
  path: Schema.String,
}) {}

export class TarballPluginSource extends Schema.TaggedClass<TarballPluginSource>()("tarball", {
  url: Schema.String,
  integrity: Schema.OptionFromOptional(ContentHash),
}) {}

export class GitPluginSource extends Schema.TaggedClass<GitPluginSource>()("git", {
  repo: Schema.String,
  ref: Schema.OptionFromOptional(Schema.String),
}) {}

export class DevSymlinkPluginSource extends Schema.TaggedClass<DevSymlinkPluginSource>()("dev-symlink", {
  linkPath: Schema.String,
}) {}

export const PluginSource = Schema.Union([
  NpmPluginSource,
  LocalPluginSource,
  TarballPluginSource,
  GitPluginSource,
  DevSymlinkPluginSource,
]);
export type PluginSource = Schema.Schema.Type<typeof PluginSource>;

export const PluginProcessKind = Schema.Literals(["main", "renderer", "cli"]);
export type PluginProcessKind = Schema.Schema.Type<typeof PluginProcessKind>;

export class PluginExecutionContext extends Schema.Class<PluginExecutionContext>("PluginExecutionContext")({
  processKind: PluginProcessKind,
  allowedInRenderer: Schema.Boolean,
}) {}

export class InstalledPlugin extends Schema.Class<InstalledPlugin>("InstalledPlugin")({
  id: PluginId,
  version: Schema.String,
  enabled: Schema.Boolean,
  rootPath: Schema.String,
  manifestPath: Schema.String,
  manifest: PluginManifest,
  integrity: ContentHash,
}) {}

export class PluginRegistrySnapshot extends Schema.Class<PluginRegistrySnapshot>("PluginRegistrySnapshot")({
  plugins: Schema.Array(InstalledPlugin),
}) {}

/**
 * A `gameObjectCatalogs` contribution after the loader has resolved its
 * `data.indexPath` (or inline data) and decoded it against the core
 * {@link GameObjectCatalog} schema (ADR-0019). Carried per-plugin on
 * {@link LoadedDeclarativePlugin}; cross-plugin merge into a runtime registry is
 * deferred to the runtime-map-package capstone.
 */
export class MaterializedGameObjectCatalog extends Schema.Class<MaterializedGameObjectCatalog>(
  "MaterializedGameObjectCatalog",
)({
  contributionId: Schema.String,
  catalog: GameObjectCatalog,
}) {}

/**
 * A `weaponCatalogs` contribution after the loader has resolved its
 * `data.indexPath` (or inline data) and decoded it against the
 * `@tileborne/simulation`-backed {@link WeaponCatalog} schema (ADR-0018 Slice 5).
 * Carried per-plugin on {@link LoadedDeclarativePlugin}; cross-plugin merge into a
 * runtime registry is performed via `mergeWeaponCatalogs`, mirroring
 * {@link MaterializedGameObjectCatalog} / ADR-0019.
 */
export class MaterializedWeaponCatalog extends Schema.Class<MaterializedWeaponCatalog>(
  "MaterializedWeaponCatalog",
)({
  contributionId: Schema.String,
  catalog: WeaponCatalog,
}) {}

export class LoadedDeclarativePlugin extends Schema.Class<LoadedDeclarativePlugin>("LoadedDeclarativePlugin")({
  pluginId: PluginId,
  manifest: PluginManifest,
  contributions: PluginContributions,
  /**
   * The plugin's `gameObjectCatalogs` resolved + decoded at load time (ADR-0019),
   * so consumers read materialized catalogs rather than raw `{ indexPath }`
   * indirection. Empty when the plugin contributes none.
   */
  gameObjectCatalogs: Schema.Array(MaterializedGameObjectCatalog),
  /**
   * The plugin's `weaponCatalogs` resolved + decoded at load time (ADR-0018
   * Slice 5), mirroring {@link MaterializedGameObjectCatalog}. Empty when the
   * plugin contributes none. Cross-plugin merge stays deferred to the caller
   * via `mergeWeaponCatalogs`.
   */
  weaponCatalogs: Schema.Array(MaterializedWeaponCatalog),
}) {}

export interface LoadedExecutablePlugin {
  readonly pluginId: PluginId;
  readonly manifest: PluginManifest;
  readonly module: unknown;
}

export class PluginNotFoundError extends Schema.TaggedErrorClass<PluginNotFoundError>()("PluginNotFoundError", {
  pluginId: PluginId,
  message: Schema.String,
}) {}

export class PluginResolveError extends Schema.TaggedErrorClass<PluginResolveError>()("PluginResolveError", {
  source: Schema.String,
  message: Schema.String,
}) {}

export class PluginValidationError extends Schema.TaggedErrorClass<PluginValidationError>()(
  "PluginValidationError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class PluginInstallError extends Schema.TaggedErrorClass<PluginInstallError>()("PluginInstallError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class PluginIntegrityError extends Schema.TaggedErrorClass<PluginIntegrityError>()("PluginIntegrityError", {
  path: Schema.String,
  pluginId: Schema.optionalKey(PluginId),
  expectedHash: Schema.optionalKey(ContentHash),
  actualHash: Schema.optionalKey(ContentHash),
  message: Schema.String,
}) {}

export class PluginExecutionForbiddenError extends Schema.TaggedErrorClass<PluginExecutionForbiddenError>()(
  "PluginExecutionForbiddenError",
  {
    pluginId: PluginId,
    processKind: PluginProcessKind,
    message: Schema.String,
  },
) {}

export type PluginRegistryError = PluginNotFoundError | PluginValidationError | PluginIntegrityError;
export type PluginInstallerError =
  | PluginResolveError
  | PluginValidationError
  | PluginInstallError
  | PluginIntegrityError;
export type PluginLoaderError =
  | PluginNotFoundError
  | PluginValidationError
  | PluginIntegrityError
  | PluginExecutionForbiddenError
  | PluginInstallError;

export class PluginVerifyResult extends Schema.Class<PluginVerifyResult>("PluginVerifyResult")({
  pluginId: PluginId,
  version: Schema.optionalKey(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
  ok: Schema.Boolean,
  integrity: Schema.optionalKey(ContentHash),
  message: Schema.optionalKey(Schema.String),
}) {}

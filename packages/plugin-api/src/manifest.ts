import { PluginId } from "@tileborne/core";
import { Schema } from "effect";

import { MigrationsTable, PluginContributions } from "./contributions.js";
import { PluginPermission } from "./permissions.js";
import { EntryPoints, PluginRef, SemverRangeString, SemverString } from "./primitives.js";

export class PluginEngines extends Schema.Class<PluginEngines>("PluginEngines")({
  tileborne: SemverRangeString,
}) {}

export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

export class PluginManifest extends Schema.Class<PluginManifest>("PluginManifest")({
  schemaVersion: Schema.Literal(PLUGIN_MANIFEST_SCHEMA_VERSION),
  id: PluginId,
  name: Schema.String,
  version: SemverString,
  displayName: Schema.String,
  description: Schema.String,
  author: Schema.String,
  license: Schema.String,
  engines: PluginEngines,
  repository: Schema.OptionFromUndefinedOr(Schema.String),
  homepage: Schema.OptionFromUndefinedOr(Schema.String),
  entry: Schema.OptionFromUndefinedOr(EntryPoints),
  contributes: PluginContributions,
  /** Order-insensitive permission declarations; hosts should dedupe before granting. */
  permissions: Schema.Array(PluginPermission),
  dependsOn: Schema.Array(PluginRef),
  migrations: Schema.OptionFromUndefinedOr(MigrationsTable),
}) {}

export const PluginManifestSchema = PluginManifest;


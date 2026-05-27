import { PluginId } from "@tileborne/core";
import { Schema } from "effect";

import { PluginManifest } from "./manifest.js";
import { PluginPermission } from "./permissions.js";
import { EntryPoints } from "./primitives.js";

export class ResolvedPlugin extends Schema.Class<ResolvedPlugin>("ResolvedPlugin")({
  manifest: PluginManifest,
  rootPath: Schema.String,
  manifestPath: Schema.String,
  resolvedEntry: EntryPoints,
  grantedPermissions: Schema.Array(PluginPermission),
}) {}

/**
 * Pure loader output keyed by plugin id. The loader service is implemented in a later slice.
 */
export class PluginRegistry extends Schema.Class<PluginRegistry>("PluginRegistry")({
  plugins: Schema.Record(Schema.String, ResolvedPlugin),
}) {}

export type PluginRegistryMap = Readonly<Record<PluginId, ResolvedPlugin>>;


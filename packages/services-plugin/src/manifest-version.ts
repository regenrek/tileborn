import { defineMigrationChain, readSchemaVersion } from "@tileborne/core";
import type { PluginManifest } from "@tileborne/plugin-api";
import { PLUGIN_MANIFEST_SCHEMA_VERSION } from "@tileborne/plugin-api";

export { PLUGIN_MANIFEST_SCHEMA_VERSION };

/** Canonical plugin manifest envelope version; v2+ migrators register here. */
export const pluginManifestMigrationChain = defineMigrationChain<PluginManifest>({
  entity: "pluginManifest",
  latestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
  migrators: [],
});

export const readPluginManifestSchemaVersion = (input: unknown): number | undefined =>
  readSchemaVersion(input);

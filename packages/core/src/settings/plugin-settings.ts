import { ProjectManifest } from "../project/index.js";
import type { JsonObject, JsonValue } from "../project/index.js";
import { TileborneMap } from "../map/index.js";

/**
 * Neutral, brand-free per-plugin settings namespace (ADR-0023 section A).
 *
 * Game-mode settings VALUES persist under a namespace keyed by the owning
 * plugin id — `map.properties.<pluginId>` for per-map settings and
 * `project.settings.<pluginId>` for per-project settings — NEVER under a
 * hardcoded mode/genre key. Any mode-specific top-level keys a plugin used
 * before this contract are folded into the namespaced object by that plugin's
 * own writer + load-time migration. The engine owns the namespace + read/write;
 * each plugin owns its field set + defaults + validation policy (declared as
 * data via the `EditorGameSettingsForm` contribution). This module deliberately
 * takes the `pluginId` as a parameter so the engine never enumerates a closed
 * mode name (forbidden-token boundary).
 */

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read the namespaced settings object out of a `properties`/`settings` bag.
 * Returns an empty object when absent or not an object so callers can read
 * fields with their own per-field fallbacks.
 */
export const readPluginSettingsNamespace = (
  bag: JsonObject | undefined,
  pluginId: string,
): JsonObject => {
  if (bag === undefined) {
    return {};
  }
  const value = bag[pluginId];
  return isJsonObject(value) ? value : {};
};

/**
 * Return a new `properties`/`settings` bag with the plugin's namespaced object
 * replaced by `value`. Other plugins' namespaces (and any non-namespaced keys)
 * are preserved untouched.
 */
export const writePluginSettingsNamespace = (
  bag: JsonObject | undefined,
  pluginId: string,
  value: JsonObject,
): JsonObject => ({
  ...(bag ?? {}),
  [pluginId]: value,
});

/** Read a map's per-plugin authoring settings from `map.properties.<pluginId>`. */
export const readPluginMapSettings = (map: TileborneMap, pluginId: string): JsonObject =>
  readPluginSettingsNamespace(map.properties, pluginId);

/**
 * Persist a map's per-plugin authoring settings under `map.properties.<pluginId>`,
 * returning a new {@link TileborneMap}. The plugin's own writer is responsible
 * for shaping `value`; this helper only owns the neutral namespace placement.
 */
export const writePluginMapSettings = (
  map: TileborneMap,
  pluginId: string,
  value: JsonObject,
): TileborneMap =>
  new TileborneMap({
    ...map,
    properties: writePluginSettingsNamespace(map.properties, pluginId, value),
  });

/** Read a project's per-plugin settings from `project.settings.<pluginId>`. */
export const readPluginProjectSettings = (
  project: ProjectManifest,
  pluginId: string,
): JsonObject => readPluginSettingsNamespace(project.settings, pluginId);

/**
 * Persist a project's per-plugin settings under `project.settings.<pluginId>`,
 * returning a new {@link ProjectManifest}.
 */
export const writePluginProjectSettings = (
  project: ProjectManifest,
  pluginId: string,
  value: JsonObject,
): ProjectManifest =>
  new ProjectManifest({
    ...project,
    settings: writePluginSettingsNamespace(project.settings, pluginId, value),
  });

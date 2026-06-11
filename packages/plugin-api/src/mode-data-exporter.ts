import {
  type JsonObject,
  type RuntimeCatalogEntry,
  type RuntimeObjectPlacement,
  type TileborneMap,
} from "@tileborne/core";
import { Result, Schema } from "effect";

/**
 * The narrowed game-mode exporter contract (ADR-0030 step 1).
 *
 * A game-mode plugin no longer owns a whole artifact format (the BR
 * `ExportedArtifact` precedent is hard-cut): at package assembly the ACTIVE
 * mode's exporter is handed the already-assembled NEUTRAL projections and
 * returns only its engine-opaque `modeData.<pluginId>` section (e.g. BR zone
 * schedule + loot config). The plugin schemas + validates that section itself;
 * the engine only guarantees it is well-formed JSON and content-hashed.
 * Neutral data (placements, spawn points, visuals) must NOT be duplicated into
 * the section (boundary-tested).
 */
export interface ModeDataExportContext {
  readonly map: TileborneMap;
  /** The merged runtime catalog (origin-tagged, precedence resolved). */
  readonly catalog: readonly RuntimeCatalogEntry[];
  /** Neutral component-driven placements projected from the map. */
  readonly placements: readonly RuntimeObjectPlacement[];
  /** The mode's own namespaced settings section (`map.properties.<pluginId>`). */
  readonly settings: JsonObject | undefined;
}

/** The active mode's exporter rejected the map/settings it was asked to package. */
export class ModeDataExportError extends Schema.TaggedErrorClass<ModeDataExportError>()(
  "ModeDataExportError",
  {
    pluginId: Schema.String,
    message: Schema.String,
  },
) {}

/** Produce the plugin's validated `modeData.<pluginId>` section. */
export type RuntimeModeDataExporter = (
  context: ModeDataExportContext,
) => Result.Result<JsonObject, ModeDataExportError>;

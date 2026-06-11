import { Schema } from "effect";

import { PlayerModelRef } from "../asset/library.js";
import { GameObjectType } from "../catalog/object-type.js";
import { ResolvedOverlayVisual } from "../catalog/resolved-overlay-visuals.js";
import { ResolvedWeaponVisuals } from "../catalog/resolved-weapon-visuals.js";
import { GameModeId } from "../game-mode/active-mode.js";
import { ContentHash, GameObjectTypeId, MapId, ObjectId, PluginId, ProjectId } from "../ids.js";
import { TileborneMap } from "../map/index.js";
import { JsonObject } from "../project/index.js";

/**
 * Neutral runtime map package (ADR-0030).
 *
 * THE one durable package format that carries an authored map into every
 * runtime: the editor playtest host, the local multiplayer host,
 * `apps/game-host` room boot, and the `tileborne game build` product output.
 * `packages/core` owns the SCHEMA (this module); `packages/runtime` owns the
 * worker-safe loader + runtime catalog registry; `packages/services-build`
 * assembles it; game-mode plugins contribute only their namespaced
 * `modeData.<pluginId>` projection. Product repos supply package directories
 * (`maps/`), never logic.
 *
 * Neutrality rules (boundary-tested): no plugin/brand literals, no closed
 * role/genre enums — a placement's gameplay meaning derives from the placed
 * type's catalog COMPONENTS (spawn-point, loot-source, hazard, …), and all
 * mode-specific sections are keyed by `pluginId`.
 */

/** Branded id of one assembled runtime map package. */
export const RuntimeMapPackageId = Schema.String.check(
  Schema.isPattern(/^mappkg:[0-9a-f-]{36}$/),
).pipe(Schema.brand("RuntimeMapPackageId"));
export type RuntimeMapPackageId = typeof RuntimeMapPackageId.Type;

/**
 * Version of the package schema itself (ADR-0008 discipline): loaders gate on
 * it and refuse newer packages instead of mis-decoding them.
 *
 * v2: the manifest gained the required NEUTRAL `playerCapacity` field (M2
 * review, F2) — hosts size player slots from it instead of peeking into the
 * engine-opaque `modeData` sections.
 */
export const RUNTIME_MAP_PACKAGE_SCHEMA_VERSION = 2;

/**
 * Package manifest: identity, the active game mode the package was assembled
 * for, the neutral player capacity, and per-entry content hashes
 * (`entryHashes` keys are package-relative entry names, e.g. `"map"`,
 * `"catalog"`, an asset path) so loaders can verify integrity without
 * re-reading the world.
 */
export class RuntimeMapPackageManifest extends Schema.Class<RuntimeMapPackageManifest>(
  "RuntimeMapPackageManifest",
)({
  packageId: RuntimeMapPackageId,
  schemaVersion: Schema.Int,
  projectId: ProjectId,
  mapId: MapId,
  /** The discovered active game mode this package boots (ADR-0023 §B). */
  activeMode: GameModeId,
  /**
   * NEUTRAL player capacity the package was assembled for: the number of
   * player slots a host may admit. Hosts read ONLY this — never a mode
   * section's own fields (`modeData` stays engine-opaque, boundary-tested).
   */
  playerCapacity: Schema.Int.check(Schema.isGreaterThan(0)),
  /** Engine version the package was assembled with (informational). */
  engineVersion: Schema.String,
  /** ISO-8601 assembly timestamp. */
  createdAt: Schema.String,
  /** Package-relative entry name → sha-256 content hash. */
  entryHashes: Schema.Record(Schema.String, ContentHash),
}) {}

/**
 * One placed object instance. Deliberately role-free (the BR
 * `ObjectPlacementRole` closed enum is hard-cut): gameplay meaning derives
 * from the referenced type's catalog components, so a new genre adds meaning
 * by adding components — never by widening this schema.
 */
export class RuntimeObjectPlacement extends Schema.Class<RuntimeObjectPlacement>(
  "RuntimeObjectPlacement",
)({
  objectId: ObjectId,
  typeId: GameObjectTypeId,
  /** World position in tile units (map coordinate space). */
  x: Schema.Number,
  y: Schema.Number,
  /** Per-instance property overrides (e.g. spawn team/weight), open JSON. */
  instanceProperties: Schema.optional(JsonObject),
}) {}

/** Where a merged catalog entry came from — origin attribution for tooling/diagnostics. */
export const RuntimeCatalogEntryOrigin = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("project") }),
  Schema.Struct({ _tag: Schema.Literal("plugin"), pluginId: PluginId }),
]);
export type RuntimeCatalogEntryOrigin = typeof RuntimeCatalogEntryOrigin.Type;

/**
 * One entry of the MERGED runtime catalog: cross-plugin + project-authored
 * object types with origin attribution. Ids are unique across all origins —
 * a project entry shadowing a plugin id is a merge FAILURE (no-shadowing
 * rule, decided at the M2 review), so every id has exactly one owner.
 */
export class RuntimeCatalogEntry extends Schema.Class<RuntimeCatalogEntry>(
  "RuntimeCatalogEntry",
)({
  origin: RuntimeCatalogEntryOrigin,
  objectType: GameObjectType,
}) {}

/**
 * Render-ready visual projections baked at assembly time (ADR-0026/0028
 * outputs) — the catalog itself is in the package, but hosts that only render
 * need these without re-deriving.
 */
export class RuntimeMapPackageVisuals extends Schema.Class<RuntimeMapPackageVisuals>(
  "RuntimeMapPackageVisuals",
)({
  playerModels: Schema.Array(PlayerModelRef),
  overlayVisuals: Schema.Array(ResolvedOverlayVisual),
  weaponVisuals: Schema.Array(ResolvedWeaponVisuals),
}) {}

/**
 * One content-addressed referenced asset payload (ADR-0015 packaging reuse).
 * `path` is package-relative; `hash` lets loaders verify without trusting the
 * directory.
 */
export class RuntimeMapPackageAssetEntry extends Schema.Class<RuntimeMapPackageAssetEntry>(
  "RuntimeMapPackageAssetEntry",
)({
  path: Schema.String,
  hash: ContentHash,
  /** The library asset id this payload backs, when it is a library asset. */
  assetId: Schema.optional(Schema.String),
}) {}

/**
 * The assembled, in-memory runtime map package. The on-disk layout (one file
 * per entry + manifest) is the loader/assembler concern (`packages/runtime` /
 * `packages/services-build`); this schema is the durable shape both sides
 * agree on.
 *
 * - `settings` is the map's namespaced authoring-settings projection
 *   (`map.properties.<pluginId>`, ADR-0023 §A) keyed by plugin id.
 * - `modeData` is the active mode's engine-OPAQUE projection keyed by plugin
 *   id, schema'd + validated by that plugin's exporter/runtime. Genuinely
 *   neutral data (placements, spawn points, visuals) must NOT hide in here
 *   (boundary-tested).
 */
export class RuntimeMapPackage extends Schema.Class<RuntimeMapPackage>("RuntimeMapPackage")({
  manifest: RuntimeMapPackageManifest,
  map: TileborneMap,
  catalog: Schema.Array(RuntimeCatalogEntry),
  placements: Schema.Array(RuntimeObjectPlacement),
  settings: Schema.Record(Schema.String, JsonObject),
  visuals: RuntimeMapPackageVisuals,
  assets: Schema.Array(RuntimeMapPackageAssetEntry),
  modeData: Schema.Record(Schema.String, JsonObject),
}) {}

/** A runtime map package failed schema/version/integrity checks. */
export class RuntimeMapPackageInvalidError extends Schema.TaggedErrorClass<RuntimeMapPackageInvalidError>()(
  "RuntimeMapPackageInvalidError",
  {
    reason: Schema.Literals(["schema", "version", "integrity"]),
    message: Schema.String,
  },
) {}

/** Build a package id from a UUID. */
export const makeRuntimeMapPackageId = (uuid: string): RuntimeMapPackageId =>
  Schema.decodeUnknownSync(RuntimeMapPackageId)(`mappkg:${uuid}`);

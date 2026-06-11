import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type GameObjectType,
  JsonObject,
  type PlayerModelRef,
  RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
  RuntimeCatalogEntry,
  RuntimeMapPackage,
  RuntimeMapPackageVisuals,
  RuntimeObjectPlacement,
  TileborneMap,
  deriveOverlayVisuals,
  deriveWeaponVisuals,
  makeRuntimeMapPackageId,
} from "@tileborne/core";
import {
  type GameModeDescriptor,
  type MergeGameObjectCatalogsDeps,
  type RuntimeModeDataExporter,
} from "@tileborne/plugin-api";
import {
  RUNTIME_MAP_PACKAGE_ENTRY_FILES,
  RUNTIME_MAP_PACKAGE_MANIFEST_FILE,
  type RuntimeCatalogPluginSource,
  type RuntimeMapPackageEntryName,
  buildRuntimeCatalogRegistry,
  hashRuntimeMapPackageEntry,
} from "@tileborne/runtime/map-package";
import { Effect, Result, Schema } from "effect";

import {
  ensureDirectory,
  serviceError,
  verifiedChildPath,
} from "../internal/persistence.js";
import type { ServicesBuildError } from "../model.js";

/**
 * Runtime map package assembly (ADR-0030 step 1, the one producer).
 *
 * `services-build` owns turning an authored map into the neutral
 * `RuntimeMapPackage` every runtime boots from: merge the materialized plugin
 * catalogs + project entities through the canonical runtime registry, project
 * role-free placements from the map's objects, slice the namespaced settings,
 * call the ACTIVE mode's narrowed exporter for `modeData.<pluginId>`, then
 * write the canonical on-disk layout (`manifest.json` + one JSON file per
 * section + content-addressed `assets/**`) with per-entry sha-256 hashes the
 * worker-safe loader verifies.
 */

/** One content-addressed asset payload to package under `assets/**`. */
export interface RuntimeMapPackageAssetInput {
  /** Package-relative path, must live under `assets/`. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** The library asset id this payload backs, when it is a library asset. */
  readonly assetId?: string;
}

export interface AssembleRuntimeMapPackageInput {
  readonly projectId: string;
  readonly map: TileborneMap;
  /** The discovered ACTIVE game mode (ADR-0023 §B) this package boots. */
  readonly activeMode: Pick<GameModeDescriptor, "modeId" | "pluginId">;
  /** Materialized per-plugin catalogs (`LoadedDeclarativePlugin.gameObjectCatalogs`). */
  readonly pluginCatalogs: readonly RuntimeCatalogPluginSource[];
  /**
   * Project-authored entities, appended as new entries. A project entity
   * reusing a plugin-owned id fails the merge (no-shadowing rule, decided at
   * the M2 review).
   */
  readonly projectObjectTypes?: readonly GameObjectType[];
  /**
   * NEUTRAL player capacity baked into the manifest (positive integer): the
   * number of player slots hosts may admit. The caller sources it from the
   * active mode's authored settings (e.g. the namespaced `maxPlayers` the BR
   * settings flow writes) — the engine never peeks into `modeData` for it.
   */
  readonly playerCapacity: number;
  /**
   * The resolved player-model roster (ADR-0026). Overlay + weapon visuals are
   * NOT inputs: assembly bakes them from the merged catalog (ADR-0028), so the
   * package visuals always agree with the package catalog.
   */
  readonly playerModels: readonly PlayerModelRef[];
  readonly assets?: readonly RuntimeMapPackageAssetInput[];
  /** The active mode's narrowed exporter; omitted = empty `modeData`. */
  readonly modeDataExporter?: RuntimeModeDataExporter;
  /** Cross-pack weapon-ref resolver for the catalog merge (ADR-0028 §4a). */
  readonly mergeDeps?: MergeGameObjectCatalogsDeps;
  readonly engineVersion: string;
  readonly outputDirectory: string;
}

export interface AssembledRuntimeMapPackage {
  readonly directory: string;
  readonly manifestPath: string;
  readonly mapPackage: RuntimeMapPackage;
}

const CatalogEntries = Schema.Array(RuntimeCatalogEntry);
const Placements = Schema.Array(RuntimeObjectPlacement);

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Project role-free placements from the map's objects (ADR-0030): every placed
 * object's `kind` must resolve in the merged catalog, because its gameplay
 * meaning is read from that type's components — an unknown type would be a
 * meaningless placement at runtime, so assembly fails fast instead.
 */
const projectPlacements = (
  map: TileborneMap,
  hasType: (id: GameObjectType["id"]) => boolean,
): Result.Result<readonly RuntimeObjectPlacement[], ServicesBuildError> => {
  const unknown = [...new Set(map.objects.filter((object) => !hasType(object.kind)).map((object) => object.kind))];
  if (unknown.length > 0) {
    return Result.fail(
      serviceError(
        `map references object types missing from the merged catalog: ${unknown.join(", ")}`,
      ),
    );
  }
  return Result.succeed(
    map.objects.map(
      (object) =>
        new RuntimeObjectPlacement({
          objectId: object.id,
          typeId: object.kind,
          x: object.x,
          y: object.y,
          ...(Object.keys(object.properties).length > 0
            ? { instanceProperties: object.properties }
            : {}),
        }),
    ),
  );
};

/** Slice the map's namespaced authoring settings (`map.properties.<pluginId>`, ADR-0023 §A). */
const namespacedSettings = (map: TileborneMap): Record<string, JsonObject> =>
  Object.fromEntries(
    Object.entries(map.properties).filter(
      (entry): entry is [string, JsonObject] => isJsonObject(entry[1]),
    ),
  );

const writeBytes = (
  filePath: string,
  bytes: Uint8Array,
): Effect.Effect<void, ServicesBuildError> =>
  Effect.tryPromise({
    try: () => writeFile(filePath, bytes),
    catch: (cause) =>
      serviceError(cause instanceof Error ? cause.message : String(cause), filePath),
  });

const encodeJsonBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export const assembleRuntimeMapPackage = (
  input: AssembleRuntimeMapPackageInput,
): Effect.Effect<AssembledRuntimeMapPackage, ServicesBuildError> =>
  Effect.gen(function* () {
    // 1. Merge catalogs through the canonical runtime registry (single owner).
    const registryResult = buildRuntimeCatalogRegistry(
      input.pluginCatalogs,
      input.projectObjectTypes ?? [],
      input.mergeDeps ?? {},
    );
    if (Result.isFailure(registryResult)) {
      return yield* serviceError(
        `catalog merge failed: ${registryResult.failure._tag}: ${registryResult.failure.message ?? ""}`,
      );
    }
    const registry = registryResult.success;

    // 2. Project neutral placements; 3. slice namespaced settings.
    const placementsResult = projectPlacements(input.map, (id) => registry.byId(id) !== undefined);
    if (Result.isFailure(placementsResult)) {
      return yield* placementsResult.failure;
    }
    const placements = placementsResult.success;
    const settings = namespacedSettings(input.map);

    // Bake render-ready visuals from the merged catalog (ADR-0026/0028):
    // project-authored claimants win overlay slots, weapon visuals resolve
    // against the same entries the package ships. Derivation issues are
    // render-completeness diagnostics, not assembly failures.
    const mergedObjectTypes = registry.entries.map((entry) => entry.objectType);
    const projectTypeIds = new Set(
      registry.entries
        .filter((entry) => entry.origin._tag === "project")
        .map((entry) => String(entry.objectType.id)),
    );
    const visuals = new RuntimeMapPackageVisuals({
      playerModels: input.playerModels,
      overlayVisuals: deriveOverlayVisuals(mergedObjectTypes, { projectTypeIds }).visuals,
      weaponVisuals: deriveWeaponVisuals(mergedObjectTypes).visuals,
    });

    // 4. Active mode's narrowed exporter contributes only its modeData section.
    let modeData: Record<string, JsonObject> = {};
    if (input.modeDataExporter !== undefined) {
      const exported = input.modeDataExporter({
        map: input.map,
        catalog: registry.entries,
        placements,
        settings: settings[input.activeMode.pluginId],
      });
      if (Result.isFailure(exported)) {
        return yield* serviceError(
          `mode data export failed for ${exported.failure.pluginId}: ${exported.failure.message}`,
        );
      }
      modeData = { [input.activeMode.pluginId]: exported.success };
    }

    // 5. Encode sections + hash the EXACT bytes that get written.
    const assetInputs = input.assets ?? [];
    for (const asset of assetInputs) {
      if (!asset.path.startsWith("assets/")) {
        return yield* serviceError(`asset path must live under assets/: ${asset.path}`);
      }
    }
    const assetEntriesJson = yield* Effect.gen(function* () {
      const entries: { path: string; hash: string; assetId?: string }[] = [];
      for (const asset of assetInputs) {
        entries.push({
          path: asset.path,
          hash: yield* Effect.promise(() => hashRuntimeMapPackageEntry(asset.bytes)),
          ...(asset.assetId === undefined ? {} : { assetId: asset.assetId }),
        });
      }
      return entries;
    });

    const sectionJson: Record<RuntimeMapPackageEntryName, unknown> = {
      map: Schema.encodeSync(TileborneMap)(input.map),
      catalog: Schema.encodeSync(CatalogEntries)(registry.entries),
      placements: Schema.encodeSync(Placements)(placements),
      settings,
      visuals: Schema.encodeSync(RuntimeMapPackageVisuals)(visuals),
      assets: assetEntriesJson,
      modeData,
    };

    const entryHashes: Record<string, string> = {};
    const sectionBytes = new Map<RuntimeMapPackageEntryName, Uint8Array>();
    for (const entryName of Object.keys(RUNTIME_MAP_PACKAGE_ENTRY_FILES) as RuntimeMapPackageEntryName[]) {
      const bytes = encodeJsonBytes(sectionJson[entryName]);
      sectionBytes.set(entryName, bytes);
      entryHashes[entryName] = yield* Effect.promise(() => hashRuntimeMapPackageEntry(bytes));
    }
    for (const entry of assetEntriesJson) {
      entryHashes[entry.path] = entry.hash;
    }

    const manifestJson = {
      packageId: makeRuntimeMapPackageId(randomUUID()),
      schemaVersion: RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
      projectId: input.projectId,
      mapId: input.map.id,
      activeMode: input.activeMode.modeId,
      playerCapacity: input.playerCapacity,
      engineVersion: input.engineVersion,
      createdAt: new Date().toISOString(),
      entryHashes,
    };

    // Decode the full package once: validates manifest + every section against
    // the core schema before anything is written.
    const mapPackage = yield* Effect.try({
      try: () =>
        Schema.decodeUnknownSync(RuntimeMapPackage)({
          manifest: manifestJson,
          map: sectionJson.map,
          catalog: sectionJson.catalog,
          placements: sectionJson.placements,
          settings: sectionJson.settings,
          visuals: sectionJson.visuals,
          assets: sectionJson.assets,
          modeData: sectionJson.modeData,
        }),
      catch: (cause) =>
        serviceError(
          `assembled package failed schema validation: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    });

    // 6. Write the canonical layout: sections, assets, manifest last.
    yield* ensureDirectory(input.outputDirectory);
    for (const [entryName, fileName] of Object.entries(RUNTIME_MAP_PACKAGE_ENTRY_FILES)) {
      const filePath = yield* verifiedChildPath(input.outputDirectory, fileName);
      yield* writeBytes(filePath, sectionBytes.get(entryName as RuntimeMapPackageEntryName)!);
    }
    for (const asset of assetInputs) {
      const filePath = yield* verifiedChildPath(input.outputDirectory, asset.path);
      yield* ensureDirectory(path.dirname(filePath));
      yield* writeBytes(filePath, asset.bytes);
    }
    const manifestPath = yield* verifiedChildPath(
      input.outputDirectory,
      RUNTIME_MAP_PACKAGE_MANIFEST_FILE,
    );
    yield* writeBytes(manifestPath, encodeJsonBytes(manifestJson));

    return {
      directory: input.outputDirectory,
      manifestPath,
      mapPackage,
    };
  });

/** Re-exported so hosts assemble + load against the same plugin-source shape. */
export type { RuntimeCatalogPluginSource };

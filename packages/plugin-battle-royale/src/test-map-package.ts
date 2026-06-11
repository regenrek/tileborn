import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GameObjectCatalog,
  PluginId,
  RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
  RuntimeCatalogEntry,
  RuntimeMapPackageVisuals,
  RuntimeObjectPlacement,
  TileborneMap,
  deriveOverlayVisuals,
  deriveWeaponVisuals,
  type GameObjectType,
  type JsonObject,
  type PlayerModelRef,
} from "@tileborne/core";
import { Result, Schema } from "effect";

import { DEFAULT_MAX_PLAYERS, PLUGIN_ID } from "./constants.js";
import { exportBattleRoyaleModeData } from "./mode-data.js";
import { buildBattleRoyaleRuntimeState } from "./runtime-state-from-package.js";
import { TEST_PLAYER_MODELS } from "./test-player-model.js";
import type { BattleRoyaleArtifact } from "./types/artifact.js";

/**
 * Test-only `RuntimeMapPackage` fixture builder: the encoded wire JSON every
 * runtime host hands the plugin (ADR-0030). The plugin must not dev-depend
 * back on `@tileborne/services-build`, so the encoded JSON is built directly
 * in the same shape `assembleRuntimeMapPackage` validates.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const shippedCatalog = Schema.decodeUnknownSync(GameObjectCatalog)(
  JSON.parse(fs.readFileSync(path.join(packageRoot, "schemas/game-object-catalog.json"), "utf8")),
);

export const shippedCatalogObjectTypes = (): readonly GameObjectType[] =>
  shippedCatalog.objectTypes;

const pluginId = Schema.decodeUnknownSync(PluginId)(PLUGIN_ID);

export const toCatalogEntries = (
  objectTypes: readonly GameObjectType[],
): readonly RuntimeCatalogEntry[] =>
  objectTypes.map(
    (objectType) =>
      new RuntimeCatalogEntry({ origin: { _tag: "plugin", pluginId }, objectType }),
  );

/** Same role-free projection assembly performs (`map.objects` → placements). */
const projectPlacements = (map: TileborneMap): readonly RuntimeObjectPlacement[] =>
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
  );

const namespacedSettings = (map: TileborneMap): Record<string, JsonObject> =>
  Object.fromEntries(
    Object.entries(map.properties).filter(
      (entry): entry is [string, JsonObject] =>
        typeof entry[1] === "object" && entry[1] !== null && !Array.isArray(entry[1]),
    ),
  );

const CatalogEntries = Schema.Array(RuntimeCatalogEntry);
const Placements = Schema.Array(RuntimeObjectPlacement);

/**
 * Real per-section content hashes for the in-memory wire fixture (M2 review,
 * N2: no fixture ships `entryHashes: {}`). Hashed over the section's JSON
 * encoding, sync via node:crypto since this is test-only node code.
 */
const sectionEntryHashes = (sections: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(sections).map(([entryName, section]) => [
      entryName,
      `sha256:${createHash("sha256").update(JSON.stringify(section)).digest("hex")}`,
    ]),
  );

export interface TestMapPackageInput {
  readonly map: TileborneMap;
  readonly catalog?: readonly RuntimeCatalogEntry[];
  readonly playerModels?: readonly PlayerModelRef[];
  readonly visuals?: RuntimeMapPackageVisuals;
  readonly modeData?: Record<string, JsonObject>;
  /** Neutral manifest capacity; defaults to the authored BR `maxPlayers`. */
  readonly playerCapacity?: number;
}

/** Build the encoded wire `RuntimeMapPackage` from decoded fixtures. */
export const buildTestMapPackage = (input: TestMapPackageInput): unknown => {
  const catalog = input.catalog ?? toCatalogEntries(shippedCatalog.objectTypes);
  const placements = projectPlacements(input.map);
  const settings = namespacedSettings(input.map);
  const objectTypes = catalog.map((entry) => entry.objectType);
  const visuals =
    input.visuals ??
    new RuntimeMapPackageVisuals({
      playerModels: input.playerModels ?? TEST_PLAYER_MODELS,
      overlayVisuals: deriveOverlayVisuals(objectTypes, {}).visuals,
      weaponVisuals: deriveWeaponVisuals(objectTypes).visuals,
    });
  const modeData =
    input.modeData ??
    ({
      [PLUGIN_ID]: Result.getOrThrow(
        exportBattleRoyaleModeData({
          map: input.map,
          catalog,
          placements,
          settings: settings[PLUGIN_ID],
        }),
      ),
    } satisfies Record<string, JsonObject>);

  const authoredMaxPlayers = settings[PLUGIN_ID]?.maxPlayers;
  const playerCapacity =
    input.playerCapacity ??
    (typeof authoredMaxPlayers === "number" &&
    Number.isInteger(authoredMaxPlayers) &&
    authoredMaxPlayers > 0
      ? authoredMaxPlayers
      : DEFAULT_MAX_PLAYERS);

  const sections = {
    map: Schema.encodeSync(TileborneMap)(input.map),
    catalog: Schema.encodeSync(CatalogEntries)(catalog),
    placements: Schema.encodeSync(Placements)(placements),
    settings,
    visuals: Schema.encodeSync(RuntimeMapPackageVisuals)(visuals),
    assets: [] as unknown[],
    modeData,
  };

  return {
    manifest: {
      packageId: "mappkg:550e8400-e29b-41d4-a716-446655440777",
      schemaVersion: RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
      projectId: "project:550e8400-e29b-41d4-a716-446655440888",
      mapId: String(input.map.id),
      activeMode: PLUGIN_ID,
      playerCapacity,
      engineVersion: "0.0.0-test",
      createdAt: "2026-06-10T00:00:00.000Z",
      entryHashes: sectionEntryHashes(sections),
    },
    ...sections,
  };
};

export interface TestRuntimeArtifactOptions
  extends Omit<TestMapPackageInput, "map"> {
  readonly selectedPlayerModelId?: string;
}

/**
 * Build BR's runtime state the same way a host-driven adapter would: package
 * in, `buildBattleRoyaleRuntimeState` out, with the single-player selection
 * expressed through the session channel.
 */
export const buildTestRuntimeArtifact = (
  map: TileborneMap,
  options: TestRuntimeArtifactOptions = {},
): BattleRoyaleArtifact => {
  const { selectedPlayerModelId, ...packageInput } = options;
  return buildBattleRoyaleRuntimeState(buildTestMapPackage({ map, ...packageInput }), {
    ...(selectedPlayerModelId === undefined
      ? {}
      : { playerModelSelections: [{ playerId: "player-1", modelId: selectedPlayerModelId }] }),
  });
};

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AssetPackManifest } from "@tileborne/asset-pipeline";
import {
  PlayerModelRef,
  ProjectManifest,
  readPluginMapSettings,
  type JsonObject,
  type TileborneMap,
} from "@tileborne/core";
import type { RuntimeModeDataExporter } from "@tileborne/plugin-api";
import { Effect, Schema } from "effect";

import { errorMessage, serviceError } from "../internal/persistence.js";
import type { ServicesBuildError } from "../model.js";
import type { RuntimeMapPackageAssetInput } from "./assemble.js";

/**
 * Ship-build inputs for `assembleRuntimeMapPackage` (M5 S1): the producers
 * that turn installed-plugin + asset-pack state into the assembly inputs the
 * playtest path sources from the desktop main process. Everything here is
 * plugin-NEUTRAL: plugin behavior is discovered on the installed plugin's
 * node entry by generic export names, never by plugin-id literals.
 */

/**
 * Fallback NEUTRAL player capacity when the active mode's authored settings
 * declare no `maxPlayers` (matches the game-host room default).
 */
export const DEFAULT_PACKAGE_PLAYER_CAPACITY = 32;

/**
 * Source the package's neutral `manifest.playerCapacity` the same way the
 * mode-data export reads it: the active plugin's namespaced map settings
 * (`map.properties.<pluginId>.maxPlayers`, ADR-0023 §A).
 */
export const resolvePackagePlayerCapacity = (
  map: TileborneMap,
  activePluginId: string,
): number => {
  const value = readPluginMapSettings(map, activePluginId).maxPlayers;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_PACKAGE_PLAYER_CAPACITY;
};

const PACK_MANIFEST_FILENAME = "tileborne-asset-pack.json";

/** One installed asset pack to package: its decoded manifest + install root. */
export interface InstalledAssetPackSource {
  readonly manifest: AssetPackManifest;
  readonly root: string;
}

const readBytes = (filePath: string): Effect.Effect<Uint8Array, ServicesBuildError> =>
  Effect.tryPromise({
    try: async () => new Uint8Array(await readFile(filePath)),
    catch: (cause) => serviceError(errorMessage(cause), filePath),
  });

/** Package-relative directory one pack's payloads live under. */
const packAssetDir = (manifest: AssetPackManifest): string =>
  `assets/packs/${manifest.id}-${manifest.version}`;

/**
 * The package `assets/**` section producer (closes M2 nit N1 in M5 S1):
 * package every project-referenced asset pack — the pack manifest (tileset +
 * collision-mask metadata) plus each payload it lists — as content-addressed
 * package assets, so runtimes booting from the package can resolve library
 * assets without an installed asset root.
 */
export const collectRuntimeMapPackageAssets = (
  packs: readonly InstalledAssetPackSource[],
): Effect.Effect<readonly RuntimeMapPackageAssetInput[], ServicesBuildError> =>
  Effect.gen(function* () {
    const inputs: RuntimeMapPackageAssetInput[] = [];
    for (const pack of packs) {
      const packDir = packAssetDir(pack.manifest);
      inputs.push({
        path: `${packDir}/${PACK_MANIFEST_FILENAME}`,
        bytes: yield* readBytes(path.join(pack.root, PACK_MANIFEST_FILENAME)),
      });
      for (const asset of pack.manifest.assets) {
        inputs.push({
          path: `${packDir}/${asset.path}`,
          bytes: yield* readBytes(path.join(pack.root, asset.path)),
          assetId: asset.id,
        });
      }
    }
    return inputs;
  });

interface PluginNodeEntryManifest {
  readonly entry?: {
    readonly server?: string;
    readonly editor?: string;
  };
}

/** Resolve the installed plugin's node entry (`entry.server`, else `entry.editor`). */
const resolveNodeEntry = async (rootPath: string): Promise<string | undefined> => {
  const manifestRaw = await readFile(path.join(rootPath, "tileborne-plugin.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as PluginNodeEntryManifest;
  const nodeEntry = manifest.entry?.server ?? manifest.entry?.editor;
  return nodeEntry === undefined ? undefined : path.resolve(rootPath, nodeEntry);
};

interface PluginNodeModule {
  readonly exportModeData?: unknown;
  readonly resolvePlayerModels?: unknown;
}

const loadNodeEntryModule = (
  rootPath: string,
): Effect.Effect<PluginNodeModule | undefined, ServicesBuildError> =>
  Effect.tryPromise({
    try: async () => {
      const nodeEntry = await resolveNodeEntry(rootPath);
      if (nodeEntry === undefined) {
        return undefined;
      }
      return (await import(pathToFileURL(nodeEntry).href)) as PluginNodeModule;
    },
    catch: (cause) => serviceError(errorMessage(cause), rootPath),
  });

/**
 * Discover the active mode's `RuntimeModeDataExporter` on the installed
 * plugin's node entry (generic `exportModeData` export, ADR-0030) so package
 * assembly can bake `modeData.<pluginId>`.
 */
export const loadPluginModeDataExporter = (
  rootPath: string,
): Effect.Effect<RuntimeModeDataExporter | undefined, ServicesBuildError> =>
  loadNodeEntryModule(rootPath).pipe(
    Effect.map((module) =>
      typeof module?.exportModeData === "function"
        ? (module.exportModeData as RuntimeModeDataExporter)
        : undefined,
    ),
  );

const PlayerModelArray = Schema.Array(PlayerModelRef);

/**
 * Discover the active mode's player-model roster on the installed plugin's
 * node entry: the generic `resolvePlayerModels` export receives the WIRE
 * (encoded) project manifest and returns WIRE `PlayerModelRef[]` — plain JSON
 * across the bundle boundary so two core copies never compare class
 * instances. Plugins without the export ship an empty roster.
 */
export const loadPluginPlayerModels = (
  rootPath: string,
  project: ProjectManifest,
): Effect.Effect<readonly PlayerModelRef[], ServicesBuildError> =>
  Effect.gen(function* () {
    const module = yield* loadNodeEntryModule(rootPath);
    if (typeof module?.resolvePlayerModels !== "function") {
      return [] as readonly PlayerModelRef[];
    }
    const projectWire = JSON.parse(
      JSON.stringify(Schema.encodeSync(ProjectManifest)(project)),
    ) as JsonObject;
    return yield* Effect.try({
      try: () => {
        const resolve = module.resolvePlayerModels as (project: JsonObject) => unknown;
        const wire = JSON.parse(JSON.stringify(resolve(projectWire) ?? [])) as unknown;
        return Schema.decodeUnknownSync(PlayerModelArray)(wire);
      },
      catch: (cause) =>
        serviceError(`plugin player-model roster is invalid: ${errorMessage(cause)}`, rootPath),
    });
  });

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AssetPackManifest } from "@tileborne/asset-pipeline";
import {
  BuildId,
  GameObjectCatalog,
  MapId,
  PackId,
  PluginId,
  PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY,
  ProjectId,
  RuntimeMapPackage,
  TileborneMap,
  type JsonObject,
} from "@tileborne/core";
import {
  buildCloudflareGameHost,
  type CloudflareGameHostMapPackageInput,
} from "@tileborne/game-host/build";
import { discoverGameModes, resolveActiveGameMode } from "@tileborne/plugin-api";
import type { RuntimeCatalogPluginSource } from "@tileborne/runtime/map-package";
import { PluginLoaderService, PluginRegistryService } from "@tileborne/services-plugin";
import { AssetService, MapService, ProjectService } from "@tileborne/services-app";
import { HomeService, JobId, JobService } from "@tileborne/services-foundation";
import { Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect";

const runtimePackagePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../runtime/package.json",
);

const readRuntimeVersion = (): Effect.Effect<string, ServicesBuildError> =>
  Effect.tryPromise({
    try: async () => {
      const raw = await readFile(runtimePackagePath, "utf8");
      return (JSON.parse(raw) as { readonly version: string }).version;
    },
    catch: (cause) =>
      new ServicesBuildError({
        path: Option.some(runtimePackagePath),
        message: errorMessage(cause),
      }),
  });

import {
  BuildArtifact,
  GameBuildArtifact,
  GameBuildOptions,
  IntegrityMismatchError,
  BuildNotFoundError,
  BuildOptions,
  BuildSummary,
  emptyBuildOptions,
  emptyContentHash,
  makeNewBuildId,
  ServicesBuildError,
} from "../model.js";
import {
  deleteDirectory,
  ensureDirectory,
  listVerifiedJson,
  metadataFileName,
  readVerifiedJson,
  serviceError,
  verifiedChildPath,
  writeTextFile,
  writeVerifiedJson,
  errorMessage,
} from "../internal/persistence.js";
import {
  assembleRuntimeMapPackage,
  collectRuntimeMapPackageAssets,
  loadPluginModeDataExporter,
  loadPluginPlayerModels,
  resolvePackagePlayerCapacity,
  type InstalledAssetPackSource,
} from "../map-package/index.js";
import { readProjectActiveGameModeId } from "../playtest/active-game-mode-selection.js";

const gameBuildMetadataFileName = "build-artifact.json";

/**
 * Serve instructions baked into the `local` target artifact (M5 S2): the
 * single command a non-cloudflare user runs to boot this directory into a
 * joinable game-host.
 */
const localServeReadme = (input: {
  readonly pluginId: string;
  readonly directory: string;
  readonly createdAt: string;
}): string => `# Tileborne game-host (local build)

Plugin: ${input.pluginId}
Built:  ${input.createdAt}

Serve this directory locally (no Cloudflare account required):

    tileborne game serve --dir "${input.directory}"

The command prints a base URL once the host is ready. Create a joinable room:

    curl -X POST <baseUrl>/rooms/create \\
      -H 'content-type: application/json' \\
      -d '{"mapId":"<mapId>"}'

Bundled maps (and their ids) are listed in manifest.json under "maps".
To deploy the same artifact to Cloudflare instead, run \`wrangler deploy\`
with the included wrangler.toml.
`;

export class BuildService extends Context.Service<BuildService, {
  readonly build: (projectId: ProjectId, options?: BuildOptions) => Effect.Effect<JobId>;
  readonly buildGame: (options: GameBuildOptions) => Effect.Effect<GameBuildArtifact, ServicesBuildError>;
  readonly getBuild: (
    buildId: BuildId,
  ) => Effect.Effect<BuildArtifact, ServicesBuildError | BuildNotFoundError | IntegrityMismatchError>;
  readonly listBuilds: (
    projectId: ProjectId,
  ) => Effect.Effect<readonly BuildSummary[], ServicesBuildError | IntegrityMismatchError>;
  readonly deleteBuild: (buildId: BuildId) => Effect.Effect<void, ServicesBuildError>;
  readonly subscribe: Stream.Stream<void>;
}>()("@tileborne/services-build/BuildService") {}

const buildRoot = (cachePath: string): string => path.join(cachePath, "builds");

const summarize = (artifact: BuildArtifact): BuildSummary =>
  new BuildSummary({
    id: artifact.id,
    projectId: artifact.projectId,
    target: artifact.target,
    createdAt: artifact.createdAt,
    integrityHash: artifact.integrityHash,
  });

export const BuildServiceLive = Layer.effect(
  BuildService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const jobs = yield* JobService;
    const registry = yield* PluginRegistryService;
    const loader = yield* PluginLoaderService;
    const assets = yield* AssetService;
    const projects = yield* ProjectService;
    const maps = yield* MapService;
    const events = yield* PubSub.unbounded<void>();
    const root = buildRoot(home.paths.cache);
    yield* ensureDirectory(root);

    const loadProjectSnapshot = (projectId: ProjectId) =>
      Effect.gen(function* () {
        const project = yield* projects.open(projectId).pipe(
          Effect.mapError((error) => new ServicesBuildError({ path: Option.none(), message: error.message })),
        );
        const loadedMaps: TileborneMap[] = [];
        for (const ref of project.maps) {
          const mapId = ref.id as MapId;
          loadedMaps.push(
            yield* maps.load(projectId, mapId).pipe(
              Effect.mapError((error) => new ServicesBuildError({ path: Option.some(ref.path), message: error.message })),
            ),
          );
        }
        const assetPacks: AssetPackManifest[] = [];
        for (const ref of project.assetPacks) {
          const packId = Schema.decodeUnknownSync(PackId)(ref.id);
          assetPacks.push(
            yield* assets.getPack(packId).pipe(
              Effect.mapError((error) => new ServicesBuildError({ path: Option.none(), message: error.message })),
            ),
          );
        }
        return { project, maps: loadedMaps, assetPacks };
      });

    const getBuild = Effect.fn("BuildService.getBuild")(function* (buildId: BuildId) {
      const filePath = yield* verifiedChildPath(root, buildId, metadataFileName);
      return yield* readVerifiedJson(filePath, BuildArtifact).pipe(
        Effect.mapError((error) =>
          error._tag === "ServicesBuildError"
            ? new BuildNotFoundError({ buildId, message: `build not found: ${buildId}` })
            : error,
        ),
      );
    });

    const writeBuildArtifact = Effect.fn("BuildService.writeBuildArtifact")(function* (
      projectId: ProjectId,
      options: BuildOptions,
    ) {
      const snapshot = yield* loadProjectSnapshot(projectId);
      const buildId = makeNewBuildId();
      const directory = yield* verifiedChildPath(root, buildId);
      yield* ensureDirectory(directory);
      const manifestPath = yield* verifiedChildPath(directory, metadataFileName);
      const target = Option.getOrElse(options.target, () => "cloudflare" as const);
      const delayMs = Option.getOrElse(options.delayMs, () => 0);
      if (delayMs > 0) {
        yield* Effect.sleep(delayMs);
      }
      const artifact = new BuildArtifact({
        id: buildId,
        projectId,
        target,
        createdAt: new Date().toISOString(),
        directory,
        manifestPath,
        project: snapshot.project,
        maps: [...snapshot.maps],
        assetPacks: [...snapshot.assetPacks],
        integrityHash: emptyContentHash,
      });
      const integrityHash = yield* writeVerifiedJson(manifestPath, BuildArtifact, artifact);
      yield* writeTextFile(
        yield* verifiedChildPath(directory, "README.txt"),
        `Tileborne build ${buildId}\nTarget: ${target}\n`,
      );
      yield* PubSub.publish(events, void 0);
      return new BuildArtifact({ ...artifact, integrityHash });
    });

    const build = Effect.fn("BuildService.build")(function* (
      projectId: ProjectId,
      options: BuildOptions = emptyBuildOptions,
    ) {
      return yield* jobs.create({
        name: `build ${projectId}`,
        run: writeBuildArtifact(projectId, options) as Effect.Effect<BuildArtifact, unknown, never>,
      });
    });

    const listBuilds = Effect.fn("BuildService.listBuilds")(function* (projectId: ProjectId) {
      const artifacts = yield* listVerifiedJson(root, BuildArtifact);
      return artifacts
        .filter((artifact) => artifact.projectId === projectId)
        .map(summarize)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });

    const deleteBuild = Effect.fn("BuildService.deleteBuild")(function* (buildId: BuildId) {
      yield* deleteDirectory(yield* verifiedChildPath(root, buildId));
      yield* PubSub.publish(events, void 0);
    });

    const buildError = (message: string) => new ServicesBuildError({ path: Option.none(), message });

    /**
     * Assemble one `RuntimeMapPackage` per selected project map for the
     * cloudflare ship build (M5 S1): the SAME producer chain as the desktop
     * playtest path — manifest-driven active-mode resolution (ADR-0023 §B),
     * materialized plugin catalogs + project fragment, the node entry's
     * generic `exportModeData`/`resolvePlayerModels`, and the project's
     * referenced asset packs as the package `assets/**` section.
     */
    const assembleShipMapPackages = Effect.fn("BuildService.assembleShipMapPackages")(function* (input: {
      readonly directory: string;
      readonly pluginId: PluginId;
      readonly pluginRootPath: string;
      readonly projectId: ProjectId;
      readonly mapIds: Option.Option<readonly string[]>;
      readonly assetsRoot: string;
    }) {
      const project = yield* projects.open(input.projectId).pipe(
        Effect.mapError((error) => buildError(error.message)),
      );
      const plugins = yield* registry.list().pipe(
        Effect.mapError((error) => buildError(error.message)),
      );
      const enabled = plugins.filter((plugin) => plugin.enabled);
      const modes = discoverGameModes(
        enabled.map((plugin) => ({ pluginId: plugin.id, contributions: plugin.manifest.contributes })),
      );
      const active = resolveActiveGameMode(modes, readProjectActiveGameModeId(project));
      if (active === undefined) {
        return yield* serviceError(
          `no active game mode resolved for ${input.projectId}: enable exactly one mode plugin or select an active game mode`,
        );
      }
      if (active.pluginId !== input.pluginId) {
        return yield* serviceError(
          `active game mode is owned by ${active.pluginId}, but the build bundles ${input.pluginId}`,
        );
      }

      // Materialized catalogs + weapon-ref resolver: same sources the editor
      // merge reads (broken declarative plugins are skipped, not fatal).
      yield* Effect.forEach(
        enabled,
        (plugin) => loader.loadDeclarative(plugin.id).pipe(Effect.catch(() => Effect.void)),
        { discard: true },
      );
      const enabledIds = new Set<string>(enabled.map((plugin) => plugin.id));
      const declarative = (yield* loader.listDeclarative()).filter((plugin) =>
        enabledIds.has(plugin.pluginId),
      );
      const pluginCatalogs = declarative
        .filter((plugin) => plugin.gameObjectCatalogs.length > 0)
        .map(
          (plugin): RuntimeCatalogPluginSource => ({
            pluginId: plugin.pluginId,
            catalogs: plugin.gameObjectCatalogs.map(({ contributionId, catalog }) => ({
              contributionId: `${plugin.pluginId}#${contributionId}`,
              catalog,
            })),
          }),
        );
      const weaponIds = new Set<string>(
        declarative.flatMap((plugin) =>
          plugin.weaponCatalogs.flatMap((materialized) =>
            materialized.catalog.weapons.map((entry) => String(entry.weapon.id)),
          ),
        ),
      );
      const fragmentRaw = project.settings?.[PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY];
      const projectObjectTypes =
        fragmentRaw === undefined
          ? []
          : (yield* Effect.try({
              try: () => Schema.decodeUnknownSync(GameObjectCatalog)(fragmentRaw),
              catch: (cause) =>
                serviceError(`project catalog fragment is invalid: ${errorMessage(cause)}`),
            })).objectTypes;

      const modeDataExporter = yield* loadPluginModeDataExporter(input.pluginRootPath);
      if (modeDataExporter === undefined) {
        return yield* serviceError(
          `active game-mode plugin exposes no mode-data exporter: ${active.pluginId}`,
        );
      }
      const playerModels = yield* loadPluginPlayerModels(input.pluginRootPath, project);

      const packSources: InstalledAssetPackSource[] = [];
      for (const ref of project.assetPacks) {
        const packId = Schema.decodeUnknownSync(PackId)(ref.id);
        const manifest = yield* assets.getPack(packId).pipe(
          Effect.mapError((error) => buildError(error.message)),
        );
        packSources.push({
          manifest,
          root: path.join(input.assetsRoot, "packs", `${manifest.id}-${manifest.version}`),
        });
      }
      const packageAssets = yield* collectRuntimeMapPackageAssets(packSources);

      const projectMapIds = project.maps.map((ref) => ref.id);
      const selectedIds = Option.getOrElse(input.mapIds, () => projectMapIds);
      if (selectedIds.length === 0) {
        return yield* serviceError(`project ${input.projectId} has no maps to ship`);
      }
      const mapPackages: CloudflareGameHostMapPackageInput[] = [];
      for (const rawMapId of selectedIds) {
        if (!projectMapIds.includes(rawMapId)) {
          return yield* serviceError(`map ${rawMapId} is not part of project ${input.projectId}`);
        }
        const mapId = Schema.decodeUnknownSync(MapId)(rawMapId);
        const map = yield* maps.load(input.projectId, mapId).pipe(
          Effect.mapError((error) => buildError(error.message)),
        );
        const sourceDir = yield* verifiedChildPath(
          input.directory,
          ".staging",
          "map-packages",
          rawMapId.replaceAll(":", "-"),
        );
        const assembled = yield* assembleRuntimeMapPackage({
          projectId: input.projectId,
          map,
          activeMode: active,
          pluginCatalogs,
          projectObjectTypes,
          playerModels,
          playerCapacity: resolvePackagePlayerCapacity(map, active.pluginId),
          assets: packageAssets,
          modeDataExporter,
          mergeDeps: { resolveWeapon: (id) => weaponIds.has(id) },
          engineVersion: project.engineVersion,
          outputDirectory: sourceDir,
        });
        // The worker bakes the WIRE package (the encoded JSON every runtime
        // host hands the plugin, ADR-0030), never decoded class instances.
        const wire = JSON.parse(
          JSON.stringify(Schema.encodeSync(RuntimeMapPackage)(assembled.mapPackage)),
        ) as JsonObject;
        mapPackages.push({
          mapId: rawMapId,
          packageId: String(assembled.mapPackage.manifest.packageId),
          sourceDir,
          mapPackage: wire,
        });
      }
      return mapPackages;
    });

    const buildGame = Effect.fn("BuildService.buildGame")(function* (options: GameBuildOptions) {
      const pluginId = Schema.decodeUnknownSync(PluginId)(options.pluginId);
      const [verified] = yield* registry.verify(pluginId).pipe(
        Effect.mapError(
          (error) =>
            new ServicesBuildError({
              path: Option.none(),
              message: error.message,
            }),
        ),
      );
      if (!verified?.ok) {
        yield* Effect.fail(
          new ServicesBuildError({
            path: Option.none(),
            message: verified?.message ?? `plugin not installed: ${options.pluginId}`,
          }),
        );
      }
      const plugins = yield* registry.list().pipe(
        Effect.mapError(
          (error) =>
            new ServicesBuildError({
              path: Option.none(),
              message: error.message,
            }),
        ),
      );
      const installed = plugins.find((plugin) => plugin.id === pluginId);
      if (!installed) {
        yield* Effect.fail(
          new ServicesBuildError({
            path: Option.none(),
            message: `plugin not installed: ${options.pluginId}`,
          }),
        );
      }
      const target = options.target;
      const directory =
        Option.isSome(options.outputDirectory)
          ? options.outputDirectory.value
          : yield* verifiedChildPath(root, "games", `game-host-${target}`);
      yield* ensureDirectory(directory);
      const createdAt = new Date().toISOString();

      // Both targets share ONE export assembly (M5 S2): the canonical
      // game-host artifact (worker.js + plugin runtime + map packages +
      // assets + manifest). `local` only adds the serve convention on top.
      const manifestPath = yield* verifiedChildPath(directory, gameBuildMetadataFileName);
      const paths = yield* home.init().pipe(
        Effect.mapError(
          (error) =>
            new ServicesBuildError({
              path: Option.none(),
              message: error.message,
            }),
        ),
      );
      const assetPackIds = Option.getOrElse(options.assetPackIds, () => [] as readonly string[]);
      const resolvedPacks: {
        readonly id: string;
        readonly version: string;
        readonly root: string;
        readonly files: readonly { readonly relativePath: string }[];
      }[] = [];
      for (const rawPackId of assetPackIds) {
        const packId = Schema.decodeUnknownSync(PackId)(rawPackId);
        const manifest = yield* assets.getPack(packId).pipe(
          Effect.mapError(
            (error) =>
              new ServicesBuildError({
                path: Option.none(),
                message: error.message,
              }),
          ),
        );
        const packRoot = path.join(paths.assets, "packs", `${manifest.id}-${manifest.version}`);
        resolvedPacks.push({
          id: manifest.id,
          version: manifest.version,
          root: packRoot,
          files: manifest.assets.map((asset) => ({ relativePath: asset.path })),
        });
      }
      const siteName = Option.getOrElse(options.siteName, () => "tileborne-game-host");
      const runtimeVersion = yield* readRuntimeVersion();
      const mapPackages = Option.isSome(options.projectId)
        ? yield* assembleShipMapPackages({
            directory,
            pluginId,
            pluginRootPath: installed!.rootPath,
            projectId: Schema.decodeUnknownSync(ProjectId)(options.projectId.value),
            mapIds: options.mapIds,
            assetsRoot: paths.assets,
          })
        : [];
      // A cloudflare artifact with zero bundled maps deploys a host whose
      // packageless `POST /rooms/create` always 400s. Builds without
      // `--project` stay legal (worker-only / asset-only bundles), but the
      // gap must be loud, never silent. Written to stderr so the CLI's
      // machine-readable `--json` stdout stays intact.
      if (target === "cloudflare" && mapPackages.length === 0) {
        yield* Effect.sync(() => {
          process.stderr.write(
            "warning: game build (cloudflare) bundled zero runtime map packages — the deployed host cannot create rooms. Pass --project <slug> (and optionally --map <id>) to bake the project's maps into the artifact.\n",
          );
        });
      }
      const buildResult = yield* Effect.tryPromise({
        try: () =>
          buildCloudflareGameHost({
            outDir: directory,
            pluginId,
            pluginVersion: installed!.version,
            pluginRoot: installed!.rootPath,
            assetPacks: resolvedPacks,
            mapPackages,
            runtimeVersion,
            siteName,
            createdAt,
          }),
        catch: (cause) =>
          new ServicesBuildError({
            path: Option.some(directory),
            message: errorMessage(cause),
          }),
      });
      const files = [...buildResult.files];
      if (target === "local") {
        yield* writeTextFile(
          yield* verifiedChildPath(directory, "README.md"),
          localServeReadme({ pluginId, directory: buildResult.outDir, createdAt }),
        );
        files.push("README.md");
      }
      const artifact = new GameBuildArtifact({
        pluginId,
        target,
        directory: buildResult.outDir,
        manifestPath: path.join(buildResult.outDir, "manifest.json"),
        bundlePath: buildResult.bundlePath,
        integrityHash: buildResult.manifestHash,
        createdAt,
        files,
      });
      yield* writeVerifiedJson(manifestPath, GameBuildArtifact, artifact);
      yield* PubSub.publish(events, void 0);
      return artifact;
    });

    return {
      build,
      buildGame,
      getBuild,
      listBuilds,
      deleteBuild,
      subscribe: Stream.fromPubSub(events),
    };
  }),
);

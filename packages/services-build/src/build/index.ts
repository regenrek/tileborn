import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  AssetPackManifest,
  validateLicenseRedistribution,
} from "@tileborne/asset-pipeline";
import {
  BuildId,
  type ContentHash,
  GameObjectCatalog,
  MapId,
  PackId,
  PluginId,
  PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY,
  ProjectId,
  RuntimeMapPackage,
  TileborneMap,
  hashJsonStable,
  makeCatalogId,
  type JsonObject,
  type Uuid,
} from "@tileborne/core";
import {
  buildCloudflareGameHost,
  hashBundleFile,
  type CloudflareGameHostMapPackageInput,
} from "@tileborne/game-host/build";
import {
  decodeProjectContentDocument,
  discoverGameModes,
  ProjectContentDocument,
  resolveActiveGameMode,
  resolveBehaviorAuthoringRegistry,
  resolveEffectiveProjectContent,
  runtimeProjectContentFromDocument,
  WeaponCatalog,
} from "@tileborne/plugin-api";
import type { RuntimeCatalogPluginSource } from "@tileborne/runtime/map-package";
import { PluginLoaderService, PluginRegistryService } from "@tileborne/services-plugin";
import {
  AssetService,
  MapService,
  ProjectAudioService,
  ProjectBehaviorService,
  ProjectGameShellService,
  ProjectService,
} from "@tileborne/services-app";
import { HomeService, JobId, JobService } from "@tileborne/services-foundation";
import { TILEBORNE_RUNTIME_VERSION } from "@tileborne/runtime";
import { Context, Effect, Layer, Option, PubSub, Result, Schema, Stream } from "effect";

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
import { compileProjectBehaviorPackage } from "../behavior/project-package.js";

const gameBuildMetadataFileName = "build-artifact.json";

const validateRedistributableAssetPack = (
  manifest: AssetPackManifest,
): Result.Result<AssetPackManifest, ServicesBuildError> => {
  const packLicenseResult = validateLicenseRedistribution(manifest.license);
  if (Result.isFailure(packLicenseResult)) {
    return Result.fail(
      new ServicesBuildError({
        path: Option.some(`assetPacks.${manifest.id}.license`),
        message: `${packLicenseResult.failure.message}. Open Asset library > ${manifest.name} to update license metadata or remove the pack from this build.`,
      }),
    );
  }

  for (const asset of manifest.assets) {
    if (Option.isNone(asset.license)) {
      continue;
    }
    const assetLicenseResult = validateLicenseRedistribution(asset.license.value);
    if (Result.isFailure(assetLicenseResult)) {
      return Result.fail(
        new ServicesBuildError({
          path: Option.some(`assetPacks.${manifest.id}.assets.${asset.id}.license`),
          message: `${assetLicenseResult.failure.message} for ${asset.path}. Open Asset library > ${manifest.name} > ${asset.path} to update license metadata or remove the pack from this build.`,
        }),
      );
    }
  }

  return Result.succeed(manifest);
};

export interface BuildPromotionOperations {
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly remove: (target: string) => Promise<void>;
}

export interface BuildServiceRuntimeOptions {
  /** Portable Game Host assembly assets owned by the embedding runtime. */
  readonly gameHostBuildAssetsRoot?: string;
}

export const nodeBuildPromotionOperations: BuildPromotionOperations = {
  rename: (from, to) => rename(from, to),
  remove: (target) => rm(target, { recursive: true, force: true }),
};

const isNotFoundError = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";

const artifactFilesMatch = async (
  directory: string,
  fileHashes: Readonly<Record<string, ContentHash>>,
): Promise<boolean> => {
  try {
    return (await Promise.all(
      Object.entries(fileHashes).map(async ([relativePath, expected]) =>
        await hashBundleFile(path.join(directory, relativePath)) === expected,
      ),
    )).every(Boolean);
  } catch {
    return false;
  }
};

/** Shared crash-safe transaction for both managed and explicit Ship outputs. */
export const promoteBuildDirectory = async (input: {
  readonly directory: string;
  readonly workDirectory: string;
  readonly fileHashes: Readonly<Record<string, ContentHash>>;
  readonly operations?: BuildPromotionOperations;
}): Promise<"promoted" | "reused"> => {
  const operations = input.operations ?? nodeBuildPromotionOperations;
  if (await artifactFilesMatch(input.directory, input.fileHashes)) {
    await operations.remove(input.workDirectory);
    return "reused";
  }

  const backup = `${input.directory}.previous-${randomUUID()}`;
  let backedUp = false;
  try {
    try {
      await operations.rename(input.directory, backup);
      backedUp = true;
    } catch (cause) {
      if (!isNotFoundError(cause)) throw cause;
    }
    await operations.rename(input.workDirectory, input.directory);
    if (backedUp) await operations.remove(backup);
    return "promoted";
  } catch (cause) {
    if (backedUp) {
      await operations.remove(input.directory);
      await operations.rename(backup, input.directory);
    }
    throw cause;
  }
};

export const gameArtifactBuildId = (input: {
  readonly target: GameBuildArtifact["target"];
  readonly fileHashes: Readonly<Record<string, ContentHash>>;
}): ContentHash =>
  hashJsonStable({
    schemaVersion: 1,
    target: input.target,
    files: Object.entries(input.fileHashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relativePath, hash]) => ({ path: relativePath, hash })),
  });

export interface ShipRuntimeMapPackagesObserver {
  readonly onPackageCopied?: ((input: { readonly files: number }) => void) | undefined;
  readonly onArtifactPromoted?: (() => void) | undefined;
  readonly onIntegrityTraversal?: ((input: { readonly files: number }) => void) | undefined;
}

export interface ShipRuntimeMapPackagesInput {
  readonly packageDirectories: readonly string[];
  readonly directory: string;
  readonly operations?: BuildPromotionOperations | undefined;
  readonly observer?: ShipRuntimeMapPackagesObserver | undefined;
}

export interface ShipRuntimeMapPackagesReport {
  readonly runtimeMapPackages: number;
  readonly artifactFiles: number;
  readonly artifactBytes: number;
  readonly promotions: number;
  readonly integrityTraversals: number;
}

const listArtifactFiles = async (root: string): Promise<readonly string[]> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await visit(root);
  return files.sort();
};

/** Canonical BuildService path for copying, promoting, and verifying complete runtime packages. */
export const shipRuntimeMapPackages = async (
  input: ShipRuntimeMapPackagesInput,
): Promise<ShipRuntimeMapPackagesReport> => {
  const workDirectory = `${input.directory}.building-${randomUUID()}`;
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(workDirectory, { recursive: true });
  let promotions = 0;
  let integrityTraversals = 0;
  try {
    for (const [index, source] of input.packageDirectories.entries()) {
      const sourceFiles = await listArtifactFiles(source);
      await cp(source, path.join(workDirectory, 'maps', String(index)), { recursive: true });
      input.observer?.onPackageCopied?.({ files: sourceFiles.length });
    }
    const workFiles = await listArtifactFiles(workDirectory);
    const fileHashes: Record<string, ContentHash> = {};
    for (const file of workFiles) {
      fileHashes[path.relative(workDirectory, file)] = await hashBundleFile(file);
    }
    const promotion = await promoteBuildDirectory({
      directory: input.directory,
      workDirectory,
      fileHashes,
      ...(input.operations === undefined ? {} : { operations: input.operations }),
    });
    if (promotion === 'promoted') {
      promotions += 1;
      input.observer?.onArtifactPromoted?.();
    }

    const finalFiles = await listArtifactFiles(input.directory);
    integrityTraversals += 1;
    input.observer?.onIntegrityTraversal?.({ files: finalFiles.length });
    let artifactBytes = 0;
    for (const file of finalFiles) {
      artifactBytes += (await stat(file)).size;
      const relative = path.relative(input.directory, file);
      if ((await hashBundleFile(file)) !== fileHashes[relative]) {
        throw new Error(`post-promotion integrity mismatch: ${relative}`);
      }
    }
    return {
      runtimeMapPackages: input.packageDirectories.length,
      artifactFiles: finalFiles.length,
      artifactBytes,
      promotions,
      integrityTraversals,
    };
  } catch (cause) {
    await rm(workDirectory, { recursive: true, force: true });
    throw cause;
  }
};

/**
 * Serve instructions baked into the `local` target artifact (M5 S2): the
 * single command a non-cloudflare user runs to boot this directory into a
 * joinable game-host.
 */
const localServeReadme = (input: {
  readonly pluginId: string;
  readonly createdAt: string;
}): string => `# Tileborne game-host (local build)

Plugin: ${input.pluginId}
Built:  ${input.createdAt}

Serve this directory locally (no Cloudflare account required):

    tileborne game serve --dir .

The command prints a base URL once the host is ready. Create a joinable room:

    curl -X POST <baseUrl>/rooms/create \\
      -H 'content-type: application/json' \\
      -d '{"mapId":"<mapId>"}'

Bundled maps (and their ids) are listed in manifest.json under "maps".
Deployment adapters are described in deployment.json. Local is the default
adapter. Cloudflare deployment is owned by the Alchemy Cloudflare adapter, which
uses provider-native credentials and owns any Wrangler-compatible config files.
`;

export class BuildService extends Context.Service<BuildService, {
  readonly build: (projectId: ProjectId, options?: BuildOptions) => Effect.Effect<JobId>;
  readonly buildGame: (options: GameBuildOptions) => Effect.Effect<GameBuildArtifact, ServicesBuildError>;
  readonly verifyGameArtifact: (artifact: GameBuildArtifact | string) => Effect.Effect<GameBuildArtifact, ServicesBuildError | IntegrityMismatchError>;
  readonly shipRuntimeMapPackages: (
    input: ShipRuntimeMapPackagesInput,
  ) => Effect.Effect<ShipRuntimeMapPackagesReport, ServicesBuildError>;
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

export const makeBuildServiceLive = (
  promotionOperations: BuildPromotionOperations = nodeBuildPromotionOperations,
  runtimeOptions: BuildServiceRuntimeOptions = {},
) => Layer.effect(
  BuildService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const jobs = yield* JobService;
    const registry = yield* PluginRegistryService;
    const loader = yield* PluginLoaderService;
    const assets = yield* AssetService;
    const projects = yield* ProjectService;
    const projectAudio = yield* ProjectAudioService;
    const projectGameShell = yield* ProjectGameShellService;
    const projectBehaviors = yield* ProjectBehaviorService;
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
      readonly signal: AbortSignal;
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
      const fragmentRaw = project.settings?.[PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY];
      const projectContent = fragmentRaw === undefined
        ? new ProjectContentDocument({
            schemaVersion: 1,
            catalog: new GameObjectCatalog({
              id: makeCatalogId(input.projectId.slice('project:'.length) as Uuid),
              schemaVersion: 1,
              objectTypes: [],
              lootTables: Option.some([]),
              items: Option.some([]),
            }),
            weapons: new WeaponCatalog({ schemaVersion: 1, weapons: [] }),
            weaponLabels: {},
            provenance: {},
          })
        : yield* (() => {
            const decoded = decodeProjectContentDocument(fragmentRaw);
            return Result.isSuccess(decoded)
              ? Effect.succeed(decoded.success)
              : serviceError(`project content is invalid: ${decoded.failure.message}`);
          })();
      const effective = resolveEffectiveProjectContent(
        declarative.map((plugin) => ({
          pluginId: plugin.pluginId,
          gameObjectCatalogs: plugin.gameObjectCatalogs,
          weaponCatalogs: plugin.weaponCatalogs,
        })),
        projectContent,
      );
      if (Result.isFailure(effective)) {
        return yield* serviceError(
          effective.failure._tag === 'WeaponCatalogContributionValidationError'
            ? effective.failure.issues.join('; ')
            : effective.failure.message,
        );
      }
      const pluginCatalogs = effective.success.pluginCatalogs
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
        const licenseResult = validateRedistributableAssetPack(manifest);
        if (Result.isFailure(licenseResult)) {
          return yield* Effect.fail(licenseResult.failure);
        }
        packSources.push({
          manifest,
          root: path.join(input.assetsRoot, "packs", `${manifest.id}-${manifest.version}`),
        });
      }
      const packageAssets = yield* collectRuntimeMapPackageAssets(packSources);
      const audioProjection = yield* projectAudio.project(input.projectId, (source) => {
        if (source.url !== undefined) return source;
        if (source.packId !== undefined) {
          const pack = packSources.find(
            (candidate) =>
              String(candidate.manifest.id) === source.packId &&
              String(candidate.manifest.version) === source.packVersion,
          );
          if (pack === undefined) return undefined;
          const packAsset = pack.manifest.assets.find((asset) =>
            source.assetId !== undefined
              ? String(asset.id) === source.assetId
              : asset.path === source.path,
          );
          if (packAsset === undefined) return undefined;
          const packagedPath = `assets/packs/${pack.manifest.id}-${pack.manifest.version}/${packAsset.path}`;
          const packaged = packageAssets.find((asset) => asset.path === packagedPath);
          return packaged === undefined ? undefined : { ...source, url: packaged.path };
        }
        if (source.assetId !== undefined) {
          const packaged = packageAssets.find((asset) => asset.assetId === source.assetId);
          if (packaged !== undefined) return { ...source, url: packaged.path };
        }
        if (source.path !== undefined) {
          const normalized = source.path.startsWith("assets/")
            ? source.path
            : `assets/${source.path}`;
          const packaged = packageAssets.find((asset) => asset.path === normalized);
          return packaged === undefined ? undefined : { ...source, url: packaged.path };
        }
        return undefined;
      }).pipe(
        Effect.mapError((error) => serviceError(error.message, "audio")),
      );
      const blockingAudioDiagnostics = audioProjection.diagnostics.filter(
        (issue) =>
          issue.code === "missing-label" ||
          issue.code === "missing-source" ||
          issue.code === "unresolved-packaged-source",
      );
      if (blockingAudioDiagnostics.length > 0) {
        return yield* serviceError(
          `audio packaging failed: ${blockingAudioDiagnostics
            .map((issue) => `${issue.code}: ${issue.message}`)
            .join("; ")}`,
          blockingAudioDiagnostics[0]?.path ?? "audio",
        );
      }

      const behaviorSnapshot = yield* projectBehaviors.open(input.projectId).pipe(
        Effect.mapError((error) => serviceError(
          error.message,
          'path' in error ? error.path : 'behaviors',
        )),
      );
      const projectPluginIds = new Set(project.plugins.map(({ id }) => String(id)));
      const behaviorRegistry = resolveBehaviorAuthoringRegistry(
        enabled
          .filter(({ id }) => projectPluginIds.has(String(id)))
          .map(({ id, manifest }) => ({ pluginId: id, contributions: manifest.contributes })),
      ).registry;
      const compiledBehaviors = yield* Effect.tryPromise({
        try: () => compileProjectBehaviorPackage(
          behaviorSnapshot,
          behaviorRegistry,
        ),
        catch: (cause) => serviceError(
          cause instanceof Error ? cause.message : String(cause),
          'behaviors',
        ),
      });
      if (!compiledBehaviors.ok || compiledBehaviors.behaviorPackage === undefined) {
        return yield* serviceError(
          `behavior compilation failed: ${compiledBehaviors.diagnostics
            .map((entry) => `${entry.code}: ${entry.message}`)
            .join('; ')}`,
          compiledBehaviors.diagnostics[0]?.fileName ?? 'behaviors',
        );
      }

      const projectMapIds = project.maps.map((ref) => ref.id);
      const selectedIds = Option.getOrElse(input.mapIds, () => projectMapIds);
      if (selectedIds.length === 0) {
        return yield* serviceError(`project ${input.projectId} has no maps to ship`);
      }
      const shellProjection = yield* projectGameShell.project(input.projectId).pipe(
        Effect.mapError((error) => serviceError(error.message, "shell")),
      );
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
          projectObjectTypes: effective.success.projectObjectTypes,
          projectContent: runtimeProjectContentFromDocument(projectContent),
          playerModels,
          playerCapacity: resolvePackagePlayerCapacity(map, active.pluginId),
          assets: packageAssets,
          behaviors: compiledBehaviors.behaviorPackage,
          audio: JSON.parse(
            JSON.stringify({
              schemaVersion: 1,
              buses: audioProjection.buses,
              cues: audioProjection.cues,
              diagnostics: audioProjection.diagnostics,
              settings: audioProjection.settings,
            }),
          ) as JsonObject,
          behaviorModules: compiledBehaviors.modules ?? [],
          modeDataExporter,
          mergeDeps: { resolveWeapon: (id) => effective.success.weaponIds.has(id) },
          engineVersion: project.engineVersion,
          outputDirectory: sourceDir,
          signal: input.signal,
        });
        const shellJsonPath = yield* verifiedChildPath(sourceDir, "shell.json");
        yield* writeTextFile(shellJsonPath, `${JSON.stringify(shellProjection, null, 2)}\n`);
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
      const requestedDirectory = Option.isSome(options.outputDirectory)
        ? path.resolve(options.outputDirectory.value)
        : undefined;
      const gamesRoot = yield* verifiedChildPath(root, "games");
      yield* ensureDirectory(gamesRoot);
      const workDirectory = requestedDirectory === undefined
        ? yield* verifiedChildPath(gamesRoot, `.building-${randomUUID()}`)
        : `${requestedDirectory}.building-${randomUUID()}`;
      const createdAt = "1970-01-01T00:00:00.000Z";
      const abortController = new AbortController();

      return yield* Effect.gen(function* () {
      // Staging creation itself is inside the ensuring scope: cancellation or
      // failure delivered as mkdir completes cannot strand a .building tree.
      yield* ensureDirectory(workDirectory);
      const e2eAssemblyDelay = process.env["TILEBORNE_E2E"] === "1"
        ? Number(process.env["TILEBORNE_E2E_SHIP_ASSEMBLY_DELAY_MS"] ?? 0)
        : 0;
      if (Number.isFinite(e2eAssemblyDelay) && e2eAssemblyDelay > 0) {
        yield* Effect.sleep(e2eAssemblyDelay);
      }

      // Both targets share ONE export assembly (M5 S2): the canonical
      // game-host artifact (worker.js + plugin runtime + map packages +
      // assets + manifest). `local` only adds the serve convention on top.
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
        const licenseResult = validateRedistributableAssetPack(manifest);
        if (Result.isFailure(licenseResult)) {
          return yield* Effect.fail(licenseResult.failure);
        }
        const packRoot = path.join(paths.assets, "packs", `${manifest.id}-${manifest.version}`);
        resolvedPacks.push({
          id: manifest.id,
          version: manifest.version,
          root: packRoot,
          files: manifest.assets.map((asset) => ({ relativePath: asset.path })),
        });
      }
      const siteName = Option.getOrElse(options.siteName, () => "tileborne-game-host");
      const runtimeVersion = TILEBORNE_RUNTIME_VERSION;
      const mapPackages = Option.isSome(options.projectId)
        ? yield* assembleShipMapPackages({
            directory: workDirectory,
            pluginId,
            pluginRootPath: installed!.rootPath,
            projectId: Schema.decodeUnknownSync(ProjectId)(options.projectId.value),
            mapIds: options.mapIds,
            assetsRoot: paths.assets,
            signal: abortController.signal,
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
        try: (signal) => {
          if (signal.aborted) abortController.abort();
          else signal.addEventListener("abort", () => abortController.abort(), { once: true });
          const buildInput = {
            outDir: workDirectory,
            ...(runtimeOptions.gameHostBuildAssetsRoot === undefined
              ? {}
              : { buildAssetsRoot: runtimeOptions.gameHostBuildAssetsRoot }),
            pluginId,
            pluginVersion: installed!.version,
            pluginRoot: installed!.rootPath,
            assetPacks: resolvedPacks,
            mapPackages,
            runtimeVersion,
            siteName,
            createdAt,
            signal: abortController.signal,
          };
          return buildCloudflareGameHost(buildInput);
        },
        catch: (cause) =>
          new ServicesBuildError({
            path: Option.some(workDirectory),
            message: errorMessage(cause),
          }),
      });
      const files = [...buildResult.files];
      const fileHashes: Record<string, ContentHash> = { ...buildResult.fileHashes };
      if (target === "local") {
        const readmePath = yield* verifiedChildPath(workDirectory, "README.md");
        yield* writeTextFile(readmePath, localServeReadme({ pluginId, createdAt }));
        files.push("README.md");
        fileHashes["README.md"] = yield* Effect.tryPromise({
          try: () => hashBundleFile(readmePath),
          catch: (cause) => serviceError(errorMessage(cause), readmePath),
        });
      }
      const buildId = gameArtifactBuildId({ target, fileHashes });
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const directory = requestedDirectory === undefined
            ? yield* verifiedChildPath(
                gamesRoot,
                `game-host-${target}-${String(buildId).slice("sha256:".length)}`,
              )
            : requestedDirectory;
          const artifact = new GameBuildArtifact({
            pluginId,
            target,
            directory,
            manifestPath: path.join(directory, "manifest.json"),
            bundlePath: path.join(directory, path.basename(buildResult.bundlePath)),
            buildId,
            runtimeBuildId: buildResult.manifestHash,
            integrityHash: emptyContentHash,
            createdAt,
            files,
            fileHashes,
          });
          const workMetadataPath = path.join(workDirectory, gameBuildMetadataFileName);
          const integrityHash = yield* writeVerifiedJson(workMetadataPath, GameBuildArtifact, artifact);
          const completedArtifact = new GameBuildArtifact({ ...artifact, integrityHash });
          const metadataHash = yield* Effect.tryPromise({
            try: () => hashBundleFile(workMetadataPath),
            catch: (cause) => serviceError(errorMessage(cause), workMetadataPath),
          });
          yield* Effect.tryPromise({
            try: () => promoteBuildDirectory({
              directory,
              workDirectory,
              fileHashes: { ...fileHashes, [gameBuildMetadataFileName]: metadataHash },
              operations: promotionOperations,
            }),
            catch: (cause) =>
              new ServicesBuildError({
                path: Option.some(directory),
                message: `failed to promote completed artifact: ${errorMessage(cause)}`,
              }),
          });
          yield* PubSub.publish(events, void 0);
          return completedArtifact;
        }),
      );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => abortController.abort()).pipe(
            Effect.andThen(deleteDirectory(workDirectory).pipe(Effect.catch(() => Effect.void))),
          ),
        ),
      );
    });

    const verifyGameArtifact = Effect.fn("BuildService.verifyGameArtifact")(function* (
      candidate: GameBuildArtifact | string,
    ) {
      const gamesRoot = yield* verifiedChildPath(root, "games");
      const requestedDirectory = typeof candidate === "string" ? candidate : candidate.directory;
      const resolvedDirectory = path.resolve(requestedDirectory);
      const relative = path.relative(gamesRoot, resolvedDirectory);
      if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
        return yield* serviceError(
          `game artifact is outside the managed build root: ${requestedDirectory}`,
          requestedDirectory,
        );
      }
      const directory = yield* verifiedChildPath(gamesRoot, relative);
      const metadataPath = yield* verifiedChildPath(directory, gameBuildMetadataFileName);
      const durable = yield* readVerifiedJson(metadataPath, GameBuildArtifact);
      if (
        durable.directory !== directory ||
        durable.manifestPath !== path.join(directory, "manifest.json") ||
        durable.bundlePath !== path.join(directory, "worker.js")
      ) {
        return yield* serviceError("game artifact contains non-canonical paths", metadataPath);
      }
      if (typeof candidate !== "string" && (
        candidate.directory !== durable.directory ||
        candidate.pluginId !== durable.pluginId ||
        candidate.target !== durable.target ||
        candidate.buildId !== durable.buildId ||
        candidate.runtimeBuildId !== durable.runtimeBuildId ||
        candidate.integrityHash !== durable.integrityHash
      )) {
        return yield* serviceError("game artifact request does not match its durable record", metadataPath);
      }
      const expectedFiles = new Set(durable.files);
      if (
        expectedFiles.size !== durable.files.length ||
        Object.keys(durable.fileHashes).length !== durable.files.length ||
        Object.keys(durable.fileHashes).some((file) => !expectedFiles.has(file))
      ) {
        return yield* serviceError("game artifact file inventory is inconsistent", metadataPath);
      }
      for (const relativePath of durable.files) {
        const filePath = yield* verifiedChildPath(directory, relativePath);
        const expected = durable.fileHashes[relativePath];
        if (expected === undefined) {
          return yield* serviceError(`missing final file hash for ${relativePath}`, metadataPath);
        }
        const actual = yield* Effect.tryPromise({
          try: () => hashBundleFile(filePath),
          catch: (cause) => serviceError(errorMessage(cause), filePath),
        });
        if (actual !== expected) {
          return yield* new IntegrityMismatchError({
            path: filePath,
            expected,
            actual,
            message: `game artifact file integrity mismatch: ${relativePath}`,
          });
        }
      }
      const actualBuildId = gameArtifactBuildId({
        target: durable.target,
        fileHashes: durable.fileHashes,
      });
      if (actualBuildId !== durable.buildId) {
        return yield* new IntegrityMismatchError({
          path: metadataPath,
          expected: durable.buildId,
          actual: actualBuildId,
          message: "game artifact identity does not match its final file inventory",
        });
      }
      const manifest = yield* Effect.tryPromise({
        try: async () => JSON.parse(await readFile(durable.manifestPath, "utf8")) as { readonly buildId?: unknown },
        catch: (cause) => serviceError(errorMessage(cause), durable.manifestPath),
      });
      if (manifest.buildId !== durable.runtimeBuildId) {
        return yield* serviceError("manifest buildId does not match the durable artifact record", durable.manifestPath);
      }
      return durable;
    });

    const shipPackages = Effect.fn("BuildService.shipRuntimeMapPackages")(function* (
      input: ShipRuntimeMapPackagesInput,
    ) {
      return yield* Effect.tryPromise({
        try: () => shipRuntimeMapPackages(input),
        catch: (cause) => buildError(errorMessage(cause)),
      });
    });

    return {
      build,
      buildGame,
      verifyGameArtifact,
      shipRuntimeMapPackages: shipPackages,
      getBuild,
      listBuilds,
      deleteBuild,
      subscribe: Stream.fromPubSub(events),
    };
  }),
);

export const BuildServiceLive = makeBuildServiceLive();

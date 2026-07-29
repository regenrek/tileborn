import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { app, dialog, shell } from 'electron';
import { Deferred, Effect, Option, Schema, Stream } from 'effect';

import { AssetPackManifest } from '@tileborne/asset-pipeline';
import {
  AssetBehaviorReference,
  hashJsonStable,
  CatalogBehaviorReference,
  EntityBehaviorReference,
  NestedBehaviorReference,
  ProjectAssetPackRef,
  ProjectManifest,
  PROJECT_SHIP_TARGET_SETTINGS_KEY,
  PROJECT_STARTUP_MAP_SETTINGS_KEY,
  ProjectPluginRef,
  type ContentHash,
  type BehaviorId,
  type BehaviorReference,
  type GameModeId,
  type JsonObject,
  type MapId,
  type PackId,
  type PlayerModelRef,
  type ProjectId,
  type TileborneMap,
} from '@tileborne/core';
import {
  MainEventRegistry,
  MainIpcRegistry,
  PlaytestRuntimeMetrics as PlaytestRuntimeMetricsSchema,
  defineHandlers,
  handlerBuilder,
  registerIpcEvents,
  registerIpcHandlers,
  type RegisteredEventHandlers,
  type RegisteredHandlers,
  type BehaviorReferenceKind,
} from '@tileborne/ipc-contracts';
import {
  AssetLibraryService,
  AssetService,
  MapService,
  ProjectAudioService,
  ProjectBehaviorService,
  ProjectGameShellService,
  ProjectService,
  WorkingPaletteService,
  removeAssetPack,
  toMapIpcPayload,
  type AssetPackWithCapability,
  type ProjectBehaviorSnapshot,
} from '@tileborne/services-app';
import {
  applyAudioAuthoringCommand,
  audioAuthoringStateFromDocument,
  buildRuntimeGameShellProjection,
  decodeProjectAudioDocument,
  decodeProjectGameShellDocument,
  gameShellStateFromDocument,
  resolveRuntimeAudioSource,
  type GameShellAssetRefDefinition,
} from '@tileborne/runtime';
import {
  BuildService,
  ExportService,
  ExportTarget,
  GameBuildArtifact,
  GameBuildOptions,
  PlaytestService,
  PlaytestSessionNotFoundError,
  RuntimeDeployService,
  RuntimeDeployTarget,
  activePlaytestPluginIds,
  assembleRuntimeMapPackage,
  compileProjectBehaviorModule,
  compileProjectBehaviorPackage,
  generateTypeScriptBehaviorSource,
  loadPluginModeDataExporter,
  resolvePackagePlayerCapacity,
  SupportService,
  type PlaytestSession,
} from '@tileborne/services-build';
import { HomeService, JobService, type JobId, type JobState } from '@tileborne/services-foundation';
import { LoggerService } from '@tileborne/services-foundation';
import {
  PluginInstallerService,
  PluginRegistryService,
  PluginSource,
  type InstalledPlugin,
} from '@tileborne/services-plugin';
import {
  PluginContributions,
  discoverGameModes,
  resolveBehaviorAuthoringRegistry,
  resolveActiveGameMode,
  type GameModeDescriptor,
  type PluginPanelContribution,
  type PluginToolContribution,
} from '@tileborne/plugin-api';
import {
  compileTiledSourceRulePipeline,
  projectTiledSourceRuleApplication,
} from '@tileborne/sdk-tileset/tiled-source-rules';
import type { TiledImportProfile } from '@tileborne/sdk-tileset/tiled';

import { ipcCatchAll } from './errors.js';
import {
  gameShellDefaultsInvalidReadinessDiagnostic,
  resolveInstalledGameShellDefaults,
} from '../game-shell-defaults.js';
import {
  importSourceDialogFilters,
  SPRITE_SHEET_IMAGE_EXTENSIONS,
  TILED_MAP_SOURCE_EXTENSIONS,
  TILED_TILESET_SOURCE_EXTENSIONS,
} from './import-source-dialog.js';
import { createElectronIpcServerTransport } from './transport.js';
import { createDesktopUpdateHandlers } from './desktop-update-handlers.js';
import { createDesktopUpdaterController, type DesktopUpdaterController } from '../updater.js';
import {
  clearPlaytestRuntimeInput,
  controlPlaytestRuntimeLifecycle,
  controlPlaytestBehaviorDebug,
  emitPlaytestShellBehaviorEvent,
  getPlaytestBehaviorDebugSnapshot,
  getPlaytestRuntimeMetrics,
  getPlaytestRuntimeSnapshot,
  hotReloadPlaytestBehavior,
  loadPlaytestMapPackage,
  rejectPlaytestBehaviorReload,
  setPlaytestRuntimeChangedNotifier,
  setPlaytestRuntimeInput,
  setPlaytestRuntimeSnapshotNotifier,
  startPlaytestRuntimeHost,
  stopOwnedPlaytestRuntimeHost,
} from '../playtest-runtime-host.js';
import { CatalogService } from '../catalog/index.js';
import { startDesktopLocalGameHost, stopDesktopLocalGameHost } from '../local-game-host-manager.js';
import { invokePluginEditorCommand } from '../plugin-editor-command.js';
import { bundledBattleRoyalePluginSpec, bundledPluginSpec } from '../bundled-plugins.js';
import { installBundledPluginWithServices } from '../seed-plugins.js';
import { seedBundledPluginAssetPacksWithServices } from '../seed-plugins.js';
import { appRuntime } from '../runtime.js';
import { createPlaytestJoinWindow } from '../window.js';
import {
  assetPackLicenseReadinessDiagnosticsForPurpose,
  assertExecutionReadiness,
  behaviorReadinessDiagnostics,
  diagnosePlayerModelReference,
  loadPluginMapValidator,
  makeReadinessReport,
  readinessDiagnostic,
  readinessNavigation,
} from '../readiness.js';
import { diagnoseVisualModelAuthoring } from '../../shared/visual-model-diagnostics.js';
import { buildAssetPackUseSites } from '../asset-use-sites.js';
import { resolveGameModeHostRegistration } from '../game-mode-host-registrations.js';
import { defaultGameModeStarterRegistration } from '../game-mode-starter-registrations.js';
import {
  BehaviorReferenceIndex,
  type IndexedBehaviorReferenceOption,
} from '../behavior-reference-index.js';
import {
  runDesktopProjectListLifecycle,
  runDesktopProjectReopenLifecycle,
} from '../project-lifecycle.js';

const triggerPayload = {};
const TILEBORNE_PACK_MANIFEST = 'tileborne-asset-pack.json';

const TILED_MAP_SOURCE_EXTENSION_SET = new Set(
  TILED_MAP_SOURCE_EXTENSIONS.map((extension) => `.${extension}`),
);
const TILED_TILESET_SOURCE_EXTENSION_SET = new Set(
  TILED_TILESET_SOURCE_EXTENSIONS.map((extension) => `.${extension}`),
);
const SPRITE_SHEET_IMAGE_EXTENSION_SET = new Set(
  SPRITE_SHEET_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
);
const ASSET_USE_SITE_MAP_SCAN_LIMIT = 128;
const ASSET_USE_SITE_RESULT_LIMIT = 200;

const safeStat = async (candidatePath: string) => {
  try {
    return await stat(candidatePath);
  } catch {
    return undefined;
  }
};

const detectTiledSources = async (
  rootPath: string,
  maxDepth = 5,
): Promise<{ readonly mapCount: number; readonly tilesetCount: number }> => {
  let mapCount = 0;
  let tilesetCount = 0;
  const scan = async (directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      const extension = path.extname(entry.name).toLowerCase();
      if (entry.isFile() && TILED_MAP_SOURCE_EXTENSION_SET.has(extension)) {
        mapCount += 1;
        continue;
      }
      if (entry.isFile() && TILED_TILESET_SOURCE_EXTENSION_SET.has(extension)) {
        tilesetCount += 1;
        continue;
      }
      if (entry.isDirectory() && depth > 0) {
        await scan(entryPath, depth - 1);
      }
    }
  };
  await scan(rootPath, maxDepth);
  return { mapCount, tilesetCount };
};

const toJsonObject = (value: unknown): JsonObject => {
  const encoded = JSON.stringify(value ?? {});
  return JSON.parse(encoded === undefined ? '{}' : encoded) as JsonObject;
};

const readActiveGameModeSetting = (settings: JsonObject | undefined): string | undefined => {
  const value = settings?.activeGameMode;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const resolveProjectGameMode = (
  project: ProjectManifest,
  installed: readonly InstalledPlugin[],
): GameModeDescriptor | undefined =>
  resolveActiveGameMode(
    discoverGameModes(
      installed
        .filter(({ enabled }) => enabled)
        .map(({ id, manifest }) => ({ pluginId: id, contributions: manifest.contributes })),
    ),
    readActiveGameModeSetting(project.settings) as GameModeId | undefined,
  );

const shellAssetResolverFromPacks =
  (installedPacks: readonly AssetPackWithCapability[]) => (asset: GameShellAssetRefDefinition) => {
    const pack = installedPacks.find(
      (entry) => String(entry.id) === asset.packId && entry.version === asset.packVersion,
    );
    if (pack === undefined) {
      return {
        ok: false,
        message: `Asset pack ${asset.packId}@${asset.packVersion} is not installed.`,
      };
    }
    const installed = pack.assets.find((entry) => String(entry.id) === asset.assetId);
    if (installed === undefined) {
      return { ok: false, message: `Asset ${asset.assetId} is not installed in ${asset.packId}.` };
    }
    if (installed.path !== asset.path) {
      return {
        ok: false,
        message: `Asset ${asset.assetId} path changed from ${asset.path} to ${installed.path}.`,
      };
    }
    if (installed.mime !== asset.mime) {
      return {
        ok: false,
        message: `Asset ${asset.assetId} type changed from ${asset.mime} to ${installed.mime}.`,
      };
    }
    return { ok: true };
  };

const toJobView = (job: JobState) => ({
  id: job.id,
  status: job.status._tag,
  progress: Option.getOrUndefined(job.progress),
  result: Option.getOrUndefined(job.result),
  errorMessage: Option.match(job.error, {
    onNone: () => undefined,
    onSome: (error) => error.message,
  }),
  logs: [...job.logs],
});

const parseLogEntries = (rawLines: readonly string[]) =>
  rawLines.flatMap((raw) => {
    try {
      const parsed = JSON.parse(raw) as { ts?: string; level?: string; msg?: string };
      if (
        typeof parsed.ts !== 'string' ||
        typeof parsed.level !== 'string' ||
        typeof parsed.msg !== 'string'
      ) {
        return [];
      }
      return [{ ts: parsed.ts, level: parsed.level, msg: parsed.msg }];
    } catch {
      return [{ ts: new Date(0).toISOString(), level: 'info', msg: raw }];
    }
  });

const toPluginSummary = (plugin: InstalledPlugin) => ({
  id: plugin.id,
  version: plugin.version,
  enabled: plugin.enabled,
  rootPath: plugin.rootPath,
  manifestPath: plugin.manifestPath,
});

const optionalField = <Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> =>
  value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);

const toPluginPanelContributionView = (
  plugin: InstalledPlugin,
  contribution: PluginPanelContribution,
) => ({
  pluginId: plugin.id,
  pluginName: plugin.manifest.displayName,
  id: contribution.id,
  zone: contribution.zone,
  title: contribution.title,
  ...optionalField('description', Option.getOrUndefined(contribution.description)),
  ...optionalField('group', Option.getOrUndefined(contribution.group)),
  ...optionalField('order', Option.getOrUndefined(contribution.order)),
  ...optionalField('capabilities', Option.getOrUndefined(contribution.capabilities)),
  ...optionalField('data', Option.getOrUndefined(contribution.data)),
});

const toPluginToolContributionView = (
  plugin: InstalledPlugin,
  contribution: PluginToolContribution,
) => ({
  pluginId: plugin.id,
  pluginName: plugin.manifest.displayName,
  id: contribution.id,
  zone: contribution.zone,
  title: contribution.title,
  ...optionalField('description', Option.getOrUndefined(contribution.description)),
  ...optionalField('group', Option.getOrUndefined(contribution.group)),
  ...optionalField('order', Option.getOrUndefined(contribution.order)),
  ...optionalField('commandId', Option.getOrUndefined(contribution.commandId)),
  ...optionalField('capabilities', Option.getOrUndefined(contribution.capabilities)),
  ...optionalField('data', Option.getOrUndefined(contribution.data)),
});

const toGameModeView = (descriptor: GameModeDescriptor) => ({
  modeId: descriptor.modeId,
  pluginId: descriptor.pluginId,
  label: descriptor.label,
  hasAuthoringPanel: descriptor.hasAuthoringPanel,
  creatorChecklistFacts: descriptor.creatorChecklistFacts.map((fact) => ({
    id: fact.id,
    label: fact.label,
    sources: [...fact.sources],
    ...optionalField('description', fact.description),
  })),
  ...optionalField('runtimeSystemId', descriptor.runtimeSystemId),
  ...optionalField('authoringSettingsPanelId', descriptor.authoringSettingsPanelId),
  ...optionalField('authoringCapabilityId', descriptor.authoringCapabilityId),
  ...optionalField('rendererCapabilityId', descriptor.rendererCapabilityId),
  ...optionalField('readinessCapabilityId', descriptor.readinessCapabilityId),
  ...optionalField('starterCapabilityId', descriptor.starterCapabilityId),
  ...optionalField('gameSettingsFormId', descriptor.gameSettingsFormId),
  ...optionalField('gameSettingsForm', descriptor.gameSettingsForm),
  ...optionalField('hudLayoutContributionId', descriptor.hudLayoutContributionId),
  ...optionalField('hudLayout', descriptor.hudLayout),
  ...optionalField('mapValidatorId', descriptor.mapValidatorId),
  ...optionalField('starter', descriptor.starter),
});

const formatPluginPermission = (permission: { readonly _tag: string }): string => permission._tag;

const toPackSummary = (pack: AssetPackWithCapability) => {
  const snapshot = {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    assets: pack.assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      mime: asset.mime,
      size: asset.size,
      hash: asset.hash,
    })),
  };
  return {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    licenseSpdxId: pack.license.spdxId,
    integrityHash: hashJsonStable(snapshot) as ContentHash,
    assetCount: pack.assets.length,
    capability: pack.capability,
  };
};

const installedPackRoot = (assetsRoot: string, pack: AssetPackManifest): string =>
  path.join(assetsRoot, 'packs', `${pack.id}-${pack.version}`);

const TILESET_MANIFEST_PATH = 'tileborne-asset-pack.json';

type IpcPlaytestRuntimeMetrics = Schema.Schema.Type<typeof PlaytestRuntimeMetricsSchema>;

const includeDiagnosticsEnabled = (
  includeDiagnostics: Option.Option<boolean> | undefined,
): boolean => includeDiagnostics === undefined || Option.getOrElse(includeDiagnostics, () => true);

const toPlaytestSessionView = (session: PlaytestSession) => {
  const artifactDirectory = Option.getOrUndefined(session.artifactDirectory);
  const runtimeMetrics = getPlaytestRuntimeMetrics(session.id);

  return {
    id: session.id,
    projectId: session.projectId,
    mapId: session.mapId,
    status: session.status._tag === 'Failed' ? ('Stopped' as const) : session.status._tag,
    ...(artifactDirectory !== undefined ? { artifactDirectory } : {}),
    activePlugins: session.activePlugins,
    ...(runtimeMetrics !== undefined
      ? { runtimeMetrics: runtimeMetrics as IpcPlaytestRuntimeMetrics }
      : {}),
  };
};

const wireTrigger = <E, R>(
  stream: Stream.Stream<unknown, E, R>,
  emit: (payload: typeof triggerPayload) => Effect.Effect<void>,
  beforeEmit?: () => void,
): Effect.Effect<void, E, R> =>
  Stream.runForEach(stream, () => {
    beforeEmit?.();
    return emit(triggerPayload);
  });

export const stopOwnedPlaytestSession = (input: {
  readonly sessionId: PlaytestSession['id'];
  readonly projectId: ProjectId;
  readonly mapId: MapId;
}) =>
  Effect.gen(function* () {
    const playtest = yield* PlaytestService;
    const sessions = yield* playtest.list();
    const session = sessions.find((entry) => entry.id === input.sessionId);
    if (session === undefined) {
      return yield* new PlaytestSessionNotFoundError({
        sessionId: input.sessionId,
        message: `playtest session not found: ${input.sessionId}`,
      });
    }
    if (session.projectId !== input.projectId || session.mapId !== input.mapId) {
      yield* Effect.fail(
        new Error(
          `playtest session owner mismatch for ${input.sessionId}: expected ${session.projectId}/${session.mapId}, received ${input.projectId}/${input.mapId}`,
        ),
      );
    }
    const stoppedRuntime = yield* Effect.tryPromise({
      try: () => stopOwnedPlaytestRuntimeHost(input),
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
    });
    if (!stoppedRuntime) {
      yield* Effect.fail(
        new Error(`playtest runtime owner mismatch or inactive runtime for ${input.sessionId}`),
      );
    }
    return yield* playtest.stop(input.sessionId);
  });

const buildHandlers = (desktopUpdater: DesktopUpdaterController) =>
  Effect.gen(function* () {
    const projects = yield* ProjectService;
    const projectAudio = yield* ProjectAudioService;
    const projectGameShell = yield* ProjectGameShellService;
    const projectBehaviors = yield* ProjectBehaviorService;
    const maps = yield* MapService;
    const assets = yield* AssetService;
    const assetLibrary = yield* AssetLibraryService;
    const workingPalettes = yield* WorkingPaletteService;
    const catalog = yield* CatalogService;
    const registry = yield* PluginRegistryService;
    const installer = yield* PluginInstallerService;
    const jobs = yield* JobService;
    const builds = yield* BuildService;
    const exports = yield* ExportService;
    const playtest = yield* PlaytestService;
    const deploy = yield* RuntimeDeployService;
    const support = yield* SupportService;
    const home = yield* HomeService;
    const logger = yield* LoggerService;
    const behaviorReferenceIndex = new BehaviorReferenceIndex();

    const behaviorAuthoringRegistry = (projectId: ProjectId) =>
      Effect.gen(function* () {
        const project = yield* projects.open(projectId);
        const enabledProjectPluginIds = new Set(project.plugins.map(({ id }) => String(id)));
        const installed = yield* registry.list();
        return resolveBehaviorAuthoringRegistry(
          installed
            .filter(({ enabled, id }) => enabled && enabledProjectPluginIds.has(String(id)))
            .map(({ id, manifest }) => ({ pluginId: id, contributions: manifest.contributes })),
        );
      });

    const assetPreviewUrl = (packId: string, assetPath: string): string => {
      const params = new URLSearchParams({ id: packId, path: assetPath });
      return `tileborne-asset://pack?${params.toString()}`;
    };

    const behaviorReferenceOptions = (
      projectId: ProjectId,
      kind: BehaviorReferenceKind,
    ): Effect.Effect<readonly IndexedBehaviorReferenceOption[], unknown, never> =>
      Effect.gen(function* () {
        if (kind === 'asset') {
          const project = yield* projects.open(projectId);
          const installedPacks = yield* assets.listPacks();
          const projectPackIds = new Set(project.assetPacks.map(({ id }) => String(id)));
          return installedPacks
            .filter(({ id }) => projectPackIds.has(String(id)))
            .flatMap((pack): readonly IndexedBehaviorReferenceOption[] =>
              pack.assets.map((asset) => ({
                id: String(asset.id),
                label: path.basename(asset.path),
                reference: new AssetBehaviorReference({ assetId: asset.id }),
                ...(asset.mime.startsWith('image/')
                  ? { previewUrl: assetPreviewUrl(String(pack.id), asset.path) }
                  : {}),
                detail: pack.name,
              })),
            );
        }
        if (kind === 'entity') {
          const project = yield* projects.open(projectId);
          const projectMaps = yield* Effect.forEach(
            project.maps,
            ({ id }) => maps.load(projectId, id as MapId),
            { concurrency: 4 },
          );
          return projectMaps.flatMap((map): readonly IndexedBehaviorReferenceOption[] =>
            map.objects.map((object) => ({
              id: String(object.id),
              label: `${String(object.kind)} · ${map.id}`,
              reference: new EntityBehaviorReference({ objectId: object.id }),
              detail: `x ${Math.round(object.x)}, y ${Math.round(object.y)}`,
            })),
          );
        }
        if (kind === 'catalog') {
          const resolvedCatalog = yield* catalog.resolve(projectId);
          return resolvedCatalog.objectTypes.map(({ objectType, origin }) => ({
            id: String(objectType.id),
            label: objectType.label,
            reference: new CatalogBehaviorReference({ objectTypeId: objectType.id }),
            detail: origin === 'project' ? 'Project content' : 'Plugin content',
          }));
        }
        const behaviorRegistry = yield* projectBehaviors.list(projectId);
        return behaviorRegistry.manifests.map((manifest) => ({
          id: String(manifest.id),
          label: manifest.label,
          reference: new NestedBehaviorReference({ behaviorId: manifest.id }),
          detail: manifest.source._tag === 'visual' ? 'Event sheet' : 'TypeScript',
        }));
      });

    /**
     * Assemble the ONE typed `RuntimeMapPackage` (ADR-0030 step 1) every playtest
     * host boots from: merge the materialized plugin catalogs + project entities
     * through the canonical registry, project placements, bake visuals, and write
     * the package into the playtest artifact directory.
     */
    const assemblePlaytestMapPackage = (input: {
      readonly projectId: ProjectId;
      readonly mapId: MapId;
      readonly activePluginId: string;
      readonly pluginRootPath: string;
      readonly playerModels: readonly PlayerModelRef[];
      readonly outputDirectory: string;
    }) =>
      Effect.gen(function* () {
        const project = yield* projects.open(input.projectId);
        const map = yield* maps.load(input.projectId, input.mapId);
        const sources = yield* catalog.runtimeSources(input.projectId);
        const installed = yield* registry.list();
        const activeMode = discoverGameModes(
          installed
            .filter((plugin) => plugin.enabled)
            .map((plugin) => ({ pluginId: plugin.id, contributions: plugin.manifest.contributes })),
        ).find((mode) => mode.pluginId === input.activePluginId);
        if (activeMode === undefined) {
          return yield* Effect.fail(
            new Error(`Active game-mode plugin declares no game mode: ${input.activePluginId}`),
          );
        }
        // The active mode's narrowed exporter bakes `modeData.<pluginId>` into
        // the package; without it the mode's runtime cannot boot from the package.
        // Discovery is the SAME shared producer the ship build uses (M5).
        const modeDataExporter = yield* loadPluginModeDataExporter(input.pluginRootPath).pipe(
          Effect.mapError((error) => new Error(error.message)),
        );
        if (modeDataExporter === undefined) {
          return yield* Effect.fail(
            new Error(
              `Active game-mode plugin exposes no mode-data exporter: ${input.activePluginId}`,
            ),
          );
        }
        const behaviorSnapshot = yield* projectBehaviors
          .open(input.projectId)
          .pipe(Effect.mapError((error) => new Error(error.message)));
        const effectiveBehaviorRegistry = yield* behaviorAuthoringRegistry(input.projectId);
        const compiledBehaviors = yield* Effect.tryPromise(() =>
          compileProjectBehaviorPackage(behaviorSnapshot, effectiveBehaviorRegistry.registry),
        );
        if (!compiledBehaviors.ok || compiledBehaviors.behaviorPackage === undefined) {
          return yield* Effect.fail(
            new Error(
              `Behavior compilation failed: ${compiledBehaviors.diagnostics
                .map((entry) => `${entry.code}: ${entry.message}`)
                .join('; ')}`,
            ),
          );
        }
        return yield* assembleRuntimeMapPackage({
          projectId: input.projectId,
          map,
          activeMode,
          pluginCatalogs: sources.pluginCatalogs,
          projectObjectTypes: sources.projectObjectTypes,
          projectContent: sources.projectContent,
          behaviors: compiledBehaviors.behaviorPackage,
          behaviorModules: compiledBehaviors.modules ?? [],
          playerModels: input.playerModels,
          playerCapacity: resolvePackagePlayerCapacity(map, input.activePluginId),
          mergeDeps: { resolveWeapon: (id) => sources.weaponIds.has(id) },
          modeDataExporter,
          engineVersion: project.engineVersion,
          outputDirectory: input.outputDirectory,
        });
      });

    /**
     * Canonical readiness producer. The renderer consumes this report verbatim,
     * while every main-process execution path calls the same function as a hard
     * gate so command-palette/direct-IPC callers cannot bypass authoring checks.
     */
    const checkReadiness = (input: {
      readonly projectId: ProjectId;
      readonly mapId?: MapId | undefined;
      readonly purpose: 'authoring' | 'playtest' | 'build';
    }) =>
      Effect.gen(function* () {
        const project = yield* projects.open(input.projectId);
        const installed = yield* registry.list();
        const enabled = installed.filter((plugin) => plugin.enabled);
        const modes = discoverGameModes(
          enabled.map((plugin) => ({
            pluginId: plugin.id,
            contributions: plugin.manifest.contributes,
          })),
        );
        const selectedModeId = readActiveGameModeSetting(project.settings) as
          | GameModeId
          | undefined;
        const activeMode = resolveActiveGameMode(modes, selectedModeId);
        const diagnostics = [];

        const behaviorSnapshot = yield* projectBehaviors
          .open(input.projectId)
          .pipe(Effect.mapError((error) => new Error(error.message)));
        const effectiveBehaviorRegistry = yield* behaviorAuthoringRegistry(input.projectId);
        const compiledBehaviorCheck = yield* Effect.tryPromise(() =>
          compileProjectBehaviorPackage(behaviorSnapshot, effectiveBehaviorRegistry.registry),
        );
        diagnostics.push(
          ...behaviorReadinessDiagnostics(
            input.projectId,
            behaviorSnapshot.diagnostics,
            compiledBehaviorCheck.diagnostics,
          ),
        );

        if (activeMode === undefined) {
          diagnostics.push(
            readinessDiagnostic({
              id: `project:${input.projectId}:active-mode-missing`,
              code: 'game-mode.active-missing',
              severity: 'error',
              source: 'game-mode',
              title: 'Select an active game mode',
              message: 'Select one enabled game mode before playtest or build.',
              projectId: input.projectId,
              path: 'settings.activeGameMode',
              navigation: readinessNavigation({
                kind: 'project-settings',
                projectId: input.projectId,
                path: 'settings.activeGameMode',
              }),
            }),
          );
        } else {
          diagnostics.push(
            readinessDiagnostic({
              id: `project:${input.projectId}:active-mode:${activeMode.modeId}`,
              code: 'game-mode.active',
              severity: 'info',
              source: 'game-mode',
              title: `${activeMode.label} active`,
              message: `${activeMode.label} owns validation and runtime execution for this project.`,
              projectId: input.projectId,
              path: 'settings.activeGameMode',
              navigation: readinessNavigation({
                kind: 'project-settings',
                projectId: input.projectId,
                path: 'settings.activeGameMode',
              }),
            }),
          );
        }

        const mapSummaries =
          input.mapId === undefined ? yield* maps.list(input.projectId) : [{ id: input.mapId }];
        const projectMaps = yield* Effect.forEach(
          mapSummaries,
          (summary) => maps.load(input.projectId, summary.id as MapId),
          { concurrency: 4 },
        );
        if (projectMaps.length === 0) {
          diagnostics.push(
            readinessDiagnostic({
              id: `project:${input.projectId}:map-missing`,
              code: 'map.missing',
              severity: 'error',
              source: 'map',
              title: 'Create a map',
              message: 'The project needs at least one map before playtest or build.',
              projectId: input.projectId,
              navigation: readinessNavigation({ kind: 'map', projectId: input.projectId }),
            }),
          );
        }

        const catalogResult = yield* catalog.validate(input.projectId);
        for (const [index, issue] of catalogResult.report.issues.entries()) {
          diagnostics.push(
            readinessDiagnostic({
              id: `project:${input.projectId}:catalog:${issue.kind}:${issue.objectTypeId ?? issue.missingId ?? index}`,
              code: `catalog.${issue.kind}`,
              severity: 'error',
              source: 'catalog',
              title: 'Catalog reference is invalid',
              message: issue.message,
              projectId: input.projectId,
              path: issue.objectTypeId === undefined ? 'catalog' : `catalog.${issue.objectTypeId}`,
              navigation: readinessNavigation({
                kind: 'catalog',
                projectId: input.projectId,
                ...(issue.objectTypeId === undefined ? {} : { objectTypeId: issue.objectTypeId }),
                path: 'catalog',
              }),
            }),
          );
        }
        const resolvedCatalog = yield* catalog.resolve(input.projectId);
        const knownObjectTypeIds = new Set(
          resolvedCatalog.objectTypes.map((entry) => String(entry.objectType.id)),
        );
        for (const map of projectMaps) {
          for (const object of map.objects) {
            if (knownObjectTypeIds.has(String(object.kind))) {
              continue;
            }
            diagnostics.push(
              readinessDiagnostic({
                id: `project:${input.projectId}:map:${map.id}:object:${object.id}:unknown-type`,
                code: 'catalog.map-object-unknown-type',
                severity: 'error',
                source: 'catalog',
                title: 'Map object type is missing',
                message: `Map object ${object.id} references an unavailable catalog type: ${object.kind}`,
                projectId: input.projectId,
                mapId: map.id,
                path: `objects.${object.id}.kind`,
                navigation: readinessNavigation({
                  kind: 'map-object',
                  projectId: input.projectId,
                  mapId: map.id,
                  objectId: object.id,
                  path: `objects.${object.id}.kind`,
                }),
              }),
            );
          }
        }

        const installedPacks = yield* assets.listPacks();
        const installedPackIds = new Set(installedPacks.map((pack) => String(pack.id)));
        const referencedPackIds = new Set(project.assetPacks.map((pack) => String(pack.id)));
        for (const map of projectMaps) {
          const tilesetPackId = map.properties.tilesetPackId;
          if (typeof tilesetPackId === 'string' && tilesetPackId.length > 0) {
            referencedPackIds.add(tilesetPackId);
          }
        }
        for (const packId of referencedPackIds) {
          if (!installedPackIds.has(packId)) {
            diagnostics.push(
              readinessDiagnostic({
                id: `project:${input.projectId}:asset-pack-missing:${packId}`,
                code: 'asset.pack-missing',
                severity: 'error',
                source: 'asset',
                title: 'Asset pack is missing',
                message: `Referenced asset pack is not installed: ${packId}`,
                projectId: input.projectId,
                path: `assetPacks.${packId}`,
                navigation: readinessNavigation({
                  kind: 'asset-library',
                  projectId: input.projectId,
                  path: `assetPacks.${packId}`,
                }),
              }),
            );
          }
        }
        for (const pack of installedPacks.filter((entry) =>
          referencedPackIds.has(String(entry.id)),
        )) {
          diagnostics.push(
            ...assetPackLicenseReadinessDiagnosticsForPurpose(input.purpose, input.projectId, pack),
          );
          for (const [index, issue] of pack.capability.diagnostics.entries()) {
            const severity = issue.severity;
            diagnostics.push(
              readinessDiagnostic({
                id: `project:${input.projectId}:asset:${pack.id}:${issue._tag}:${index}`,
                code: `asset.${issue._tag}`,
                severity,
                source: 'asset',
                title: severity === 'error' ? 'Asset pack is invalid' : 'Asset pack warning',
                message: issue.message,
                projectId: input.projectId,
                path: `assetPacks.${pack.id}`,
                navigation: readinessNavigation({
                  kind: 'asset-library',
                  projectId: input.projectId,
                  path: `assetPacks.${pack.id}`,
                }),
              }),
            );
          }
        }

        const audioProjection = yield* projectAudio.project(input.projectId, (source) => {
          if (source.url !== undefined) return source;
          if (source.path !== undefined) {
            return {
              ...source,
              url: source.path.startsWith('assets/') ? source.path : `assets/${source.path}`,
            };
          }
          return undefined;
        });
        for (const issue of audioProjection.diagnostics) {
          const blocksExecution =
            issue.code === 'missing-label' ||
            issue.code === 'missing-source' ||
            issue.code === 'unresolved-packaged-source';
          diagnostics.push(
            readinessDiagnostic({
              id: `project:${input.projectId}:audio:${issue.code}:${issue.path}`,
              code: `audio.${issue.code}`,
              severity: blocksExecution ? 'error' : 'warning',
              source: 'audio',
              title: blocksExecution
                ? 'Audio source is not playable'
                : 'Audio binding is incomplete',
              message: issue.message,
              projectId: input.projectId,
              path: issue.path,
              navigation: readinessNavigation({
                kind: 'game-shell',
                projectId: input.projectId,
                path: issue.path,
              }),
            }),
          );
        }

        const shellDefaults = resolveInstalledGameShellDefaults(activeMode, installed);
        if (shellDefaults.invalid !== undefined) {
          diagnostics.push(
            gameShellDefaultsInvalidReadinessDiagnostic(input.projectId, shellDefaults.invalid),
          );
        }
        const shellProjection = yield* projectGameShell.project(input.projectId, {
          defaults: shellDefaults.defaults,
          projection: { resolveAsset: shellAssetResolverFromPacks(installedPacks) },
        });
        for (const issue of shellProjection.diagnostics) {
          diagnostics.push(
            readinessDiagnostic({
              id: `project:${input.projectId}:game-shell:${issue.code}:${issue.path}`,
              code: `game-shell.${issue.code}`,
              severity: 'error',
              source: 'game-shell',
              title: 'Game shell is not ready',
              message: issue.message,
              projectId: input.projectId,
              path: issue.path,
              navigation: readinessNavigation({
                kind: 'game-shell',
                projectId: input.projectId,
                path: issue.path,
              }),
            }),
          );
        }

        if (activeMode !== undefined) {
          const activePlugin = enabled.find((plugin) => plugin.id === activeMode.pluginId);
          if (activePlugin === undefined) {
            diagnostics.push(
              readinessDiagnostic({
                id: `project:${input.projectId}:active-plugin-missing:${activeMode.pluginId}`,
                code: 'game-mode.plugin-missing',
                severity: 'error',
                source: 'game-mode',
                title: 'Active game-mode plugin is unavailable',
                message: `Enable or reinstall ${activeMode.pluginId}.`,
                projectId: input.projectId,
                navigation: readinessNavigation({
                  kind: 'project-settings',
                  projectId: input.projectId,
                  path: 'settings.activeGameMode',
                }),
              }),
            );
          } else {
            const validator = yield* Effect.tryPromise({
              try: () => loadPluginMapValidator(activePlugin, activeMode.mapValidatorId),
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });
            if (validator !== undefined) {
              for (const map of projectMaps) {
                const result = validator(map);
                for (const [index, issue] of result.issues.entries()) {
                  diagnostics.push(
                    readinessDiagnostic({
                      id: `project:${input.projectId}:map:${map.id}:${activeMode.pluginId}:${index}:${issue.severity}`,
                      code: 'game-mode.map-validation',
                      severity: issue.severity,
                      source: 'map',
                      title: `${activeMode.label} map ${issue.severity}`,
                      message: issue.message,
                      projectId: input.projectId,
                      mapId: map.id,
                      path: issue.location ?? 'map',
                      navigation: readinessNavigation({
                        kind: 'map',
                        projectId: input.projectId,
                        mapId: map.id,
                        path: issue.location ?? 'map',
                      }),
                    }),
                  );
                }
              }
            }
          }
        }

        const hostRegistration = resolveGameModeHostRegistration(activeMode?.readinessCapabilityId);
        if (activeMode !== undefined && hostRegistration !== undefined) {
          for (const map of projectMaps) {
            for (const issue of hostRegistration.diagnoseMap(
              map,
              resolvedCatalog.weapons,
              resolvedCatalog.objectTypes.map((entry) => entry.objectType),
            )) {
              diagnostics.push(
                readinessDiagnostic({
                  id: `project:${input.projectId}:map:${map.id}:${activeMode.modeId}:${issue.code}`,
                  code: issue.code,
                  severity: 'error',
                  source: 'game-mode',
                  title: issue.title,
                  message: issue.message,
                  projectId: input.projectId,
                  mapId: map.id,
                  path: issue.path,
                  navigation: readinessNavigation({
                    kind: 'map',
                    projectId: input.projectId,
                    mapId: map.id,
                    path: issue.path,
                  }),
                }),
              );
            }
          }
          const models = hostRegistration.resolvePlayerModels(project);
          if (hostRegistration.hasInvalidAuthoredPlayerModels(project)) {
            diagnostics.push(
              readinessDiagnostic({
                id: `project:${input.projectId}:player-model-invalid-roster`,
                code: 'visual-model.player-model.invalid-ref',
                severity: 'error',
                source: 'visual-model',
                title: 'Fix the authored player-model roster',
                message: `The authored ${activeMode.label} player-model roster does not match the canonical player-model schema.`,
                projectId: input.projectId,
                path: 'playerModels',
                navigation: readinessNavigation({
                  kind: 'player-model',
                  projectId: input.projectId,
                  path: 'playerModels',
                }),
              }),
            );
          }
          const packIndexes = new Map<string, unknown>();
          yield* Effect.forEach(
            [...new Set(models.map((model) => String(model.ref.packId)))],
            (packId) =>
              assetLibrary
                .getEditorIndex({ packId: packId as (typeof models)[number]['ref']['packId'] })
                .pipe(
                  Effect.match({
                    onFailure: () => undefined,
                    onSuccess: (result) => {
                      try {
                        packIndexes.set(packId, JSON.parse(result.indexJson) as unknown);
                      } catch {
                        // A malformed cache is reported as an unavailable referenced pack below.
                      }
                    },
                  }),
                ),
            { concurrency: 4 },
          );
          const visualDiagnostics = diagnoseVisualModelAuthoring({
            playerModelPolicy: {
              models,
              requiredClipKeys: hostRegistration.playerModelPolicy?.requiredClipKeys ?? [],
              placeholderModelIds: hostRegistration.playerModelPolicy?.placeholderModelIds ?? [],
            },
            diagnoseReference: (model) =>
              diagnosePlayerModelReference(
                model,
                packIndexes.get(String(model.ref.packId)) as Parameters<
                  typeof diagnosePlayerModelReference
                >[1],
              ),
          });
          for (const [index, issue] of visualDiagnostics.entries()) {
            diagnostics.push(
              readinessDiagnostic({
                id: `project:${input.projectId}:visual-model:${issue.modelId ?? 'policy'}:${issue.code}:${index}`,
                code: `visual-model.${issue.code}`,
                severity: issue.severity,
                source: 'visual-model',
                title:
                  issue.severity === 'error'
                    ? 'Player model is not runtime-ready'
                    : 'Player model warning',
                message: issue.message,
                projectId: input.projectId,
                path: issue.path,
                navigation: readinessNavigation({
                  kind: 'player-model',
                  projectId: input.projectId,
                  ...(issue.modelId === undefined ? {} : { modelId: issue.modelId }),
                  path: issue.path,
                }),
              }),
            );
          }
        }

        return { report: makeReadinessReport(input.purpose, diagnostics) };
      });

    /**
     * Canonical, bounded asset reference projection. Project/catalog/map/model
     * state stays in main; the renderer receives exact use sites and navigation
     * targets without loading every map or asset manifest itself.
     */
    const getAssetPackUseSites = (input: {
      readonly projectId: ProjectId;
      readonly packId: PackId;
      readonly limit?: number | undefined;
    }) =>
      Effect.gen(function* () {
        const project = yield* projects.open(input.projectId);
        const resolvedCatalog = yield* catalog.resolve(input.projectId);
        const editorIndexResult = yield* assetLibrary.getEditorIndex({ packId: input.packId });
        const editorIndex = yield* Effect.try({
          try: () =>
            JSON.parse(editorIndexResult.indexJson) as Parameters<
              typeof buildAssetPackUseSites
            >[0]['editorIndex'],
          catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
        });
        const mapOptions = yield* Effect.forEach(
          project.maps.slice(0, ASSET_USE_SITE_MAP_SCAN_LIMIT),
          (mapRef) => maps.load(input.projectId, mapRef.id as MapId).pipe(Effect.option),
          { concurrency: 4 },
        );
        const projectMaps = mapOptions.flatMap((entry) =>
          Option.match(entry, { onNone: () => [], onSome: (map) => [map] }),
        );
        const limit = Math.min(
          ASSET_USE_SITE_RESULT_LIMIT,
          Math.max(1, Math.trunc(input.limit ?? 100)),
        );
        const activeMode = resolveProjectGameMode(project, yield* registry.list());
        const hostRegistration = resolveGameModeHostRegistration(activeMode?.readinessCapabilityId);
        const result = buildAssetPackUseSites({
          project,
          packId: input.packId,
          maps: projectMaps,
          catalogObjectTypes: resolvedCatalog.objectTypes.map((entry) => entry.objectType),
          playerModels: hostRegistration?.resolvePlayerModels(project) ?? [],
          editorIndex,
          limit,
          projectMapCount: project.maps.length,
        });
        return {
          projectId: input.projectId,
          packId: input.packId,
          useSites: [...result.useSites],
          total: result.total,
          scannedMapCount: projectMaps.length,
          truncated: result.truncated,
        };
      });

    const projectHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:projects:list', () =>
        ipcCatchAll('tileborne:projects:list')(
          runDesktopProjectListLifecycle(() => projects.list()).pipe(
            Effect.map((items) => ({ projects: [...items] })),
          ),
        ),
      )
      .add('tileborne:projects:get', ({ projectId }) =>
        ipcCatchAll('tileborne:projects:get')(
          runDesktopProjectReopenLifecycle(() => projects.open(projectId)).pipe(
            Effect.map((project) => ({ project })),
          ),
        ),
      )
      .add('tileborne:projects:create', ({ name, engineVersion }) =>
        ipcCatchAll('tileborne:projects:create')(
          projects
            .create({
              name,
              ...(engineVersion !== undefined ? { engineVersion } : {}),
            })
            .pipe(Effect.map((projectId) => ({ projectId }))),
        ),
      )
      .add('tileborne:projects:createGame', ({ name, idempotencyKey }) =>
        ipcCatchAll('tileborne:projects:createGame')(
          Effect.gen(function* () {
            const starter = defaultGameModeStarterRegistration();
            const spec = bundledPluginSpec(starter.pluginId);
            if (spec === undefined) {
              return yield* Effect.fail(
                new Error(`Bundled game-mode plugin is unavailable: ${starter.pluginId}`),
              );
            }
            yield* installBundledPluginWithServices(spec, { registry, installer });
            yield* seedBundledPluginAssetPacksWithServices({ registry, assets });

            let existingProject: ProjectManifest | undefined;
            for (const summary of yield* projects.list()) {
              const candidate = yield* projects.open(summary.id);
              if (starter.readIdempotencyKey(candidate) === idempotencyKey) {
                existingProject = candidate;
                break;
              }
            }

            const resumed = existingProject !== undefined;
            const projectId =
              existingProject?.id ??
              (yield* projects.create({
                name,
                plugins: [
                  new ProjectPluginRef({
                    id: starter.pluginId as ProjectPluginRef['id'],
                    version: '*',
                  }),
                ],
                assetPacks: starter.assetPacks.map(
                  (pack) => new ProjectAssetPackRef({ id: String(pack.id), version: pack.version }),
                ),
                settings: {
                  newGameWizard: {
                    idempotencyKey,
                    templateId: starter.templateId,
                    version: starter.version,
                    sourcePluginId: starter.pluginId,
                    completed: false,
                  },
                },
              }));

            const opened = existingProject ?? (yield* projects.open(projectId));
            const withDependencies = new ProjectManifest({
              ...opened,
              plugins: opened.plugins.some((plugin) => plugin.id === starter.pluginId)
                ? opened.plugins
                : [
                    ...opened.plugins,
                    new ProjectPluginRef({
                      id: starter.pluginId as ProjectPluginRef['id'],
                      version: '*',
                    }),
                  ],
              assetPacks: starter.assetPacks.reduce<readonly ProjectAssetPackRef[]>(
                (packs, required) =>
                  packs.some((pack) => pack.id === String(required.id))
                    ? packs
                    : [
                        ...packs,
                        new ProjectAssetPackRef({
                          id: String(required.id),
                          version: required.version,
                        }),
                      ],
                opened.assetPacks,
              ),
            });
            yield* projects.save(starter.applyProject(withDependencies, { idempotencyKey }));

            let starterMapId: MapId | undefined;
            for (const summary of yield* maps.list(projectId)) {
              const candidate = yield* maps.load(projectId, summary.id);
              if (
                candidate.properties.starterTemplateId === starter.templateId &&
                candidate.properties.starterSeed === idempotencyKey
              ) {
                starterMapId = summary.id;
                break;
              }
            }
            if (starterMapId === undefined) {
              starterMapId = yield* maps.create(projectId, {
                width: starter.mapSize.width,
                height: starter.mapSize.height,
                properties: {
                  starterTemplateId: starter.templateId,
                  starterSeed: idempotencyKey,
                },
              });
            }
            yield* maps.save(projectId, starter.createMap(starterMapId, idempotencyKey));
            const finalized = yield* projects.open(projectId);
            yield* projects.save(
              starter.applyProject(finalized, {
                idempotencyKey,
                starterMapId,
              }),
            );
            return { projectId, mapId: starterMapId, resumed };
          }),
        ),
      )
      .add('tileborne:projects:update', ({ project }) =>
        ipcCatchAll('tileborne:projects:update')(projects.save(project).pipe(Effect.as({}))),
      )
      .add('tileborne:projects:delete', ({ projectId }) =>
        ipcCatchAll('tileborne:projects:delete')(
          Effect.gen(function* () {
            const paths = yield* home.init();
            const dir = path.join(paths.projects, projectId);
            yield* Effect.tryPromise({
              try: () => rm(dir, { recursive: true, force: true }),
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });
          }).pipe(Effect.as({})),
        ),
      )
      .add('tileborne:projects:open', ({ projectId }) =>
        ipcCatchAll('tileborne:projects:open')(
          runDesktopProjectReopenLifecycle(() => projects.open(projectId)).pipe(
            Effect.map((project) => ({ project })),
          ),
        ),
      )
      .add('tileborne:projects:close', () =>
        ipcCatchAll('tileborne:projects:close')(Effect.succeed({})),
      )
      .add('tileborne:projects:importFromDirectory', ({ path: sourcePath }) =>
        ipcCatchAll('tileborne:projects:importFromDirectory')(
          projects.importFromDirectory(sourcePath).pipe(Effect.map((projectId) => ({ projectId }))),
        ),
      )
      .add('tileborne:projects:exportArchive', ({ projectId, destinationDirectory }) =>
        ipcCatchAll('tileborne:projects:exportArchive')(
          projects.exportArchive(projectId, destinationDirectory),
        ),
      )
      .build();

    const audioHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:audio:open', ({ projectId }) =>
        ipcCatchAll('tileborne:audio:open')(
          projectAudio.open(projectId).pipe(Effect.map((document) => ({ document }))),
        ),
      )
      .add('tileborne:audio:save', ({ projectId, document }) =>
        ipcCatchAll('tileborne:audio:save')(
          Effect.gen(function* () {
            const decoded = decodeProjectAudioDocument(document);
            if (decoded === undefined) {
              return yield* Effect.fail(new Error('Audio document failed validation.'));
            }
            return yield* projectAudio.save(projectId, decoded);
          }).pipe(Effect.map((saved) => ({ document: saved }))),
        ),
      )
      .add('tileborne:audio:apply', ({ projectId, command }) =>
        ipcCatchAll('tileborne:audio:apply')(
          projectAudio.apply(projectId, command).pipe(
            Effect.map(({ document, projection }) => ({
              document,
              projection,
            })),
          ),
        ),
      )
      .add('tileborne:audio:preview', ({ projectId, label }) =>
        ipcCatchAll('tileborne:audio:preview')(
          Effect.gen(function* () {
            const document = yield* projectAudio.open(projectId);
            const result = applyAudioAuthoringCommand(audioAuthoringStateFromDocument(document), {
              type: 'preview',
              label,
            });
            const source =
              result.effects[0]?.type === 'preview'
                ? resolveRuntimeAudioSource(result.effects[0].source, (candidate) =>
                    candidate.url !== undefined
                      ? candidate
                      : candidate.path !== undefined
                        ? {
                            ...candidate,
                            url: candidate.path.startsWith('assets/')
                              ? candidate.path
                              : `assets/${candidate.path}`,
                          }
                        : undefined,
                  )
                : undefined;
            return {
              playable: source?.url !== undefined,
              ...(source === undefined ? {} : { source }),
              diagnostics:
                source === undefined && result.diagnostics.length === 0
                  ? [
                      {
                        code: 'unresolved-packaged-source',
                        path: `audio.assets.${label}.source`,
                        message: `Audio label "${label}" does not resolve to a packaged source URL.`,
                      },
                    ]
                  : result.diagnostics,
            };
          }),
        ),
      )
      .build();

    const gameShellHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:game-shell:open', ({ projectId }) =>
        ipcCatchAll('tileborne:game-shell:open')(
          Effect.gen(function* () {
            const project = yield* projects.open(projectId);
            const installed = yield* registry.list();
            const activeMode = resolveProjectGameMode(project, installed);
            const defaults = resolveInstalledGameShellDefaults(activeMode, installed).defaults;
            const document = yield* projectGameShell.open(projectId, { defaults });
            return {
              document,
              projection: buildRuntimeGameShellProjection(gameShellStateFromDocument(document)),
            };
          }),
        ),
      )
      .add('tileborne:game-shell:save', ({ projectId, document }) =>
        ipcCatchAll('tileborne:game-shell:save')(
          Effect.gen(function* () {
            const decoded = decodeProjectGameShellDocument(document);
            if (decoded === undefined) {
              return yield* Effect.fail(new Error('Game shell document failed validation.'));
            }
            const project = yield* projects.open(projectId);
            const installed = yield* registry.list();
            const activeMode = resolveProjectGameMode(project, installed);
            const defaults = resolveInstalledGameShellDefaults(activeMode, installed).defaults;
            const saved = yield* projectGameShell.save(projectId, decoded);
            return {
              document: saved,
              projection: yield* projectGameShell.project(projectId, { defaults }),
            };
          }),
        ),
      )
      .add('tileborne:game-shell:apply', ({ projectId, command }) =>
        ipcCatchAll('tileborne:game-shell:apply')(
          Effect.gen(function* () {
            const project = yield* projects.open(projectId);
            const installed = yield* registry.list();
            const activeMode = resolveProjectGameMode(project, installed);
            const defaults = resolveInstalledGameShellDefaults(activeMode, installed).defaults;
            return yield* projectGameShell.apply(projectId, command, { defaults }).pipe(
              Effect.map(({ document, projection }) => ({
                document,
                projection,
              })),
            );
          }),
        ),
      )
      .add('tileborne:game-shell:preview', ({ document }) =>
        ipcCatchAll('tileborne:game-shell:preview')(
          Effect.gen(function* () {
            const decoded = decodeProjectGameShellDocument(document);
            if (decoded === undefined) {
              return yield* Effect.fail(
                new Error('Game shell preview document failed validation.'),
              );
            }
            return {
              projection: buildRuntimeGameShellProjection(gameShellStateFromDocument(decoded)),
            };
          }),
        ),
      )
      .build();

    const behaviorSnapshotView = (snapshot: ProjectBehaviorSnapshot) => ({
      projectId: snapshot.projectId,
      revision: snapshot.revision,
      trust: snapshot.trust,
      resources: [...snapshot.resources],
      useSites: [...snapshot.useSites],
      diagnostics: [...snapshot.diagnostics],
    });

    const hotReloadBehaviorAfterSave = (
      snapshot: ProjectBehaviorSnapshot,
      behaviorId: BehaviorId,
    ) =>
      Effect.gen(function* () {
        const effective = yield* behaviorAuthoringRegistry(snapshot.projectId);
        const compiled = yield* Effect.tryPromise(() =>
          compileProjectBehaviorModule(snapshot, effective.registry, behaviorId),
        );
        if (!compiled.ok) {
          const issue = compiled.diagnostics[0];
          const relativeSourceFileName =
            issue?.fileName !== undefined && path.isAbsolute(issue.fileName)
              ? path.relative(snapshot.projectRoot, issue.fileName)
              : issue?.fileName;
          const sourceFileName = relativeSourceFileName?.startsWith('..')
            ? '<external behavior dependency>'
            : relativeSourceFileName;
          rejectPlaytestBehaviorReload(snapshot.projectId, behaviorId, {
            code: issue?.code ?? 'TBBUILD2199',
            severity: 'error',
            behaviorId,
            message: issue?.message ?? 'Behavior compilation failed during hot reload.',
            suggestion:
              issue?.suggestion ??
              'Fix the owning behavior source; last-known-good execution remains active.',
            details: {
              ...(sourceFileName === undefined ? {} : { fileName: sourceFileName }),
              ...(issue?.line === undefined ? {} : { line: issue.line }),
              ...(issue?.column === undefined ? {} : { column: issue.column }),
              ...(issue?.nodeId === undefined ? {} : { nodeId: String(issue.nodeId) }),
            },
          });
          return;
        }
        const resource = snapshot.resources.find((entry) => entry.manifest.id === behaviorId);
        const artifact = compiled.artifact;
        yield* Effect.tryPromise(() =>
          hotReloadPlaytestBehavior(snapshot.projectId, {
            behaviorId: artifact.behaviorId,
            sourceKind: artifact.sourceKind,
            modulePath: artifact.modulePath,
            hash: artifact.hash,
            code: artifact.code,
            ...(resource === undefined
              ? {}
              : {
                  sourcePath:
                    resource.manifest.source._tag === 'visual'
                      ? resource.manifest.source.definitionPath
                      : resource.manifest.source.sourcePath,
                }),
          }),
        );
      }).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            rejectPlaytestBehaviorReload(snapshot.projectId, behaviorId, {
              code: 'TBBUILD2197',
              severity: 'error',
              behaviorId,
              message: `Hot reload failed before apply: ${cause instanceof Error ? cause.message : String(cause)}`,
              suggestion: 'The live playtest continues with the last-known-good behavior.',
            });
          }),
        ),
      );

    const behaviorHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:behaviors:open', ({ projectId }) =>
        ipcCatchAll('tileborne:behaviors:open')(
          projectBehaviors
            .open(projectId)
            .pipe(Effect.map((snapshot) => ({ snapshot: behaviorSnapshotView(snapshot) }))),
        ),
      )
      .add(
        'tileborne:behaviors:createVisual',
        ({ projectId, label, definition, requiredCapabilities }) =>
          ipcCatchAll('tileborne:behaviors:createVisual')(
            projectBehaviors
              .createVisual(projectId, {
                label,
                definition,
                ...(requiredCapabilities === undefined ? {} : { requiredCapabilities }),
              })
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() =>
                    behaviorReferenceIndex.invalidate(String(projectId), 'behavior'),
                  ),
                ),
                Effect.map((snapshot) => ({ snapshot: behaviorSnapshotView(snapshot) })),
              ),
          ),
      )
      .add(
        'tileborne:behaviors:saveVisual',
        ({ projectId, behaviorId, expectedRevision, label, definition, requiredCapabilities }) =>
          ipcCatchAll('tileborne:behaviors:saveVisual')(
            projectBehaviors
              .saveVisual({
                projectId,
                behaviorId,
                expectedRevision,
                label,
                definition,
                ...(requiredCapabilities === undefined ? {} : { requiredCapabilities }),
              })
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() =>
                    behaviorReferenceIndex.invalidate(String(projectId), 'behavior'),
                  ),
                ),
                Effect.tap((snapshot) => hotReloadBehaviorAfterSave(snapshot, behaviorId)),
                Effect.map((snapshot) => ({ snapshot: behaviorSnapshotView(snapshot) })),
              ),
          ),
      )
      .add(
        'tileborne:behaviors:saveTypeScript',
        ({
          projectId,
          behaviorId,
          expectedRevision,
          label,
          source,
          exportName,
          requiredCapabilities,
        }) =>
          ipcCatchAll('tileborne:behaviors:saveTypeScript')(
            projectBehaviors
              .saveTypeScript({
                projectId,
                behaviorId,
                expectedRevision,
                label,
                source,
                ...(exportName === undefined ? {} : { exportName }),
                ...(requiredCapabilities === undefined ? {} : { requiredCapabilities }),
              })
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() =>
                    behaviorReferenceIndex.invalidate(String(projectId), 'behavior'),
                  ),
                ),
                Effect.tap((snapshot) => hotReloadBehaviorAfterSave(snapshot, behaviorId)),
                Effect.map((snapshot) => ({ snapshot: behaviorSnapshotView(snapshot) })),
              ),
          ),
      )
      .add(
        'tileborne:behaviors:convertToTypeScript',
        ({ projectId, behaviorId, expectedRevision }) =>
          ipcCatchAll('tileborne:behaviors:convertToTypeScript')(
            Effect.gen(function* () {
              const snapshot = yield* projectBehaviors.open(projectId);
              const resource = snapshot.resources.find(
                ({ manifest }) => manifest.id === behaviorId,
              );
              if (resource === undefined || resource.kind !== 'visual') {
                return yield* Effect.fail(new Error(`Visual behavior not found: ${behaviorId}`));
              }
              const effective = yield* behaviorAuthoringRegistry(projectId);
              const source = yield* Effect.try({
                try: () =>
                  generateTypeScriptBehaviorSource({
                    definition: resource.definition,
                    registry: effective.registry,
                    requiredCapabilities: resource.manifest.requiredCapabilities,
                  }),
                catch: (cause) => cause,
              });
              return yield* projectBehaviors.convertVisualToTypeScript({
                projectId,
                behaviorId,
                expectedRevision,
                source,
              });
            }).pipe(
              Effect.tap(() =>
                Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'behavior')),
              ),
              Effect.tap((snapshot) => hotReloadBehaviorAfterSave(snapshot, behaviorId)),
              Effect.map((snapshot) => ({ snapshot: behaviorSnapshotView(snapshot) })),
            ),
          ),
      )
      .add('tileborne:behaviors:remove', ({ projectId, behaviorId, expectedRevision, force }) =>
        ipcCatchAll('tileborne:behaviors:remove')(
          projectBehaviors.remove(projectId, behaviorId, expectedRevision, force).pipe(
            Effect.tap(() =>
              Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'behavior')),
            ),
            Effect.map((snapshot) => ({ snapshot: behaviorSnapshotView(snapshot) })),
          ),
        ),
      )
      .add('tileborne:behaviors:registry', ({ projectId }) =>
        ipcCatchAll('tileborne:behaviors:registry')(
          behaviorAuthoringRegistry(projectId).pipe(
            Effect.map((effective) => ({
              registry: effective.registry,
              templates: [...effective.templates],
              entryOwners: { ...effective.entryOwners },
              templateOwners: { ...effective.templateOwners },
            })),
          ),
        ),
      )
      .add('tileborne:behaviors:references', ({ projectId, kind, query, offset, limit }) =>
        ipcCatchAll('tileborne:behaviors:references')(
          Effect.tryPromise({
            try: () =>
              behaviorReferenceIndex.query(
                String(projectId),
                kind,
                {
                  ...(query === undefined ? {} : { query }),
                  ...(offset === undefined ? {} : { offset }),
                  ...(limit === undefined ? {} : { limit }),
                },
                () => Effect.runPromise(behaviorReferenceOptions(projectId, kind)),
              ),
            catch: (cause) => new Error('Could not build behavior reference index', { cause }),
          }).pipe(Effect.map((page) => ({ kind, ...page }))),
        ),
      )
      .add('tileborne:behaviors:resolveReferences', ({ projectId, references }) =>
        ipcCatchAll('tileborne:behaviors:resolveReferences')(
          Effect.gen(function* () {
            if (references.length > 64) {
              return yield* Effect.fail(
                new Error('At most 64 behavior references can be resolved at once'),
              );
            }
            const byKind = new Map<BehaviorReferenceKind, BehaviorReference[]>();
            for (const reference of references) {
              const bucket = byKind.get(reference._tag);
              if (bucket === undefined) byKind.set(reference._tag, [reference]);
              else bucket.push(reference);
            }
            const resolved = yield* Effect.tryPromise({
              try: async () => {
                const options: IndexedBehaviorReferenceOption[] = [];
                const missing: BehaviorReference[] = [];
                await Promise.all(
                  [...byKind].map(async ([kind, requested]) => {
                    const batch = await behaviorReferenceIndex.resolve(
                      String(projectId),
                      kind,
                      requested,
                      () => Effect.runPromise(behaviorReferenceOptions(projectId, kind)),
                    );
                    options.push(...batch.options);
                    missing.push(...batch.missing);
                  }),
                );
                return { options, missing };
              },
              catch: (cause) => new Error('Could not resolve behavior references', { cause }),
            });
            return resolved;
          }),
        ),
      )
      .build();

    const mapHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:maps:list', ({ projectId }) =>
        ipcCatchAll('tileborne:maps:list')(
          maps.list(projectId).pipe(Effect.map((items) => ({ maps: [...items] }))),
        ),
      )
      .add('tileborne:maps:get', ({ projectId, mapId }) =>
        ipcCatchAll('tileborne:maps:get')(
          maps
            .load(projectId, mapId)
            .pipe(Effect.map((map) => ({ map: toMapIpcPayload(map) as TileborneMap }))),
        ),
      )
      .add('tileborne:maps:create', ({ projectId, width, height, tileWidth, tileHeight }) =>
        ipcCatchAll('tileborne:maps:create')(
          maps
            .create(projectId, {
              width,
              height,
              ...(tileWidth !== undefined ? { tileWidth } : {}),
              ...(tileHeight !== undefined ? { tileHeight } : {}),
            })
            .pipe(Effect.map((mapId) => ({ mapId }))),
        ),
      )
      .add('tileborne:maps:update', ({ projectId, map }) =>
        ipcCatchAll('tileborne:maps:update')(maps.save(projectId, map).pipe(Effect.as({}))),
      )
      .add('tileborne:maps:setMapTilesetPack', ({ projectId, mapId, packId }) =>
        ipcCatchAll('tileborne:maps:setMapTilesetPack')(
          maps.setMapTilesetPack(projectId, mapId, packId).pipe(Effect.map((map) => ({ map }))),
        ),
      )
      .add('tileborne:maps:scanTiled', ({ projectId, file }) =>
        ipcCatchAll('tileborne:maps:scanTiled')(
          maps.scanTiledFile(projectId, file).pipe(Effect.map((scan) => ({ scan }))),
        ),
      )
      .add('tileborne:maps:importTiled', ({ projectId, file, profile }) =>
        ipcCatchAll('tileborne:maps:importTiled')(
          maps
            .importFromTiledFile(projectId, file, {
              ...(profile !== undefined ? { profile } : {}),
            })
            .pipe(
              Effect.flatMap((result) =>
                result.kind === 'map'
                  ? Effect.succeed({
                      mapId: result.mapId,
                      layerCount: result.layerCount,
                      objectCount: result.objectCount,
                      ...(result.packId === undefined ? {} : { packId: result.packId }),
                    })
                  : Effect.fail(
                      new Error(
                        'Expected a Tiled map import result. Use the import wizard for asset packs.',
                      ),
                    ),
              ),
            ),
        ),
      )
      .add('tileborne:maps:delete', ({ projectId, mapId }) =>
        ipcCatchAll('tileborne:maps:delete')(maps.delete(projectId, mapId).pipe(Effect.as({}))),
      )
      .add('tileborne:maps:generate', ({ projectId, width, height, seed, preset, tilesetPackId }) =>
        ipcCatchAll('tileborne:maps:generate')(
          maps
            .generate(projectId, {
              width,
              height,
              seed,
              preset,
              ...(tilesetPackId !== undefined ? { tilesetPackId } : {}),
            })
            .pipe(Effect.map((map) => ({ map: toMapIpcPayload(map) as TileborneMap }))),
        ),
      )
      .build();

    const tiledImportHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:tiled-import:scan', ({ projectId, sourcePath }) =>
        ipcCatchAll('tileborne:tiled-import:scan')(maps.analyzeTiledImport(projectId, sourcePath)),
      )
      .add('tileborne:tiled-import:plan', ({ projectId, sourcePath, profile, hints }) =>
        ipcCatchAll('tileborne:tiled-import:plan')(
          maps.planTiledImport(projectId, sourcePath, {
            profile: profile as TiledImportProfile,
            ...(hints === undefined ? {} : { hints }),
          }),
        ),
      )
      .add('tileborne:tiled-import:apply', ({ projectId, sourcePath, profile, hints }) =>
        ipcCatchAll('tileborne:tiled-import:apply')(
          maps.importFromTiledFile(projectId, sourcePath, {
            profile: profile as TiledImportProfile,
            ...(hints === undefined ? {} : { hints }),
          }),
        ),
      )
      .add('tileborne:tiled-import:cancel', () =>
        ipcCatchAll('tileborne:tiled-import:cancel')(Effect.succeed({})),
      )
      .build();

    const assetHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:assets:listPacks', () =>
        ipcCatchAll('tileborne:assets:listPacks')(
          assets.listPacks().pipe(Effect.map((packs) => ({ packs: packs.map(toPackSummary) }))),
        ),
      )
      .add('tileborne:assets:getPack', ({ packId }) =>
        ipcCatchAll('tileborne:assets:getPack')(
          assets.getPack(packId).pipe(Effect.map((pack) => ({ pack: toPackSummary(pack) }))),
        ),
      )
      .add('tileborne:assets:describePack', ({ packId }) =>
        ipcCatchAll('tileborne:assets:describePack')(
          assets.describePack(packId).pipe(
            Effect.map(({ pack, capability, diagnostics }) => ({
              pack: toPackSummary(pack),
              capability,
              diagnostics,
            })),
          ),
        ),
      )
      .add('tileborne:assets:detectImportSource', ({ path: sourcePath }) =>
        ipcCatchAll('tileborne:assets:detectImportSource')(
          Effect.tryPromise({
            try: async () => {
              const resolved = path.resolve(sourcePath);
              const sourceStat = await safeStat(resolved);
              if (sourceStat === undefined) {
                return {
                  detection: {
                    kind: 'unsupported' as const,
                    path: resolved,
                    detectedTypes: [],
                    hasTileborneManifest: false,
                    tiledMapCount: 0,
                    tiledTilesetCount: 0,
                    message: 'Choose an existing Tileborne pack folder or Tiled source.',
                  },
                };
              }
              const extension = path.extname(resolved).toLowerCase();
              if (sourceStat.isFile() && extension === '.zip') {
                return {
                  detection: {
                    kind: 'zip' as const,
                    path: resolved,
                    detectedTypes: ['zip archive'],
                    hasTileborneManifest: false,
                    tiledMapCount: 0,
                    tiledTilesetCount: 0,
                    message: 'Zip imports are not supported yet. Extract the archive first.',
                  },
                };
              }
              if (sourceStat.isFile()) {
                const isTiledMap = TILED_MAP_SOURCE_EXTENSION_SET.has(extension);
                const isTiledTileset = TILED_TILESET_SOURCE_EXTENSION_SET.has(extension);
                const isTiledSource = isTiledMap || isTiledTileset;
                const isImage = SPRITE_SHEET_IMAGE_EXTENSION_SET.has(extension);
                if (isImage) {
                  return {
                    detection: {
                      kind: 'image' as const,
                      path: resolved,
                      detectedTypes: ['Sprite sheet image'],
                      hasTileborneManifest: false,
                      tiledMapCount: 0,
                      tiledTilesetCount: 0,
                      message:
                        'Detected a sprite sheet image. Open the Sprite/Animation Studio to slice it.',
                      preferredKind: 'image' as const,
                    },
                  };
                }
                return {
                  detection: {
                    kind: isTiledSource ? ('tiled-source' as const) : ('unsupported' as const),
                    path: resolved,
                    detectedTypes: isTiledMap
                      ? ['Tiled map file']
                      : isTiledTileset
                        ? ['Tiled tileset file']
                        : [],
                    hasTileborneManifest: false,
                    tiledMapCount: isTiledMap ? 1 : 0,
                    tiledTilesetCount: isTiledTileset ? 1 : 0,
                    message: isTiledMap
                      ? 'Detected a Tiled map file.'
                      : isTiledTileset
                        ? 'Detected a standalone Tiled tileset file.'
                        : 'Choose a Tileborne pack folder or Tiled source file.',
                    ...(isTiledSource ? { preferredKind: 'tiled-source' as const } : {}),
                  },
                };
              }
              const manifestPath = path.join(resolved, TILEBORNE_PACK_MANIFEST);
              const hasTileborneManifest = (await safeStat(manifestPath))?.isFile() === true;
              const tiled = await detectTiledSources(resolved);
              const hasTiledSource = tiled.mapCount > 0 || tiled.tilesetCount > 0;
              const detectedTypes = [
                ...(hasTileborneManifest ? ['Tileborne pack manifest'] : []),
                ...(tiled.mapCount > 0 ? ['Tiled map files'] : []),
                ...(tiled.tilesetCount > 0 ? ['Tiled tileset files'] : []),
              ];
              const kind =
                hasTileborneManifest && hasTiledSource
                  ? 'ambiguous'
                  : hasTileborneManifest
                    ? 'tileborne-pack'
                    : hasTiledSource
                      ? 'tiled-source'
                      : 'unsupported';
              return {
                detection: {
                  kind,
                  path: resolved,
                  detectedTypes,
                  hasTileborneManifest,
                  tiledMapCount: tiled.mapCount,
                  tiledTilesetCount: tiled.tilesetCount,
                  message:
                    kind === 'ambiguous'
                      ? 'This folder contains both a Tileborne pack manifest and raw Tiled source files. Continue to import the Tileborne pack.'
                      : kind === 'tileborne-pack'
                        ? 'Detected a Tileborne asset pack.'
                        : kind === 'tiled-source'
                          ? 'Detected raw Tiled source files.'
                          : 'No Tileborne pack manifest or Tiled source files were found.',
                  ...(kind === 'tileborne-pack' || kind === 'ambiguous'
                    ? { preferredKind: 'tileborne-pack' as const }
                    : kind === 'tiled-source'
                      ? { preferredKind: 'tiled-source' as const }
                      : {}),
                },
              };
            },
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .add('tileborne:assets:importPack', ({ path: sourcePath }) =>
        ipcCatchAll('tileborne:assets:importPack')(
          assets
            .importPack({ _tag: 'directory', path: sourcePath })
            .pipe(Effect.map((jobId) => ({ jobId }))),
        ),
      )
      .add(
        'tileborne:assets:importSpriteSheet',
        ({
          imageBase64,
          imageFileName,
          mime,
          imageWidth,
          imageHeight,
          slice,
          spriteName,
          anchor,
          packName,
          clips,
          playerModel,
          asepriteJson,
        }) =>
          ipcCatchAll('tileborne:assets:importSpriteSheet')(
            Effect.gen(function* () {
              const imageBytes = yield* Effect.try({
                try: () => new Uint8Array(Buffer.from(imageBase64, 'base64')),
                catch: () => new Error('Invalid base64 image payload'),
              });
              const aseprite =
                asepriteJson === undefined
                  ? undefined
                  : yield* Effect.try({
                      try: (): unknown => JSON.parse(asepriteJson),
                      catch: () => new Error('Invalid Aseprite sidecar JSON'),
                    });
              const packId = yield* assets.importSpriteSheetPackNow({
                imageBytes,
                imageFileName,
                mime,
                imageWidth,
                imageHeight,
                slice: {
                  cellWidth: slice.cellWidth,
                  cellHeight: slice.cellHeight,
                  ...(slice.columns === undefined ? {} : { columns: slice.columns }),
                  ...(slice.rows === undefined ? {} : { rows: slice.rows }),
                  ...(slice.margin === undefined ? {} : { margin: slice.margin }),
                  ...(slice.spacing === undefined ? {} : { spacing: slice.spacing }),
                },
                ...(spriteName === undefined ? {} : { spriteName }),
                ...(anchor === undefined ? {} : { anchor }),
                ...(packName === undefined ? {} : { packName }),
                ...(clips === undefined ? {} : { clips }),
                ...(playerModel === undefined ? {} : { playerModel }),
                ...(aseprite === undefined ? {} : { aseprite }),
              });
              return { packId };
            }),
          ),
      )
      .add('tileborne:assets:removePack', ({ packId }) =>
        ipcCatchAll('tileborne:assets:removePack')(
          removeAssetPack(packId).pipe(
            Effect.provideService(AssetService, assets),
            Effect.provideService(AssetLibraryService, assetLibrary),
            Effect.provideService(WorkingPaletteService, workingPalettes),
          ),
        ),
      )
      .add('tileborne:assets:listPackAssets', ({ packId }) =>
        ipcCatchAll('tileborne:assets:listPackAssets')(
          assets.getPack(packId).pipe(
            Effect.map((pack) => ({
              assets: pack.assets.map((asset) => ({
                id: asset.id,
                path: asset.path,
                mime: asset.mime,
              })),
            })),
          ),
        ),
      )
      .add('tileborne:assets:getAssetDataUrl', ({ packId, assetPath }) =>
        ipcCatchAll('tileborne:assets:getAssetDataUrl')(
          Effect.gen(function* () {
            const paths = yield* home.init();
            const pack = yield* assets.getPack(packId);
            const packRoot = installedPackRoot(paths.assets, pack);
            if (assetPath === TILESET_MANIFEST_PATH) {
              const resolved = path.join(packRoot, TILESET_MANIFEST_PATH);
              const bytes = yield* Effect.tryPromise({
                try: () => readFile(resolved),
                catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
              });
              const base64 = Buffer.from(bytes).toString('base64');
              return { dataUrl: `data:application/json;base64,${base64}` };
            }
            const asset = pack.assets.find((candidate) => candidate.path === assetPath);
            if (asset === undefined) {
              return yield* Effect.fail(new Error(`Asset not found in pack: ${assetPath}`));
            }
            const resolved = path.resolve(packRoot, asset.path);
            if (resolved !== packRoot && !resolved.startsWith(`${packRoot}${path.sep}`)) {
              return yield* Effect.fail(new Error(`Asset path escapes pack root: ${assetPath}`));
            }
            const bytes = yield* Effect.tryPromise({
              try: () => readFile(resolved),
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });
            const base64 = Buffer.from(bytes).toString('base64');
            return { dataUrl: `data:${asset.mime};base64,${base64}` };
          }),
        ),
      )
      .build();

    const assetLibraryHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:asset-library:getPackLibrary', (request) =>
        ipcCatchAll('tileborne:asset-library:getPackLibrary')(
          assetLibrary.getPackLibrary(request).pipe(Effect.map((result) => result)),
        ),
      )
      .add('tileborne:asset-library:getPackCacheStatus', (request) =>
        ipcCatchAll('tileborne:asset-library:getPackCacheStatus')(
          assetLibrary.getPackCacheStatus(request).pipe(Effect.map((status) => ({ status }))),
        ),
      )
      .add('tileborne:asset-library:reloadPackCache', (request) =>
        ipcCatchAll('tileborne:asset-library:reloadPackCache')(
          assetLibrary.reloadPackCache(request).pipe(Effect.map((status) => ({ status }))),
        ),
      )
      .add('tileborne:asset-library:resolvePreviews', (request) =>
        ipcCatchAll('tileborne:asset-library:resolvePreviews')(
          assetLibrary
            .resolvePreviews({ packId: request.packId, refs: request.refs })
            .pipe(Effect.map((result) => result)),
        ),
      )
      .add('tileborne:asset-library:getEditorIndex', (request) =>
        ipcCatchAll('tileborne:asset-library:getEditorIndex')(
          assetLibrary
            .getEditorIndex({ packId: request.packId })
            .pipe(Effect.map((result) => result)),
        ),
      )
      .add('tileborne:asset-library:getPackUseSites', (request) =>
        ipcCatchAll('tileborne:asset-library:getPackUseSites')(getAssetPackUseSites(request)),
      )
      .build();

    const workingPaletteHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:working-palettes:list', (request) =>
        ipcCatchAll('tileborne:working-palettes:list')(workingPalettes.list(request)),
      )
      .add('tileborne:working-palettes:getActive', (request) =>
        ipcCatchAll('tileborne:working-palettes:getActive')(
          workingPalettes
            .getActive(request)
            .pipe(Effect.map((palette) => (palette === undefined ? {} : { palette }))),
        ),
      )
      .add('tileborne:working-palettes:create', (request) =>
        ipcCatchAll('tileborne:working-palettes:create')(
          workingPalettes.create(request).pipe(Effect.map((palette) => ({ palette }))),
        ),
      )
      .add('tileborne:working-palettes:update', (request) =>
        ipcCatchAll('tileborne:working-palettes:update')(
          workingPalettes.update(request).pipe(Effect.map((palette) => ({ palette }))),
        ),
      )
      .add('tileborne:working-palettes:delete', (request) =>
        ipcCatchAll('tileborne:working-palettes:delete')(
          workingPalettes.delete(request).pipe(Effect.as({})),
        ),
      )
      .add('tileborne:working-palettes:setActive', (request) =>
        ipcCatchAll('tileborne:working-palettes:setActive')(
          workingPalettes.setActive(request).pipe(Effect.map((palette) => ({ palette }))),
        ),
      )
      .add('tileborne:working-palettes:addItems', (request) =>
        ipcCatchAll('tileborne:working-palettes:addItems')(
          workingPalettes.addItems(request).pipe(Effect.map((palette) => ({ palette }))),
        ),
      )
      .add('tileborne:working-palettes:removeItem', (request) =>
        ipcCatchAll('tileborne:working-palettes:removeItem')(
          workingPalettes.removeItem(request).pipe(Effect.map((palette) => ({ palette }))),
        ),
      )
      .add('tileborne:working-palettes:reorderItems', (request) =>
        ipcCatchAll('tileborne:working-palettes:reorderItems')(
          workingPalettes.reorderItems(request).pipe(Effect.map((palette) => ({ palette }))),
        ),
      )
      .build();

    const catalogHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:catalog:resolve', ({ projectId }) =>
        ipcCatchAll('tileborne:catalog:resolve')(catalog.resolve(projectId)),
      )
      .add('tileborne:catalog:validate', ({ projectId }) =>
        ipcCatchAll('tileborne:catalog:validate')(catalog.validate(projectId)),
      )
      .add('tileborne:catalog:import', ({ projectId, catalogJson }) =>
        ipcCatchAll('tileborne:catalog:import')(
          catalog
            .importCatalog(projectId, catalogJson)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'catalog')),
              ),
            ),
        ),
      )
      .add('tileborne:catalog:export', ({ projectId }) =>
        ipcCatchAll('tileborne:catalog:export')(catalog.exportCatalog(projectId)),
      )
      .add('tileborne:catalog:upsertType', ({ projectId, objectTypeJson }) =>
        ipcCatchAll('tileborne:catalog:upsertType')(
          catalog
            .upsertType(projectId, objectTypeJson)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'catalog')),
              ),
            ),
        ),
      )
      .add('tileborne:catalog:removeType', ({ projectId, objectTypeId }) =>
        ipcCatchAll('tileborne:catalog:removeType')(
          catalog
            .removeType(projectId, objectTypeId)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'catalog')),
              ),
            ),
        ),
      )
      .add('tileborne:catalog:upsertDefinition', ({ projectId, kind, definitionJson, label }) =>
        ipcCatchAll('tileborne:catalog:upsertDefinition')(
          catalog
            .upsertDefinition(projectId, kind, definitionJson, label)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'catalog')),
              ),
            ),
        ),
      )
      .add('tileborne:catalog:duplicateDefinition', ({ projectId, kind, definitionId, label }) =>
        ipcCatchAll('tileborne:catalog:duplicateDefinition')(
          catalog
            .duplicateDefinition(projectId, kind, definitionId, label)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'catalog')),
              ),
            ),
        ),
      )
      .add('tileborne:catalog:removeDefinition', ({ projectId, kind, definitionId }) =>
        ipcCatchAll('tileborne:catalog:removeDefinition')(
          catalog
            .removeDefinition(projectId, kind, definitionId)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => behaviorReferenceIndex.invalidate(String(projectId), 'catalog')),
              ),
            ),
        ),
      )
      .build();

    const readinessHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:readiness:check', (request) =>
        ipcCatchAll('tileborne:readiness:check')(checkReadiness(request)),
      )
      .build();

    const pluginHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:plugins:list', () =>
        ipcCatchAll('tileborne:plugins:list')(
          registry.list().pipe(Effect.map((items) => ({ plugins: items.map(toPluginSummary) }))),
        ),
      )
      .add('tileborne:plugins:install', ({ source }) =>
        ipcCatchAll('tileborne:plugins:install')(
          Effect.gen(function* () {
            const decoded = Schema.decodeUnknownSync(PluginSource)(source);
            const plugin = yield* installer.install(decoded);
            return { plugin: toPluginSummary(plugin) };
          }),
        ),
      )
      .add('tileborne:plugins:installBundledBattleRoyale', () =>
        ipcCatchAll('tileborne:plugins:installBundledBattleRoyale')(
          Effect.gen(function* () {
            const spec = bundledBattleRoyalePluginSpec();
            if (spec === undefined) {
              return yield* Effect.die(
                new Error('bundled plugin spec missing for the requested first-party mode'),
              );
            }
            const plugin = yield* installBundledPluginWithServices(spec, { registry, installer });
            yield* seedBundledPluginAssetPacksWithServices({ registry, assets });
            return { plugin: toPluginSummary(plugin) };
          }),
        ),
      )
      .add('tileborne:plugins:uninstall', ({ pluginId }) =>
        ipcCatchAll('tileborne:plugins:uninstall')(
          installer.uninstall(pluginId).pipe(Effect.as({})),
        ),
      )
      .add('tileborne:plugins:enable', ({ pluginId }) =>
        ipcCatchAll('tileborne:plugins:enable')(
          registry
            .enable(pluginId)
            .pipe(Effect.map((plugin) => ({ plugin: toPluginSummary(plugin) }))),
        ),
      )
      .add('tileborne:plugins:disable', ({ pluginId }) =>
        ipcCatchAll('tileborne:plugins:disable')(
          registry
            .disable(pluginId)
            .pipe(Effect.map((plugin) => ({ plugin: toPluginSummary(plugin) }))),
        ),
      )
      .add('tileborne:plugins:getManifest', ({ pluginId }) =>
        ipcCatchAll('tileborne:plugins:getManifest')(
          registry.getManifest(pluginId).pipe(
            Effect.map((manifest) => ({
              manifest: {
                id: manifest.id,
                version: manifest.version,
                name: manifest.name,
                displayName: manifest.displayName,
                description: manifest.description,
                author: manifest.author,
                license: manifest.license,
                engine: manifest.engines.tileborne,
                contributes: toJsonObject(
                  Schema.encodeSync(PluginContributions)(manifest.contributes),
                ),
                permissions: manifest.permissions.map(formatPluginPermission),
              },
            })),
          ),
        ),
      )
      .add('tileborne:plugins:listContributions', () =>
        ipcCatchAll('tileborne:plugins:listContributions')(
          registry.list().pipe(
            Effect.map((plugins) => {
              const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
              const gameModes = discoverGameModes(
                enabledPlugins.map((plugin) => ({
                  pluginId: plugin.id,
                  contributions: plugin.manifest.contributes,
                })),
              ).map(toGameModeView);
              return {
                panels: enabledPlugins.flatMap((plugin) =>
                  Option.getOrElse(plugin.manifest.contributes.panels, () => []).map(
                    (contribution) => toPluginPanelContributionView(plugin, contribution),
                  ),
                ),
                tools: enabledPlugins.flatMap((plugin) =>
                  Option.getOrElse(plugin.manifest.contributes.tools, () => []).map(
                    (contribution) => toPluginToolContributionView(plugin, contribution),
                  ),
                ),
                gameModes,
              };
            }),
          ),
        ),
      )
      .add('tileborne:plugins:invokeEditorCommand', (request) =>
        ipcCatchAll('tileborne:plugins:invokeEditorCommand')(
          invokePluginEditorCommand({ registry, maps })(request).pipe(
            Effect.map((result) => ({
              ok: result.ok,
              ...(result.message !== undefined ? { message: result.message } : {}),
            })),
            Effect.catch((cause) =>
              Effect.succeed({
                ok: false,
                message: cause instanceof Error ? cause.message : String(cause),
              }),
            ),
          ),
        ),
      )
      .build();

    const jobHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:jobs:list', () =>
        ipcCatchAll('tileborne:jobs:list')(
          jobs.list().pipe(Effect.map((items) => ({ jobs: items.map(toJobView) }))),
        ),
      )
      .add('tileborne:jobs:get', ({ jobId }) =>
        ipcCatchAll('tileborne:jobs:get')(
          Effect.gen(function* () {
            const all = yield* jobs.list();
            const job = all.find((entry) => entry.id === jobId);
            if (!job) {
              return yield* Effect.fail(new Error(`job not found: ${jobId}`));
            }
            return { job: toJobView(job) };
          }),
        ),
      )
      .add('tileborne:jobs:cancel', ({ jobId }) =>
        ipcCatchAll('tileborne:jobs:cancel')(
          jobs.cancel(jobId).pipe(Effect.map((job) => ({ job: toJobView(job) }))),
        ),
      )
      .build();

    const logsHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:logs:listRecent', ({ limit }) =>
        ipcCatchAll('tileborne:logs:listRecent')(
          Effect.gen(function* () {
            const maxEntries = limit ?? 500;
            const filePath = yield* logger
              .latestLogPath()
              .pipe(Effect.orElseSucceed(() => undefined));
            if (filePath === undefined) {
              return { entries: [] };
            }
            const content = yield* Effect.tryPromise({
              try: () => readFile(filePath, 'utf8'),
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            }).pipe(Effect.orElseSucceed(() => ''));
            const rawLines = content.split('\n').filter((line: string) => line.trim().length > 0);
            return { entries: parseLogEntries(rawLines).slice(-maxEntries) };
          }),
        ),
      )
      .build();

    const buildHandlersMap = handlerBuilder(MainIpcRegistry)
      .add('tileborne:builds:build', ({ projectId, target }) =>
        ipcCatchAll('tileborne:builds:build')(
          Effect.gen(function* () {
            const readiness = yield* checkReadiness({ projectId, purpose: 'build' });
            yield* Effect.try({
              try: () => assertExecutionReadiness('builds:build', readiness.report),
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });
            const jobId = yield* builds.build(projectId, {
              target: target !== undefined ? Option.some(target) : Option.none(),
              delayMs: Option.none(),
            });
            return { jobId };
          }),
        ),
      )
      .add('tileborne:builds:getBuild', ({ buildId }) =>
        ipcCatchAll('tileborne:builds:getBuild')(
          builds.getBuild(buildId).pipe(
            Effect.map((artifact) => ({
              build: {
                id: artifact.id,
                projectId: artifact.projectId,
                target: artifact.target,
                createdAt: artifact.createdAt,
                integrityHash: artifact.integrityHash,
              },
            })),
          ),
        ),
      )
      .add('tileborne:builds:listBuilds', ({ projectId }) =>
        ipcCatchAll('tileborne:builds:listBuilds')(
          builds.listBuilds(projectId).pipe(
            Effect.map((items) => ({
              builds: items.map((build) => ({
                id: build.id,
                projectId: build.projectId,
                target: build.target,
                createdAt: build.createdAt,
                integrityHash: build.integrityHash,
              })),
            })),
          ),
        ),
      )
      .add('tileborne:builds:deleteBuild', ({ buildId }) =>
        ipcCatchAll('tileborne:builds:deleteBuild')(
          builds.deleteBuild(buildId).pipe(Effect.as({})),
        ),
      )
      .build();

    /**
     * Creator-facing ship orchestration. This is intentionally a thin owner over
     * canonical readiness + BuildService.buildGame: the renderer never assembles
     * artifacts and the desktop never shells out to the CLI.
     */
    const shipHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:ship:start', ({ projectId, startupMapId, target }) =>
        ipcCatchAll('tileborne:ship:start')(
          Effect.gen(function* () {
            const project = yield* projects.open(projectId);
            if (!project.maps.some((map) => map.id === startupMapId)) {
              return yield* Effect.fail(
                new Error(`Startup map is not part of this project: ${startupMapId}`),
              );
            }

            const configuredProject = new ProjectManifest({
              ...project,
              settings: {
                ...(project.settings ?? {}),
                [PROJECT_STARTUP_MAP_SETTINGS_KEY]: startupMapId,
                [PROJECT_SHIP_TARGET_SETTINGS_KEY]: target,
              },
            });
            yield* projects.save(configuredProject);

            const readiness = yield* checkReadiness({
              projectId,
              mapId: startupMapId,
              purpose: 'build',
            });
            yield* Effect.try({
              try: () => assertExecutionReadiness('ship:start', readiness.report),
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });

            const installed = yield* registry.list();
            const activeMode = resolveActiveGameMode(
              discoverGameModes(
                installed
                  .filter((plugin) => plugin.enabled)
                  .map((plugin) => ({
                    pluginId: plugin.id,
                    contributions: plugin.manifest.contributes,
                  })),
              ),
              readActiveGameModeSetting(configuredProject.settings) as GameModeId | undefined,
            );
            if (activeMode === undefined) {
              return yield* Effect.fail(new Error('No active game mode is available to ship.'));
            }

            const jobIdReady = yield* Deferred.make<JobId>();
            const run = Effect.gen(function* () {
              const jobId = yield* Deferred.await(jobIdReady);
              yield* jobs.report(jobId, {
                progress: 0.15,
                message: `Readiness passed for startup map ${startupMapId}.`,
              });
              yield* jobs.report(jobId, {
                progress: 0.3,
                message: `Assembling canonical ${target} game artifact.`,
              });
              const artifact = yield* builds.buildGame(
                new GameBuildOptions({
                  pluginId: String(activeMode.pluginId),
                  target,
                  outputDirectory: Option.none(),
                  assetPackIds:
                    configuredProject.assetPacks.length > 0
                      ? Option.some(configuredProject.assetPacks.map((pack) => pack.id))
                      : Option.none(),
                  siteName: Option.some(configuredProject.name),
                  projectId: Option.some(String(projectId)),
                  mapIds: Option.some([String(startupMapId)]),
                }),
              );
              yield* jobs.report(jobId, {
                progress: 0.9,
                message: `Artifact verified: ${artifact.buildId}.`,
              });
              return {
                projectId,
                startupMapId,
                pluginId: artifact.pluginId,
                target: artifact.target,
                directory: artifact.directory,
                manifestPath: artifact.manifestPath,
                bundlePath: artifact.bundlePath,
                buildId: artifact.buildId,
                runtimeBuildId: artifact.runtimeBuildId,
                integrityHash: artifact.integrityHash,
                createdAt: artifact.createdAt,
                files: [...artifact.files],
                fileHashes: { ...artifact.fileHashes },
                previewCommand: `tileborne game serve --dir "${artifact.directory}"`,
              };
            });
            const jobId = yield* jobs.create({ name: `ship ${projectId}`, run });
            yield* Deferred.succeed(jobIdReady, jobId);
            return { jobId };
          }),
        ),
      )
      .add('tileborne:ship:launchPreview', ({ artifact }) =>
        ipcCatchAll('tileborne:ship:launchPreview')(
          Effect.gen(function* () {
            yield* builds.verifyGameArtifact(
              new GameBuildArtifact({
                pluginId: artifact.pluginId,
                target: artifact.target,
                directory: artifact.directory,
                manifestPath: artifact.manifestPath,
                bundlePath: artifact.bundlePath,
                buildId: artifact.buildId,
                runtimeBuildId: artifact.runtimeBuildId,
                integrityHash: artifact.integrityHash,
                createdAt: artifact.createdAt,
                files: artifact.files,
                fileHashes: artifact.fileHashes,
              }),
            );
            return yield* Effect.tryPromise({
              try: async () => {
                const host = await startDesktopLocalGameHost(undefined, artifact.directory);
                const response = await fetch(`${host.baseUrl}/rooms/create`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ mapId: artifact.startupMapId }),
                });
                const payload = (await response.json()) as {
                  readonly roomId?: unknown;
                  readonly error?: unknown;
                };
                if (!response.ok || typeof payload.roomId !== 'string') {
                  throw new Error(
                    typeof payload.error === 'string'
                      ? payload.error
                      : `Packaged preview room failed with HTTP ${response.status}.`,
                  );
                }
                createPlaytestJoinWindow({
                  projectId: artifact.projectId,
                  mapId: artifact.startupMapId,
                  baseUrl: host.baseUrl,
                  roomId: payload.roomId,
                });
                return { baseUrl: host.baseUrl, roomId: payload.roomId };
              },
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });
          }),
        ),
      )
      .add('tileborne:ship:openArtifact', ({ directory }) =>
        ipcCatchAll('tileborne:ship:openArtifact')(
          Effect.gen(function* () {
            yield* builds.verifyGameArtifact(directory);
            return yield* Effect.tryPromise({
              try: async () => {
                const error = await shell.openPath(directory);
                if (error.length > 0) {
                  throw new Error(error);
                }
                return { opened: true };
              },
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });
          }),
        ),
      )
      .build();

    const exportHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:exports:exportBuild', ({ buildId, target }) =>
        ipcCatchAll('tileborne:exports:exportBuild')(
          Effect.gen(function* () {
            const decoded = Schema.decodeUnknownSync(ExportTarget)(target);
            const jobId = yield* exports.exportBuild(buildId, decoded);
            return { jobId };
          }),
        ),
      )
      .add('tileborne:exports:getExport', ({ exportId }) =>
        ipcCatchAll('tileborne:exports:getExport')(
          exports.getExport(exportId).pipe(
            Effect.map((artifact) => ({
              export: {
                id: artifact.id,
                buildId: artifact.buildId,
                target: artifact.target,
                createdAt: artifact.createdAt,
                integrityHash: artifact.integrityHash,
              },
            })),
          ),
        ),
      )
      .add('tileborne:exports:listExports', ({ buildId }) =>
        ipcCatchAll('tileborne:exports:listExports')(
          exports.listExports(buildId).pipe(
            Effect.map((items) => ({
              exports: items.map((artifact) => ({
                id: artifact.id,
                buildId: artifact.buildId,
                target: artifact.target,
                createdAt: artifact.createdAt,
                integrityHash: artifact.integrityHash,
              })),
            })),
          ),
        ),
      )
      .add('tileborne:exports:deleteExport', ({ exportId }) =>
        ipcCatchAll('tileborne:exports:deleteExport')(
          exports.deleteExport(exportId).pipe(Effect.as({})),
        ),
      )
      .build();

    const tiledSourceRulesHandlers = handlerBuilder(MainIpcRegistry)
      .add(
        'tileborne:tiled-source-rules:compilePreview',
        ({ manifestId, manifest, includeDiagnostics }) =>
          compileTiledSourceRulePipeline(manifest).pipe(
            Effect.map((pipeline) => ({
              manifestId,
              sourceDigest: pipeline.sourceDigest,
              pipeline,
              diagnostics: includeDiagnosticsEnabled(includeDiagnostics)
                ? pipeline.diagnostics
                : [],
            })),
          ),
      )
      .add('tileborne:tiled-source-rules:runtimeApply', ({ manifestId, pipeline, input }) =>
        projectTiledSourceRuleApplication(pipeline, input).pipe(
          Effect.map((output) => ({
            manifestId,
            sourceDigest: output.sourceDigest,
            output,
          })),
        ),
      )
      .build();

    const playtestHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:playtest:start', ({ projectId, mapId, selectedPlayerModelId }) =>
        ipcCatchAll('tileborne:playtest:start')(
          Effect.gen(function* () {
            const readiness = yield* checkReadiness({ projectId, mapId, purpose: 'playtest' });
            yield* Effect.try({
              try: () => assertExecutionReadiness('playtest:start', readiness.report),
              catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            });
            const session = yield* playtest.start(projectId, mapId);
            const artifactDirectory = Option.getOrUndefined(session.artifactDirectory);
            if (artifactDirectory && session.activePlugins.length > 0) {
              const installed = yield* registry.list();
              const pluginInstalls = session.activePlugins.flatMap((pluginId) => {
                const plugin = installed.find((entry) => entry.id === pluginId);
                return plugin ? [{ pluginId, rootPath: plugin.rootPath }] : [];
              });
              const activePluginId = session.activePlugins[0];
              const activeInstall = pluginInstalls.find(
                (install) => install.pluginId === activePluginId,
              );
              if (
                pluginInstalls.length > 0 &&
                activePluginId !== undefined &&
                activeInstall !== undefined
              ) {
                const project = yield* projects.open(projectId);
                const activeMode = resolveProjectGameMode(project, installed);
                const hostRegistration = resolveGameModeHostRegistration(
                  activeMode?.readinessCapabilityId,
                );
                const playerModels = hostRegistration?.resolvePlayerModels(project) ?? [];
                if (hostRegistration?.requiresPlayerModel === true) {
                  if (playerModels.length === 0) {
                    yield* playtest.stop(session.id).pipe(Effect.catch(() => Effect.void));
                    yield* Effect.fail(
                      new Error(
                        `${activeMode?.label ?? 'Active mode'} playtest requires at least one valid player model.`,
                      ),
                    );
                  }
                  if (
                    selectedPlayerModelId !== undefined &&
                    !playerModels.some((model) => model.id === selectedPlayerModelId)
                  ) {
                    yield* playtest.stop(session.id).pipe(Effect.catch(() => Effect.void));
                    yield* Effect.fail(
                      new Error(
                        `Selected ${activeMode?.label ?? 'game-mode'} player model does not exist: ${selectedPlayerModelId}`,
                      ),
                    );
                  }
                }
                // ADR-0030: assemble the typed runtime map package into the
                // session's artifact directory; the host boots ONLY from it.
                yield* assemblePlaytestMapPackage({
                  projectId,
                  mapId,
                  activePluginId,
                  pluginRootPath: activeInstall.rootPath,
                  playerModels,
                  outputDirectory: artifactDirectory,
                }).pipe(
                  Effect.catch((error) =>
                    playtest.stop(session.id).pipe(
                      Effect.catch(() => Effect.void),
                      Effect.flatMap(() =>
                        Effect.fail(
                          new Error(error instanceof Error ? error.message : String(error)),
                        ),
                      ),
                    ),
                  ),
                );
                yield* Effect.tryPromise({
                  try: () =>
                    startPlaytestRuntimeHost({
                      sessionId: session.id,
                      projectId,
                      mapId,
                      packageDirectory: artifactDirectory,
                      pluginInstalls,
                      ...(selectedPlayerModelId === undefined ? {} : { selectedPlayerModelId }),
                      logger: {
                        info: (message, fields) => Effect.runPromise(logger.info(message, fields)),
                        error: (message, fields) =>
                          Effect.runPromise(logger.error(message, fields)),
                      },
                    }),
                  catch: (cause) =>
                    new Error(cause instanceof Error ? cause.message : String(cause)),
                }).pipe(
                  Effect.catch((error) =>
                    playtest.stop(session.id).pipe(
                      Effect.catch(() => Effect.void),
                      Effect.flatMap(() => Effect.fail(error)),
                    ),
                  ),
                );
              }
            }
            return { session: toPlaytestSessionView(session) };
          }),
        ),
      )
      .add('tileborne:playtest:stop', ({ sessionId, projectId, mapId }) =>
        ipcCatchAll('tileborne:playtest:stop')(
          Effect.gen(function* () {
            const session = yield* stopOwnedPlaytestSession({ sessionId, projectId, mapId }).pipe(
              Effect.provideService(PlaytestService, playtest),
            );
            return { session: toPlaytestSessionView(session) };
          }),
        ),
      )
      .add('tileborne:playtest:list', () =>
        ipcCatchAll('tileborne:playtest:list')(
          playtest.list().pipe(
            Effect.map((sessions) => ({
              sessions: sessions.map((session) => toPlaytestSessionView(session)),
            })),
          ),
        ),
      )
      .add('tileborne:playtest:behaviorDebugInspect', ({ sessionId }) =>
        ipcCatchAll('tileborne:playtest:behaviorDebugInspect')(
          Effect.try({
            try: () => {
              const snapshot = getPlaytestBehaviorDebugSnapshot(sessionId);
              if (snapshot === undefined) {
                throw new Error(`No behavior runtime is active for ${sessionId}`);
              }
              return { snapshot: { ...snapshot, sessionId } };
            },
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .add('tileborne:playtest:behaviorDebugControl', ({ sessionId, command }) =>
        ipcCatchAll('tileborne:playtest:behaviorDebugControl')(
          Effect.tryPromise({
            try: async () => ({
              snapshot: { ...(await controlPlaytestBehaviorDebug(sessionId, command)), sessionId },
            }),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .add('tileborne:playtest:lifecycleControl', ({ sessionId, command }) =>
        ipcCatchAll('tileborne:playtest:lifecycleControl')(
          Effect.try({
            try: () => ({ status: controlPlaytestRuntimeLifecycle(sessionId, command) }),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .add('tileborne:playtest:shellEvent', ({ sessionId, event }) =>
        ipcCatchAll('tileborne:playtest:shellEvent')(
          Effect.tryPromise({
            try: async () => ({
              requests: await emitPlaytestShellBehaviorEvent(sessionId, event),
            }),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .build();

    const runtimeHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:runtime:startLocalHost', ({ port }) =>
        ipcCatchAll('tileborne:runtime:startLocalHost')(
          Effect.tryPromise({
            try: () => startDesktopLocalGameHost(port),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .add('tileborne:runtime:stopLocalHost', () =>
        ipcCatchAll('tileborne:runtime:stopLocalHost')(
          Effect.tryPromise({
            try: () => stopDesktopLocalGameHost(),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }).pipe(Effect.as({})),
        ),
      )
      .add(
        'tileborne:runtime:prepareLocalRoomArtifact',
        ({ projectId, mapId, selectedPlayerModelId }) =>
          ipcCatchAll('tileborne:runtime:prepareLocalRoomArtifact')(
            Effect.gen(function* () {
              const readiness = yield* checkReadiness({ projectId, mapId, purpose: 'playtest' });
              yield* Effect.try({
                try: () =>
                  assertExecutionReadiness('runtime:prepareLocalRoomArtifact', readiness.report),
                catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
              });
              const project = yield* projects.open(projectId);
              const installed = yield* registry.list();
              const activePlugins = activePlaytestPluginIds(
                installed.map((plugin) => ({
                  pluginId: plugin.id,
                  enabled: plugin.enabled,
                  contributions: plugin.manifest.contributes,
                })),
                readActiveGameModeSetting(project.settings) as GameModeId | undefined,
              );
              if (activePlugins.length !== 1) {
                return yield* Effect.fail(
                  new Error('Select one active game mode before hosting a multiplayer playtest.'),
                );
              }
              const activePluginId = activePlugins[0];
              if (activePluginId === undefined) {
                return yield* Effect.fail(
                  new Error('Select one active game mode before hosting a multiplayer playtest.'),
                );
              }
              const activeMode = resolveProjectGameMode(project, installed);
              const hostRegistration = resolveGameModeHostRegistration(
                activeMode?.readinessCapabilityId,
              );
              if (hostRegistration?.supportsLocalMultiplayer !== true) {
                return yield* Effect.fail(
                  new Error(
                    `Local multiplayer host is not registered for ${activeMode?.label ?? activePluginId}.`,
                  ),
                );
              }
              const plugin = installed.find((entry) => entry.id === activePluginId);
              if (!plugin) {
                return yield* Effect.fail(
                  new Error(`Active game-mode plugin is not installed: ${activePluginId}`),
                );
              }
              const activePlugin = plugin;
              const playerModels = hostRegistration.resolvePlayerModels(project);
              if (playerModels.length === 0) {
                return yield* Effect.fail(
                  new Error(
                    `${activeMode?.label ?? 'Active mode'} playtest requires at least one valid player model.`,
                  ),
                );
              }
              if (
                selectedPlayerModelId !== undefined &&
                !playerModels.some((model) => model.id === selectedPlayerModelId)
              ) {
                return yield* Effect.fail(
                  new Error(
                    `Selected ${activeMode?.label ?? 'game-mode'} player model does not exist: ${selectedPlayerModelId}`,
                  ),
                );
              }
              const artifact = yield* playtest.assembleArtifact({
                projectId,
                mapId,
                plugins: activePlugins,
              });
              // ADR-0030: the multiplayer room boots from the SAME typed runtime
              // map package the single-player playtest host boots from.
              yield* assemblePlaytestMapPackage({
                projectId,
                mapId,
                activePluginId,
                pluginRootPath: activePlugin.rootPath,
                playerModels,
                outputDirectory: artifact.directory,
              }).pipe(
                Effect.catch((error) =>
                  Effect.fail(new Error(error instanceof Error ? error.message : String(error))),
                ),
              );
              const mapPackage = yield* Effect.tryPromise({
                try: () => loadPlaytestMapPackage(artifact.directory),
                catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
              });
              return {
                mapId,
                mapPackage: toJsonObject(mapPackage),
                // The hosting player joins first and always takes the player-1 slot.
                playerModelSelections:
                  selectedPlayerModelId === undefined
                    ? []
                    : [{ playerId: 'player-1', modelId: selectedPlayerModelId }],
              };
            }),
          ),
      )
      .add(
        'tileborne:runtime:playtestInput',
        ({
          sessionId,
          playerId,
          tick,
          seq,
          dir,
          shoot,
          reload,
          interact,
          drop,
          abilities,
          aimDeg,
          swapSlot,
          active,
        }) =>
          ipcCatchAll('tileborne:runtime:playtestInput')(
            Effect.sync(() => {
              const resolvedPlayerId = playerId ?? 'player-1';
              if (active === false) {
                clearPlaytestRuntimeInput(sessionId, resolvedPlayerId);
              } else {
                setPlaytestRuntimeInput(sessionId, resolvedPlayerId, {
                  tick,
                  seq,
                  ...(dir !== undefined ? { dir } : {}),
                  shoot,
                  reload,
                  interact,
                  drop,
                  abilities,
                  ...(aimDeg !== undefined ? { aimDeg } : {}),
                  ...(swapSlot !== undefined ? { swapSlot } : {}),
                });
              }
              return {};
            }),
          ),
      )
      .add('tileborne:runtime:playtestSnapshot', ({ sessionId }) =>
        ipcCatchAll('tileborne:runtime:playtestSnapshot')(
          Effect.sync(() => getPlaytestRuntimeSnapshot(sessionId) ?? { players: [] }),
        ),
      )
      .build();

    const runtimeDeployTarget = (target: {
      readonly adapterId?: 'local' | 'alchemy-cloudflare' | undefined;
      readonly stage: 'local' | 'dev' | 'staging' | 'production';
      readonly workerName: string;
    }) =>
      new RuntimeDeployTarget({
        adapterId: target.adapterId === undefined ? Option.none() : Option.some(target.adapterId),
        stage: target.stage,
        workerName: target.workerName,
        credentials: Option.none(),
      });

    const deployHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:runtime-deploy:plan', ({ buildId, target }) =>
        ipcCatchAll('tileborne:runtime-deploy:plan')(
          deploy.plan(buildId, runtimeDeployTarget(target)),
        ),
      )
      .add('tileborne:runtime-deploy:preview', ({ buildId, target }) =>
        ipcCatchAll('tileborne:runtime-deploy:preview')(
          deploy.preview(buildId, runtimeDeployTarget(target)),
        ),
      )
      .add('tileborne:runtime-deploy:deploy', ({ buildId, target }) =>
        ipcCatchAll('tileborne:runtime-deploy:deploy')(
          Effect.gen(function* () {
            const jobId = yield* deploy.deploy(buildId, runtimeDeployTarget(target));
            return { jobId };
          }),
        ),
      )
      .add('tileborne:runtime-deploy:status', ({ deploymentId }) =>
        ipcCatchAll('tileborne:runtime-deploy:status')(deploy.status(deploymentId)),
      )
      .add('tileborne:runtime-deploy:logs', ({ deploymentId }) =>
        ipcCatchAll('tileborne:runtime-deploy:logs')(deploy.logs(deploymentId)),
      )
      .add('tileborne:runtime-deploy:destroy', ({ deploymentId }) =>
        ipcCatchAll('tileborne:runtime-deploy:destroy')(
          deploy.destroy(deploymentId).pipe(Effect.as({})),
        ),
      )
      .add('tileborne:runtime-deploy:getDeployment', ({ deploymentId }) =>
        ipcCatchAll('tileborne:runtime-deploy:getDeployment')(
          deploy.getDeployment(deploymentId).pipe(
            Effect.map((deployment) => ({
              deployment: {
                id: deployment.id,
                buildId: deployment.buildId,
                target: {
                  adapterId: deployment.target.adapterId,
                  stage: deployment.target.stage,
                  workerName: deployment.target.workerName,
                },
                createdAt: deployment.createdAt,
                integrityHash: deployment.integrityHash,
              },
            })),
          ),
        ),
      )
      .add('tileborne:runtime-deploy:listDeployments', ({ buildId }) =>
        ipcCatchAll('tileborne:runtime-deploy:listDeployments')(
          deploy.listDeployments(buildId).pipe(
            Effect.map((items) => ({
              deployments: items.map((deployment) => ({
                id: deployment.id,
                buildId: deployment.buildId,
                target: {
                  adapterId: deployment.target.adapterId,
                  stage: deployment.target.stage,
                  workerName: deployment.target.workerName,
                },
                createdAt: deployment.createdAt,
                integrityHash: deployment.integrityHash,
              })),
            })),
          ),
        ),
      )
      .add('tileborne:runtime-deploy:deleteDeployment', ({ deploymentId }) =>
        ipcCatchAll('tileborne:runtime-deploy:deleteDeployment')(
          deploy.deleteDeployment(deploymentId).pipe(Effect.as({})),
        ),
      )
      .build();

    const supportHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:support:createBundle', () =>
        ipcCatchAll('tileborne:support:createBundle')(
          support.createBundle().pipe(Effect.map((jobId) => ({ jobId }))),
        ),
      )
      .add('tileborne:support:getBundle', ({ bundleId }) =>
        ipcCatchAll('tileborne:support:getBundle')(
          support.getBundle(bundleId).pipe(
            Effect.map((bundle) => ({
              bundle: {
                id: bundle.id,
                createdAt: bundle.createdAt,
                integrityHash: bundle.integrityHash,
              },
            })),
          ),
        ),
      )
      .add('tileborne:support:listBundles', () =>
        ipcCatchAll('tileborne:support:listBundles')(
          support.listBundles().pipe(
            Effect.map((bundles) => ({
              bundles: bundles.map((bundle) => ({
                id: bundle.id,
                createdAt: bundle.createdAt,
                integrityHash: bundle.integrityHash,
              })),
            })),
          ),
        ),
      )
      .add('tileborne:support:deleteBundle', ({ bundleId }) =>
        ipcCatchAll('tileborne:support:deleteBundle')(
          support.deleteBundle(bundleId).pipe(Effect.as({})),
        ),
      )
      .build();

    const desktopUpdateHandlers = createDesktopUpdateHandlers(desktopUpdater);
    const systemHandlers = handlerBuilder(MainIpcRegistry)
      .add('tileborne:system:ping', () =>
        ipcCatchAll('tileborne:system:ping')(Effect.succeed({ pong: true, ts: Date.now() })),
      )
      .add('tileborne:system:getVersion', () =>
        ipcCatchAll('tileborne:system:getVersion')(
          Effect.succeed({
            appVersion: app.getVersion(),
            electronVersion: process.versions.electron ?? '',
            chromeVersion: process.versions.chrome ?? '',
            nodeVersion: process.versions.node,
          }),
        ),
      )
      .add('tileborne:system:getHomePaths', () =>
        ipcCatchAll('tileborne:system:getHomePaths')(
          Effect.gen(function* () {
            const paths = yield* home.init();
            return { paths };
          }),
        ),
      )
      .add('tileborne:system:pickDirectory', () =>
        ipcCatchAll('tileborne:system:pickDirectory')(
          Effect.tryPromise({
            try: async () => {
              const result = await dialog.showOpenDialog({
                properties: ['openDirectory'],
              });
              if (result.canceled || result.filePaths.length === 0) {
                return {};
              }
              return { path: result.filePaths[0] };
            },
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .add('tileborne:system:pickImportSource', () =>
        ipcCatchAll('tileborne:system:pickImportSource')(
          Effect.tryPromise({
            try: async () => {
              const result = await dialog.showOpenDialog({
                filters: importSourceDialogFilters,
                properties: ['openFile', 'openDirectory'],
              });
              if (result.canceled || result.filePaths.length === 0) {
                return {};
              }
              return { path: result.filePaths[0] };
            },
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }),
        ),
      )
      .add('tileborne:system:openPlaytestJoinWindow', ({ projectId, mapId, baseUrl, roomId }) =>
        ipcCatchAll('tileborne:system:openPlaytestJoinWindow')(
          Effect.sync(() => {
            createPlaytestJoinWindow({ projectId, mapId, baseUrl, roomId });
            return { opened: true };
          }),
        ),
      )
      .build();

    const handlers = defineHandlers(MainIpcRegistry, {
      ...projectHandlers,
      ...audioHandlers,
      ...gameShellHandlers,
      ...behaviorHandlers,
      ...mapHandlers,
      ...tiledImportHandlers,
      ...assetHandlers,
      ...assetLibraryHandlers,
      ...workingPaletteHandlers,
      ...catalogHandlers,
      ...readinessHandlers,
      ...pluginHandlers,
      ...jobHandlers,
      ...logsHandlers,
      ...buildHandlersMap,
      ...shipHandlers,
      ...exportHandlers,
      ...tiledSourceRulesHandlers,
      ...playtestHandlers,
      ...runtimeHandlers,
      ...deployHandlers,
      ...supportHandlers,
      ...systemHandlers,
      ...desktopUpdateHandlers,
    });

    return {
      handlers,
      projects,
      maps,
      assets,
      registry,
      installer,
      jobs,
      builds,
      exports,
      playtest,
      deploy,
      support,
      behaviorReferenceIndex,
    };
  });

export const buildMainIpcHandlersForTests = buildHandlers;

export interface MainIpcRegistration {
  readonly handlers: RegisteredHandlers;
  readonly events: RegisteredEventHandlers;
}

export const registerMainIpc = (
  desktopUpdater: DesktopUpdaterController = createDesktopUpdaterController(),
) =>
  Effect.gen(function* () {
    const {
      handlers: handlerMap,
      projects,
      maps,
      assets,
      registry,
      jobs,
      builds,
      exports,
      playtest,
      deploy,
      support,
      behaviorReferenceIndex,
    } = yield* buildHandlers(desktopUpdater);
    const logger = yield* LoggerService;

    const transport = createElectronIpcServerTransport();
    setPlaytestRuntimeChangedNotifier(() => {
      transport.emit('tileborne:playtest:changed', triggerPayload);
    });
    setPlaytestRuntimeSnapshotNotifier(undefined);
    const registeredHandlers = registerIpcHandlers(MainIpcRegistry, transport, handlerMap);

    const registeredEvents = registerIpcEvents(
      MainEventRegistry,
      transport,
      {
        'tileborne:runtime:snapshot': (emit) =>
          Effect.sync(() => {
            setPlaytestRuntimeSnapshotNotifier((sessionId, frame) => {
              void Effect.runPromise(emit({ sessionId, frame }));
            });
          }),
        'tileborne:projects:changed': (emit) =>
          wireTrigger(projects.subscribe, emit, () => behaviorReferenceIndex.invalidate()),
        'tileborne:maps:changed': (emit) =>
          wireTrigger(
            Stream.flatMap(projects.subscribe, (list) => {
              if (list.length === 0) {
                return Stream.empty;
              }
              return Stream.mergeAll(
                list.map((project) =>
                  maps.subscribe(project.id).pipe(Stream.map(() => triggerPayload)),
                ),
                { concurrency: 'unbounded' },
              );
            }),
            emit,
            () => behaviorReferenceIndex.invalidate(),
          ),
        'tileborne:assets:changed': (emit) =>
          wireTrigger(assets.subscribe, emit, () => behaviorReferenceIndex.invalidate()),
        'tileborne:assets:capabilityRefreshed': (emit) =>
          Stream.runForEach(assets.subscribeCapability, emit),
        'tileborne:plugins:changed': (emit) =>
          wireTrigger(registry.subscribe.pipe(Stream.map(() => triggerPayload)), emit, () =>
            behaviorReferenceIndex.invalidate(),
          ),
        'tileborne:jobs:changed': (emit) =>
          Effect.forever(
            Effect.gen(function* () {
              yield* jobs.list();
              yield* emit(triggerPayload);
              yield* Effect.sleep('500 millis');
            }),
          ),
        'tileborne:builds:changed': (emit) => wireTrigger(builds.subscribe, emit),
        'tileborne:exports:changed': (emit) => wireTrigger(exports.subscribe, emit),
        'tileborne:playtest:changed': (emit) => wireTrigger(playtest.subscribe, emit),
        'tileborne:deployments:changed': (emit) => wireTrigger(deploy.subscribe, emit),
        'tileborne:support:changed': (emit) => wireTrigger(support.subscribe, emit),
        'tileborne:logs:appended': (emit) => wireTrigger(logger.subscribe, emit),
        'tileborne:tiled-source-rules:compile-progress': () => Effect.void,
        'tileborne:tiled-source-rules:runtime-apply-progress': () => Effect.void,
        'tileborne:tiled-source-rules:diagnostics': () => Effect.void,
        'tileborne:desktop-updates:stateChanged': () => Effect.void,
      },
      { runtime: appRuntime },
    );

    const events: RegisteredEventHandlers = {
      unregister: () => {
        setPlaytestRuntimeSnapshotNotifier(undefined);
        registeredEvents.unregister();
      },
    };

    return { handlers: registeredHandlers, events };
  });

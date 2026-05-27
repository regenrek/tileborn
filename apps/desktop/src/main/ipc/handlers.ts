import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { app, dialog } from 'electron';
import { Effect, Option, Schema, Stream } from 'effect';

import { AssetPackManifest } from '@tileborne/asset-pipeline';
import {
  hashJsonStable,
  type ContentHash,
  type JsonObject,
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
} from '@tileborne/ipc-contracts';
import {
  AssetLibraryService,
  AssetService,
  MapService,
  ProjectService,
  WorkingPaletteService,
  removeAssetPack,
  toMapIpcPayload,
  type AssetPackWithCapability,
} from '@tileborne/services-app';
import {
  BuildService,
  ExportService,
  ExportTarget,
  PlaytestService,
  RuntimeDeployService,
  RuntimeDeployTarget,
  SupportService,
  type PlaytestSession,
} from '@tileborne/services-build';
import { HomeService, JobService, type JobState } from '@tileborne/services-foundation';
import { LoggerService } from '@tileborne/services-foundation';
import {
  PluginInstallerService,
  PluginRegistryService,
  LocalPluginSource,
  PluginSource,
  type InstalledPlugin,
} from '@tileborne/services-plugin';
import {
  PluginContributions,
  type PluginPanelContribution,
  type PluginToolContribution,
} from '@tileborne/plugin-api';
import { InvalidSourceManifestError } from '@tileborne/sdk-tileset/tiled-source-rules';
import type { TiledImportProfile } from '@tileborne/sdk-tileset/tiled';

import { ipcCatchAll } from './errors.js';
import {
  importSourceDialogFilters,
  TILED_MAP_SOURCE_EXTENSIONS,
  TILED_TILESET_SOURCE_EXTENSIONS,
} from './import-source-dialog.js';
import { createElectronIpcServerTransport } from './transport.js';
import {
  clearPlaytestRuntimeInput,
  getPlaytestRuntimeMetrics,
  getPlaytestRuntimeSnapshot,
  setPlaytestRuntimeChangedNotifier,
  setPlaytestRuntimeInput,
  setPlaytestRuntimeSnapshotNotifier,
  startPlaytestRuntimeHost,
  stopPlaytestRuntimeHost,
} from '../playtest-runtime-host.js';
import { startDesktopLocalGameHost, stopDesktopLocalGameHost } from '../local-game-host-manager.js';
import { invokePluginEditorCommand } from '../plugin-editor-command.js';
import { BATTLE_ROYALE_PLUGIN_ID, resolveBattleRoyalePluginPath } from '../battle-royale-path.js';
import { appRuntime } from '../runtime.js';
import { createPlaytestJoinWindow } from '../window.js';

const triggerPayload = {};
const TILEBORNE_PACK_MANIFEST = 'tileborne-asset-pack.json';
const TILED_MAP_SOURCE_EXTENSION_SET = new Set(TILED_MAP_SOURCE_EXTENSIONS.map((extension) => `.${extension}`));
const TILED_TILESET_SOURCE_EXTENSION_SET = new Set(TILED_TILESET_SOURCE_EXTENSIONS.map((extension) => `.${extension}`));

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

const toJobView = (job: JobState) => ({
  id: job.id,
  status: job.status._tag,
  progress: Option.getOrUndefined(job.progress),
  result: Option.getOrUndefined(job.result),
  errorMessage: Option.match(job.error, {
    onNone: () => undefined,
    onSome: (error) => error.message,
  }),
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
): Partial<Record<Key, Value>> => (value === undefined ? {} : { [key]: value } as Record<Key, Value>);

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
const TILED_SOURCE_RULES_RUNTIME_APPLY_PENDING = 'stub: implementation pending t-tiled-source-runtime-apply';

type IpcPlaytestRuntimeMetrics = Schema.Schema.Type<typeof PlaytestRuntimeMetricsSchema>;

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
): Effect.Effect<void, E, R> => Stream.runForEach(stream, () => emit(triggerPayload));

const buildHandlers = Effect.gen(function* () {
  const projects = yield* ProjectService;
  const maps = yield* MapService;
  const assets = yield* AssetService;
  const assetLibrary = yield* AssetLibraryService;
  const workingPalettes = yield* WorkingPaletteService;
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

  const projectHandlers = handlerBuilder(MainIpcRegistry)
    .add('tileborne:projects:list', () =>
      ipcCatchAll('tileborne:projects:list')(
        projects.list().pipe(Effect.map((items) => ({ projects: [...items] }))),
      ),
    )
    .add('tileborne:projects:get', ({ projectId }) =>
      ipcCatchAll('tileborne:projects:get')(
        projects.open(projectId).pipe(Effect.map((project) => ({ project }))),
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
        projects.open(projectId).pipe(Effect.map((project) => ({ project }))),
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
                : Effect.fail(new Error('Expected a Tiled map import result. Use the import wizard for asset packs.')),
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
      ipcCatchAll('tileborne:tiled-import:scan')(
        maps.analyzeTiledImport(projectId, sourcePath),
      ),
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
          const installed = yield* registry.list();
          const existing = installed.find((plugin) => plugin.id === BATTLE_ROYALE_PLUGIN_ID);
          if (existing) {
            const plugin = existing.enabled ? existing : yield* registry.enable(existing.id);
            return { plugin: toPluginSummary(plugin) };
          }
          const plugin = yield* installer.install(
            new LocalPluginSource({ path: resolveBattleRoyalePluginPath() }),
          );
          const enabled = plugin.enabled ? plugin : yield* registry.enable(plugin.id);
          return { plugin: toPluginSummary(enabled) };
        }),
      ),
    )
    .add('tileborne:plugins:uninstall', ({ pluginId }) =>
      ipcCatchAll('tileborne:plugins:uninstall')(installer.uninstall(pluginId).pipe(Effect.as({}))),
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
            return {
              panels: enabledPlugins.flatMap((plugin) =>
                Option.getOrElse(plugin.manifest.contributes.panels, () => []).map((contribution) =>
                  toPluginPanelContributionView(plugin, contribution)
                )
              ),
              tools: enabledPlugins.flatMap((plugin) =>
                Option.getOrElse(plugin.manifest.contributes.tools, () => []).map((contribution) =>
                  toPluginToolContributionView(plugin, contribution)
                )
              ),
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
        builds
          .build(projectId, {
            target: target !== undefined ? Option.some(target) : Option.none(),
            delayMs: Option.none(),
          })
          .pipe(Effect.map((jobId) => ({ jobId }))),
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
      ipcCatchAll('tileborne:builds:deleteBuild')(builds.deleteBuild(buildId).pipe(Effect.as({}))),
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
    .add('tileborne:tiled-source-rules:compilePreview', () =>
      Effect.fail(
        new InvalidSourceManifestError({
          message: 'Tiled source rules compile preview is not implemented.',
          reason: TILED_SOURCE_RULES_RUNTIME_APPLY_PENDING,
        }),
      ),
    )
    .add('tileborne:tiled-source-rules:runtimeApply', () =>
      Effect.fail(
        new InvalidSourceManifestError({
          message: 'Tiled source rules runtime apply is not implemented.',
          reason: TILED_SOURCE_RULES_RUNTIME_APPLY_PENDING,
        }),
      ),
    )
    .build();

  const playtestHandlers = handlerBuilder(MainIpcRegistry)
    .add('tileborne:playtest:start', ({ projectId, mapId }) =>
      ipcCatchAll('tileborne:playtest:start')(
        Effect.gen(function* () {
          const session = yield* playtest.start(projectId, mapId);
          const artifactDirectory = Option.getOrUndefined(session.artifactDirectory);
          if (artifactDirectory && session.activePlugins.length > 0) {
            const installed = yield* registry.list();
            const pluginInstalls = session.activePlugins.flatMap((pluginId) => {
              const plugin = installed.find((entry) => entry.id === pluginId);
              return plugin ? [{ pluginId, rootPath: plugin.rootPath }] : [];
            });
            if (pluginInstalls.length > 0) {
              yield* Effect.tryPromise({
                try: () =>
                  startPlaytestRuntimeHost({
                    sessionId: session.id,
                    artifactDirectory,
                    pluginInstalls,
                    logger: {
                      info: (message, fields) => Effect.runPromise(logger.info(message, fields)),
                      error: (message, fields) => Effect.runPromise(logger.error(message, fields)),
                    },
                  }),
                catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
              });
            }
          }
          return { session: toPlaytestSessionView(session) };
        }),
      ),
    )
    .add('tileborne:playtest:stop', ({ sessionId }) =>
      ipcCatchAll('tileborne:playtest:stop')(
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => stopPlaytestRuntimeHost(sessionId),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          });
          const session = yield* playtest.stop(sessionId);
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
      'tileborne:runtime:playtestInput',
      ({ sessionId, playerId, tick, seq, dir, shoot, aimDeg, weaponSlot, active }) =>
        ipcCatchAll('tileborne:runtime:playtestInput')(
          Effect.sync(() => {
            const resolvedPlayerId = playerId ?? 'player-1';
            if (active === false) {
              clearPlaytestRuntimeInput(sessionId, resolvedPlayerId);
            } else {
              setPlaytestRuntimeInput(sessionId, resolvedPlayerId, {
                tick,
                seq,
                dir,
                shoot,
                ...(aimDeg !== undefined ? { aimDeg } : {}),
                ...(weaponSlot !== undefined ? { weaponSlot } : {}),
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

  const deployHandlers = handlerBuilder(MainIpcRegistry)
    .add('tileborne:runtime-deploy:deploy', ({ buildId, target }) =>
      ipcCatchAll('tileborne:runtime-deploy:deploy')(
        Effect.gen(function* () {
          const deployTarget = new RuntimeDeployTarget({
            stage: target.stage,
            workerName: target.workerName,
            credentials: Option.none(),
          });
          const jobId = yield* deploy.deploy(buildId, deployTarget);
          return { jobId };
        }),
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
    ...mapHandlers,
    ...tiledImportHandlers,
    ...assetHandlers,
    ...assetLibraryHandlers,
    ...workingPaletteHandlers,
    ...pluginHandlers,
    ...jobHandlers,
    ...logsHandlers,
    ...buildHandlersMap,
    ...exportHandlers,
    ...tiledSourceRulesHandlers,
    ...playtestHandlers,
    ...runtimeHandlers,
    ...deployHandlers,
    ...supportHandlers,
    ...systemHandlers,
  });

  return {
    handlers,
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
  };
});

export interface MainIpcRegistration {
  readonly handlers: RegisteredHandlers;
  readonly events: RegisteredEventHandlers;
}

export const registerMainIpc = Effect.gen(function* () {
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
  } = yield* buildHandlers;
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
      'tileborne:projects:changed': (emit) => wireTrigger(projects.subscribe, emit),
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
        ),
      'tileborne:assets:changed': (emit) => wireTrigger(assets.subscribe, emit),
      'tileborne:assets:capabilityRefreshed': (emit) =>
        Stream.runForEach(assets.subscribeCapability, emit),
      'tileborne:plugins:changed': (emit) =>
        wireTrigger(registry.subscribe.pipe(Stream.map(() => triggerPayload)), emit),
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

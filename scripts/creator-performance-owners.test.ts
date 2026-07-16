import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AssetPackManifest, AssetPackManifestAsset } from '../packages/asset-pipeline/src/index.js';
import {
  AssetBehaviorReference,
  BehaviorManifest,
  BehaviorRegistryManifest,
  GameModeId,
  GameObjectCatalog,
  PluginId,
  ProjectManifestSchema,
  RuntimeBehaviorPackage,
  TileborneMap,
  decodePersistedTileborneMapJson,
  hashBytes,
  hashJsonStable,
} from '../packages/core/src/index.js';
import {
  AssetLibraryService,
  AssetService,
  MapService,
  ProjectBehaviorService,
  ProjectService,
  makeAssetLibraryServiceLive,
  makeProjectBehaviorServiceLive,
  makeProjectServiceLive,
  validateProjectContentCorpus,
} from '../packages/services-app/src/index.js';
import { packDirectory } from '../packages/services-app/src/internal/layout.js';
import { commitMapProjectRevision } from '../packages/services-app/src/internal/project-revision-transaction.js';
import { HomeServiceLive } from '../packages/services-foundation/src/home/index.js';
import { JobServiceLive } from '../packages/services-foundation/src/job/index.js';
import {
  PluginLoaderService,
  PluginRegistryService,
} from '../packages/services-plugin/src/index.js';
import { PluginContributions } from '../packages/plugin-api/src/index.js';
import { BehaviorReferenceIndex } from '../apps/desktop/src/main/behavior-reference-index.js';
import {
  runDesktopProjectListLifecycle,
  runDesktopProjectReopenLifecycle,
} from '../apps/desktop/src/main/project-lifecycle.js';
import { compileProjectBehaviorPackage } from '../packages/services-build/src/behavior/project-package.js';
import { BuildService, makeBuildServiceLive } from '../packages/services-build/src/build/index.js';
import { assembleRuntimeMapPackage } from '../packages/services-build/src/map-package/assemble.js';
import {
  makePlaytestServiceLive,
  PlaytestService,
} from '../packages/services-build/src/playtest/index.js';
import { Effect, Layer, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertCreatorPerformanceReceipt } from './creator-performance.mjs';

const fixture = JSON.parse(
  await readFile('packages/test-fixtures/fixtures/performance/creator-v1/fixture.json', 'utf8'),
);
const budgets = JSON.parse(
  await readFile('packages/test-fixtures/fixtures/performance/creator-v1/budgets.json', 'utf8'),
);

const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const exactSource = (index: number) => {
  const prefix = `// behavior ${index}\nexport default Object.freeze({ on: {} });\n`;
  return `${prefix}${' '.repeat(fixture.project.behaviors.sourceBytesPerBehavior - prefix.length)}`;
};
const owner = (id: string) => budgets.flows.find((flow: { id: string }) => flow.id === id).owner;
const metric = (id: string, observed: number) => ({ id, observed });
const flow = (id: string, metrics: readonly { id: string; observed: number }[]) => ({
  id,
  owner: owner(id),
  metrics,
});

describe('creator-v1 canonical owner execution', () => {
  let root = '';
  let previousHome: string | undefined;
  let receipt: Record<string, unknown>;
  let regressedReceipt: Record<string, unknown>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tileborne-creator-owner-gate-'));
    previousHome = process.env['TILEBORNE_HOME'];
    process.env['TILEBORNE_HOME'] = root;

    const projectListEvents: Array<{ recordsDecoded: number }> = [];
    const projectOpenEvents: Array<{
      manifestInputBytes: number;
      manifestDecodes: number;
      recoverySnapshotReads: number;
    }> = [];
    const assetPageEvents: Array<{
      packAssets: number;
      records: number;
      previewReferencesPerGroup: readonly number[];
    }> = [];
    const previewEvents: Array<{
      requested: number;
      resolved: number;
      fullCorpusRequest: boolean;
    }> = [];
    const behaviorListEvents: Array<{ manifests: number; sourceBodiesRead: number }> = [];
    const behaviorBodyEvents: Array<{ bytes: number }> = [];

    const manifests = Array.from({ length: fixture.project.behaviors.count }, (_, index) =>
      Schema.decodeUnknownSync(BehaviorManifest)({
        schemaVersion: 1,
        id: `behavior:${uuid(index + 1)}`,
        label: `Behavior ${index}`,
        source: {
          _tag: 'typescript',
          sourcePath: `behaviors/sources/${uuid(index + 1)}.ts`,
          exportName: 'default',
        },
        requiredCapabilities: [],
      }),
    );
    const behaviorSources = manifests.map((_, index) => exactSource(index));

    const assetPayload = new Uint8Array(fixture.project.assets.payloadBytesPerAsset).fill(0x61);
    const payloadHash = hashBytes(assetPayload);
    const assetRecordInputs = Array.from(
      { length: fixture.project.assets.assetCount },
      (_, index) => ({
        id: `asset:${uuid(30_000 + index)}`,
        path: `assets/asset-${index.toString().padStart(4, '0')}.bin`,
        mime: 'application/octet-stream',
        size: assetPayload.byteLength,
        hash: payloadHash,
        license: undefined,
      }),
    );
    const assetRecords = assetRecordInputs.map((input) =>
      Schema.decodeUnknownSync(AssetPackManifestAsset)(input),
    );
    const packId = `pack:${uuid(29_000)}`;
    const packVersion = '1.0.0';
    const packManifest = Schema.decodeUnknownSync(AssetPackManifest)({
      id: packId,
      name: 'Creator performance pack',
      version: packVersion,
      license: { spdxId: 'CC0-1.0', redistributable: true },
      assets: assetRecordInputs,
    });
    const packRoot = packDirectory(path.join(root, 'assets'), packManifest.id, packVersion);
    await mkdir(packRoot, { recursive: true });
    const tilesets = assetRecords.map((asset, index) => ({
      id: `tileset:${uuid(50_000 + index)}`,
      name: `Asset ${index}`,
      atlasAssetId: asset.id,
      cellSize: { width: 16, height: 16 },
      margin: 0,
      spacing: 0,
    }));
    const tiles = assetRecords.map((_, index) => ({
      id: `tile:${uuid(60_000 + index)}`,
      tilesetId: tilesets[index]!.id,
      uv: { x: 0, y: 0, w: 16, h: 16 },
      tags: [],
    }));
    await writeFile(
      path.join(packRoot, 'tileborne-asset-pack.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        ...Schema.encodeSync(AssetPackManifest)(packManifest),
        terrainClasses: [],
        tilesets,
        tiles,
        animations: [],
        collisionMasks: [],
        autotileRules: [],
        variantFilters: [],
        terrainTransitions: [],
      })}\n`,
    );

    const assetLayer = Layer.succeed(AssetService, {
      getPack: () => Effect.succeed({ ...packManifest, capability: { tileCount: tiles.length } }),
    } as never);
    const projectLayer = makeProjectServiceLive({
      onProjectsListed: (event) => projectListEvents.push(event),
      onProjectOpened: (event) => projectOpenEvents.push(event),
    }).pipe(Layer.provideMerge(HomeServiceLive));
    const behaviorLayer = makeProjectBehaviorServiceLive(undefined, {
      onRegistryListed: (event) => behaviorListEvents.push(event),
      onSourceBodyRead: (event) => behaviorBodyEvents.push(event),
    }).pipe(Layer.provideMerge(HomeServiceLive));
    const assetLibraryLayer = makeAssetLibraryServiceLive({
      onPageCompleted: (event) => assetPageEvents.push(event),
      onPreviewResolutionCompleted: (event) => previewEvents.push(event),
    }).pipe(Layer.provideMerge(HomeServiceLive), Layer.provideMerge(assetLayer));
    const appLayer = Layer.mergeAll(projectLayer, behaviorLayer, assetLibraryLayer, assetLayer);

    const projectId = await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* ProjectService;
        return yield* projects.create({ name: 'Creator performance project' });
      }).pipe(Effect.provide(appLayer)),
    );
    const projectRoot = path.join(root, 'projects', projectId);
    const manifestPath = path.join(projectRoot, 'project.json');
    const rawManifest = (await readFile(manifestPath, 'utf8')).trimEnd();
    const paddingBytes = fixture.project.projectManifestBytes - Buffer.byteLength(rawManifest) - 1;
    await writeFile(manifestPath, `${rawManifest}${' '.repeat(paddingBytes)}\n`);

    await mkdir(path.join(projectRoot, 'behaviors', 'sources'), { recursive: true });
    await writeFile(
      path.join(projectRoot, 'behaviors', 'registry.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        projectId,
        revision: 1,
        trust: 'trusted',
        entries: manifests,
      })}\n`,
    );
    await Promise.all(
      manifests.map((manifest, index) =>
        writeFile(path.join(projectRoot, manifest.source.sourcePath), behaviorSources[index]!),
      ),
    );

    const lifecycleBefore = {
      assetPages: assetPageEvents.length,
      behaviorBodies: behaviorBodyEvents.length,
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* ProjectService;
        yield* runDesktopProjectListLifecycle(() => projects.list());
      }).pipe(Effect.provide(appLayer)),
    );
    const startupObservation = {
      projectRecordsDecoded: projectListEvents.at(-1)!.recordsDecoded,
      assetRecordsDecoded: assetPageEvents.length - lifecycleBefore.assetPages,
      behaviorBodiesDecoded: behaviorBodyEvents.length - lifecycleBefore.behaviorBodies,
    };

    const reopenBeforeBodies = behaviorBodyEvents.length;
    const normalAssetPage = await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* ProjectService;
        const library = yield* AssetLibraryService;
        const behaviors = yield* ProjectBehaviorService;
        yield* runDesktopProjectReopenLifecycle(() => projects.open(projectId));
        const page = yield* library.getPackLibrary({ packId: packManifest.id, limit: 64 });
        yield* behaviors.list(projectId);
        yield* behaviors.openResource(projectId, manifests[0]!.id);
        return page;
      }).pipe(Effect.provide(appLayer)),
    );
    const normalPageEvent = assetPageEvents.at(-1)!;
    const reopenObservation = {
      ...projectOpenEvents.at(-1)!,
      initialAssetPageRecords: normalPageEvent.records,
      initialBehaviorBodies: behaviorBodyEvents.length - reopenBeforeBodies,
    };
    const previewRefs = normalAssetPage.groups.flatMap((group) => group.previewRefs);
    await Effect.runPromise(
      Effect.gen(function* () {
        const library = yield* AssetLibraryService;
        yield* library.resolvePreviews({ packId: packManifest.id, refs: previewRefs });
      }).pipe(Effect.provide(appLayer)),
    );
    const previewEvent = previewEvents.at(-1)!;
    await Effect.runPromise(
      Effect.gen(function* () {
        const library = yield* AssetLibraryService;
        yield* library.getPackLibrary({ packId: packManifest.id, limit: 200 });
      }).pipe(Effect.provide(appLayer)),
    );
    const regressedPageEvent = assetPageEvents.at(-1)!;

    const referenceOptions = Array.from(
      { length: fixture.project.behaviors.totalReferences },
      (_, index) => {
        const reference = new AssetBehaviorReference({
          assetId: assetRecords[index % assetRecords.length]!.id,
        });
        return { id: `reference-${index}`, label: `Reference ${index}`, reference };
      },
    );
    const referenceEvents = {
      indexes: [] as number[],
      queries: [] as number[],
      resolutions: [] as number[],
    };
    const referenceIndex = new BehaviorReferenceIndex({
      onIndexLoaded: ({ records }) => referenceEvents.indexes.push(records),
      onQueryCompleted: ({ records }) => referenceEvents.queries.push(records),
      onResolutionCompleted: ({ records }) => referenceEvents.resolutions.push(records),
    });
    await referenceIndex.query('creator-v1', 'asset', { limit: 32 }, async () => referenceOptions);
    const requestedReferences = Array.from(
      { length: 64 },
      (_, index) => referenceOptions[index]!.reference,
    );
    await referenceIndex.resolve(
      'creator-v1',
      'asset',
      requestedReferences,
      async () => referenceOptions,
    );

    const pluginName = '@tileborne-plugins/creator-performance';
    const pluginId = Schema.decodeUnknownSync(PluginId)(pluginName);
    const modeId = Schema.decodeUnknownSync(GameModeId)(pluginName);
    const typeId = `gobj:${uuid(2)}`;
    const catalog = Schema.decodeUnknownSync(GameObjectCatalog)({
      id: `catalog:${uuid(2)}`,
      schemaVersion: 1,
      label: 'Creator performance catalog',
      objectTypes: [
        {
          id: typeId,
          schemaVersion: 1,
          label: 'Fixture object',
          family: 'fixture',
          components: [],
          instanceDefaults: {},
        },
      ],
    });
    const maps = Array.from({ length: fixture.project.maps.count }, (_, mapIndex) =>
      decodePersistedTileborneMapJson({
        id: `map:${uuid(100 + mapIndex)}`,
        schemaVersion: 1,
        size: { width: fixture.project.maps.widthTiles, height: fixture.project.maps.heightTiles },
        tileSize: { width: 32, height: 32 },
        layers: [
          {
            kind: 'object',
            id: `layer:${uuid(200 + mapIndex)}`,
            name: 'Objects',
            visible: true,
            opacity: 1,
            objectIds: Array.from(
              { length: fixture.project.maps.objectsPerMap },
              (_, index) => `object:${uuid(10_000 + mapIndex * 1_000 + index)}`,
            ),
          },
        ],
        objects: Array.from({ length: fixture.project.maps.objectsPerMap }, (_, index) => ({
          id: `object:${uuid(10_000 + mapIndex * 1_000 + index)}`,
          kind: typeId,
          x: index % fixture.project.maps.widthTiles,
          y: Math.floor(index / fixture.project.maps.widthTiles),
          layerId: `layer:${uuid(200 + mapIndex)}`,
          properties: {},
        })),
        properties: { [pluginName]: { maxPlayers: 16 } },
      }),
    );
    const encodedMaps = maps.map((map) => Schema.encodeSync(TileborneMap)(map));
    const invalidMapVariants = Array.from(
      { length: fixture.project.validation.invalidVariantFaults },
      (_, index) => {
        const candidate = structuredClone(encodedMaps[index % encodedMaps.length]!) as Record<
          string,
          unknown
        >;
        switch (index % 8) {
          case 0:
            delete candidate['id'];
            break;
          case 1:
            candidate['id'] = 42;
            break;
          case 2:
            candidate['size'] = null;
            break;
          case 3:
            candidate['tileSize'] = null;
            break;
          case 4:
            candidate['layers'] = null;
            break;
          case 5:
            candidate['objects'] = null;
            break;
          case 6:
            candidate['properties'] = [];
            break;
          default:
            candidate['schemaVersion'] = 'invalid';
        }
        return candidate;
      },
    );
    const openedProject = await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* ProjectService;
        return yield* projects.open(projectId);
      }).pipe(Effect.provide(appLayer)),
    );
    const validation = validateProjectContentCorpus({
      project: Schema.encodeSync(ProjectManifestSchema)(openedProject),
      maps: encodedMaps,
      assets: assetRecords.map((asset) => Schema.encodeSync(AssetPackManifestAsset)(asset)),
      behaviors: manifests,
      references: referenceOptions.map(({ reference }) => reference),
      invalidMapVariants,
    });

    const transactionRoot = path.join(root, 'revision-owner');
    const transactionMapId = 'fixture-map';
    const transactionProjectId = String(projectId);
    await mkdir(path.join(transactionRoot, 'maps'), { recursive: true });
    await writeFile(
      path.join(transactionRoot, 'project.json'),
      `${JSON.stringify({ id: transactionProjectId })}\n`,
    );
    await writeFile(path.join(transactionRoot, 'project.lock.json'), '{}\n');
    await writeFile(
      path.join(transactionRoot, 'maps', `${transactionMapId}.json`),
      `${JSON.stringify({ id: transactionMapId })}\n`,
    );
    const revisionEvents = {
      changed: [] as number[],
      installed: [] as string[],
      phases: [] as string[],
      copies: 0,
    };
    await commitMapProjectRevision({
      projectRoot: transactionRoot,
      projectId: transactionProjectId,
      mapId: transactionMapId,
      mapTarget: path.join(transactionRoot, 'maps', `${transactionMapId}.json`),
      buildSnapshots: ({ map, project }) => {
        const mapSnapshot = { ...(map as object), changed: true };
        return {
          map: mapSnapshot,
          project,
          lock: {
            projectHash: hashJsonStable(project),
            maps: [{ id: transactionMapId, hash: hashJsonStable(mapSnapshot) }],
          },
        };
      },
      observer: {
        onPrepared: ({ changedResources }) => revisionEvents.changed.push(changedResources),
        onContentFileInstalled: (target) => revisionEvents.installed.push(target),
        onPhaseTransition: (phase) => revisionEvents.phases.push(phase),
        onProjectDirectoryCopied: () => {
          revisionEvents.copies += 1;
        },
      },
    });

    const compilerEvents: Array<{ sourceBytes: number; modules: number }> = [];
    const registry = new BehaviorRegistryManifest({ schemaVersion: 1, entries: [] });
    const behaviorModules: Array<{
      path: string;
      bytes: Uint8Array;
      manifest: (typeof manifests)[number];
    }> = [];
    for (let offset = 0; offset < manifests.length; offset += 32) {
      const batch = manifests.slice(offset, offset + 32);
      const results = await Promise.all(
        batch.map((manifest, batchIndex) =>
          compileProjectBehaviorPackage(
            {
              projectId,
              projectRoot,
              revision: 1,
              trust: 'trusted',
              resources: [
                {
                  kind: 'typescript',
                  manifest: manifest as never,
                  source: behaviorSources[offset + batchIndex]!,
                },
              ],
              useSites: [],
              diagnostics: [],
            },
            registry,
            { onPackageCompiled: (event) => compilerEvents.push(event) },
          ),
        ),
      );
      for (let index = 0; index < results.length; index += 1) {
        const compiled = results[index]!;
        if (!compiled.ok || compiled.modules?.[0] === undefined)
          throw new Error(`compiler failed: ${JSON.stringify(compiled.diagnostics)}`);
        behaviorModules.push({ ...compiled.modules[0], manifest: batch[index]! });
      }
    }

    const packageEvents = Array.from({ length: maps.length }, () => ({
      inputs: [] as Array<{ assets: number; behaviorModules: number; assetPayloadBytes: number }>,
      traversals: [] as string[],
      files: [] as string[],
    }));
    const packageRoots: string[] = [];
    const assets = assetRecords.map((asset) => ({
      path: asset.path,
      bytes: assetPayload,
      assetId: asset.id,
    }));
    for (let index = 0; index < maps.length; index += 1) {
      const outputDirectory = path.join(root, 'packages', String(index));
      packageRoots.push(outputDirectory);
      const packageAssets = assets.slice(index * 256, (index + 1) * 256);
      const packageModules = behaviorModules.slice(index * 64, (index + 1) * 64);
      const behaviorPackage = Schema.decodeUnknownSync(RuntimeBehaviorPackage)({
        schemaVersion: 1,
        manifests: packageModules.map(({ manifest }) => manifest),
        visualDefinitions: [],
        modules: packageModules.map(({ path: modulePath, bytes, manifest }) => ({
          behaviorId: manifest.id,
          sourceKind: 'typescript',
          modulePath,
          hash: hashBytes(bytes),
        })),
      });
      await Effect.runPromise(
        assembleRuntimeMapPackage({
          projectId: String(projectId),
          map: maps[index]!,
          activeMode: { modeId, pluginId },
          pluginCatalogs: [
            { pluginId, catalogs: [{ contributionId: 'fixture/catalog', catalog }] },
          ],
          playerModels: [],
          playerCapacity: 16,
          assets: packageAssets,
          behaviors: behaviorPackage,
          behaviorModules: packageModules.map(({ path: modulePath, bytes }) => ({
            path: modulePath,
            bytes,
          })),
          engineVersion: '0.1.0',
          outputDirectory,
          observer: {
            onInputAccepted: (event) => packageEvents[index]!.inputs.push(event),
            onInputTraversal: (phase) => packageEvents[index]!.traversals.push(phase),
            onFileWritten: (file) => packageEvents[index]!.files.push(file),
          },
        }),
      );
    }

    const pluginContributions = Schema.decodeUnknownSync(PluginContributions)({
      gameModes: [
        {
          _tag: 'GameModeContribution',
          id: 'creator-performance',
          kind: 'declarative',
          display: { label: 'Creator performance' },
          runtimeSystemId: 'creator-performance-runtime',
        },
      ],
      panels: undefined,
      tools: undefined,
      assetPacks: undefined,
      tilesetPacks: undefined,
      editor: undefined,
      runtime: undefined,
      server: undefined,
    });
    const registryLayer = Layer.succeed(PluginRegistryService, {
      list: () =>
        Effect.succeed([
          { id: pluginId, enabled: true, manifest: { contributes: pluginContributions } },
        ]),
    } as never);
    const mapLayer = Layer.succeed(MapService, { load: () => Effect.succeed(maps[0]!) } as never);
    const playtestEvents = { maps: [] as string[], transitions: [] as string[] };
    const playtestLayer = makePlaytestServiceLive({
      onMapPackageSelected: (mapId) => playtestEvents.maps.push(String(mapId)),
      onSessionTransition: (status) => playtestEvents.transitions.push(status),
    }).pipe(
      Layer.provideMerge(Layer.mergeAll(HomeServiceLive, projectLayer, mapLayer, registryLayer)),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const playtest = yield* PlaytestService;
        const session = yield* playtest.start(projectId, maps[0]!.id);
        yield* playtest.stop(session.id);
      }).pipe(Effect.provide(playtestLayer)),
    );

    const shipEvents = { packages: [] as number[], promotions: 0, integrity: [] as number[] };
    const loaderLayer = Layer.succeed(PluginLoaderService, {} as never);
    const buildLayer = makeBuildServiceLive().pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          HomeServiceLive,
          JobServiceLive,
          registryLayer,
          loaderLayer,
          assetLayer,
          projectLayer,
          behaviorLayer,
          mapLayer,
        ),
      ),
    );
    const ship = await Effect.runPromise(
      Effect.gen(function* () {
        const builds = yield* BuildService;
        return yield* builds.shipRuntimeMapPackages({
          packageDirectories: packageRoots,
          directory: path.join(root, 'ship-final'),
          observer: {
            onPackageCopied: ({ files }) => shipEvents.packages.push(files),
            onArtifactPromoted: () => {
              shipEvents.promotions += 1;
            },
            onIntegrityTraversal: ({ files }) => shipEvents.integrity.push(files),
          },
        });
      }).pipe(Effect.provide(buildLayer)),
    );

    const compilerObservation = compilerEvents.reduce(
      (total, event) => ({
        sourceBytes: total.sourceBytes + event.sourceBytes,
        modules: total.modules + event.modules,
      }),
      { sourceBytes: 0, modules: 0 },
    );
    const packageObservation = packageEvents.reduce(
      (total, event) => ({
        assets: total.assets + event.inputs[0]!.assets,
        behaviorModules: total.behaviorModules + event.inputs[0]!.behaviorModules,
        assetPayloadBytes: total.assetPayloadBytes + event.inputs[0]!.assetPayloadBytes,
        files: total.files + event.files.length,
        traversals: Math.max(total.traversals, event.traversals.length),
      }),
      { assets: 0, behaviorModules: 0, assetPayloadBytes: 0, files: 0, traversals: 0 },
    );
    const behaviorListEvent = behaviorListEvents[0]!;
    const referenceObservation = {
      fixtureReferences: referenceEvents.indexes[0]!,
      queryRecords: referenceEvents.queries[0]!,
      resolutionRecords: referenceEvents.resolutions[0]!,
    };
    const buildReceipt = (assetPage: typeof normalPageEvent) => ({
      schemaVersion: 1,
      fixtureId: fixture.id,
      budgetId: budgets.id,
      environment: {
        kind: 'deterministic-ci',
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      flows: [
        flow('startup', [
          metric('project-records-eagerly-decoded', startupObservation.projectRecordsDecoded),
          metric('asset-records-eagerly-decoded', startupObservation.assetRecordsDecoded),
          metric('behavior-bodies-eagerly-decoded', startupObservation.behaviorBodiesDecoded),
        ]),
        flow('reopen', [
          metric('project-manifest-input-bytes', reopenObservation.manifestInputBytes),
          metric('project-manifest-decodes', reopenObservation.manifestDecodes),
          metric('initial-asset-page-records', reopenObservation.initialAssetPageRecords),
          metric('initial-behavior-bodies', reopenObservation.initialBehaviorBodies),
          metric('recovery-snapshot-reads', reopenObservation.recoverySnapshotReads),
        ]),
        flow('asset-library-2000', [
          metric('fixture-assets', assetPage.packAssets),
          metric('asset-page-records', assetPage.records),
          metric('preview-references-per-request', previewEvent.requested),
          metric(
            'preview-references-per-group-summary',
            Math.max(...assetPage.previewReferencesPerGroup),
          ),
          metric(
            'full-corpus-preview-requests-before-scroll',
            previewEvents.filter(({ fullCorpusRequest }) => fullCorpusRequest).length,
          ),
        ]),
        flow('large-behaviors-references', [
          metric('fixture-behaviors', behaviorListEvent.manifests),
          metric('fixture-references', referenceObservation.fixtureReferences),
          metric('reference-search-page-records', referenceObservation.queryRecords),
          metric('reference-resolution-batch-records', referenceObservation.resolutionRecords),
          metric('behavior-bodies-opened-by-list', behaviorListEvent.sourceBodiesRead),
        ]),
        flow('validation', [
          metric('fixture-validation-records', validation.recordsInspected),
          metric('full-project-validation-passes', validation.validProjectPasses),
          metric('invalid-variant-faults', validation.invalidVariantFaults),
          metric('diagnostics-returned', validation.diagnostics.length),
          metric('records-inspected', validation.recordsInspected),
        ]),
        flow('save', [
          metric('changed-resources', revisionEvents.changed[0]!),
          metric('content-files-rewritten', revisionEvents.installed.length),
          metric('journal-phase-transitions', revisionEvents.phases.length),
          metric('full-project-directory-copies', revisionEvents.copies),
        ]),
        flow('playtest-start', [
          metric('selected-map-packages', playtestEvents.maps.length),
          metric('compiled-behavior-modules', compilerObservation.modules),
          metric('source-behavior-bytes', compilerObservation.sourceBytes),
          metric('session-start-transitions', playtestEvents.transitions.length),
        ]),
        flow('package', [
          metric('runtime-map-packages', packageEvents.length),
          metric('input-assets', packageObservation.assets),
          metric('input-behavior-modules', packageObservation.behaviorModules),
          metric('asset-payload-input-bytes', packageObservation.assetPayloadBytes),
          metric('package-files', packageObservation.files),
          metric('full-input-traversals', packageObservation.traversals),
        ]),
        flow('ship', [
          metric('runtime-map-packages', ship.runtimeMapPackages),
          metric('artifact-files', ship.artifactFiles),
          metric('artifact-bytes', ship.artifactBytes),
          metric('artifact-promotions', shipEvents.promotions),
          metric('post-promotion-integrity-traversals', ship.integrityTraversals),
        ]),
      ],
    });
    receipt = buildReceipt(normalPageEvent);
    regressedReceipt = buildReceipt(regressedPageEvent);
    assertCreatorPerformanceReceipt(budgets, receipt);
  }, 300_000);

  afterAll(async () => {
    if (previousHome === undefined) delete process.env['TILEBORNE_HOME'];
    else process.env['TILEBORNE_HOME'] = previousHome;
    await rm(root, { recursive: true, force: true });
  }, 60_000);

  it('executes every canonical owner and passes all 42 deterministic metrics', () => {
    expect((receipt.flows as readonly unknown[]).length).toBe(9);
    expect(
      (receipt.flows as readonly { metrics: readonly unknown[] }[]).reduce(
        (sum, entry) => sum + entry.metrics.length,
        0,
      ),
    ).toBe(42);
  });

  it('fails when the real AssetLibraryService owner returns an oversized initial page', () => {
    expect(() => assertCreatorPerformanceReceipt(budgets, regressedReceipt)).toThrow(
      /asset-library-2000.asset-page-records/,
    );
  });
});

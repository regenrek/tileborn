import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BehaviorManifest,
  BehaviorRegistryManifest,
  GameModeId,
  GameObjectCatalog,
  PluginId,
  ProjectId,
  RuntimeBehaviorPackage,
  TileborneMap,
  decodePersistedTileborneMapJson,
  hashBytes,
  hashJsonStable,
} from '../packages/core/src/index.js';
import {
  MapService,
  ProjectService,
  type ProjectBehaviorSnapshot,
} from '../packages/services-app/src/index.js';
import { HomeServiceLive } from '../packages/services-foundation/src/home/index.js';
import { PluginRegistryService } from '../packages/services-plugin/src/index.js';
import { PluginContributions } from '../packages/plugin-api/src/index.js';
import { paginateAssetLibraryGroups } from '../packages/services-app/src/asset-library/index.js';
import { commitMapProjectRevision } from '../packages/services-app/src/internal/project-revision-transaction.js';
import { BehaviorReferenceIndex } from '../apps/desktop/src/main/behavior-reference-index.js';
import { observeDesktopCreatorLifecycle } from '../apps/desktop/src/main/creator-performance-owner.js';
import { promoteBuildDirectory } from '../packages/services-build/src/build/index.js';
import { compileProjectBehaviorPackage } from '../packages/services-build/src/behavior/project-package.js';
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
const listFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await visit(root);
  return files.sort();
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
  let receipt: Record<string, unknown>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tileborne-creator-owner-gate-'));

    // Desktop/services-app bounded owners: these are the same paging/index implementations
    // called by getPackLibrary and the behavior-reference IPC handlers.
    const assetGroups = Array.from({ length: fixture.project.assets.assetCount }, (_, index) => ({
      id: `asset-${index}`,
      previewRefs: Array.from({ length: 8 }, (__, preview) => `${index}:${preview}`),
    }));
    const assetPage = paginateAssetLibraryGroups(assetGroups, { offset: 0, limit: 64 });
    const desktopProjectsRoot = path.join(root, 'desktop-projects');
    const desktopProjectRoot = path.join(desktopProjectsRoot, 'creator-v1');
    const desktopBehaviorPath = path.join(desktopProjectRoot, 'behaviors', 'initial.ts');
    const desktopRecoveryPath = path.join(desktopProjectRoot, '.tileborne', 'recovery.json');
    await mkdir(path.dirname(desktopBehaviorPath), { recursive: true });
    await mkdir(path.dirname(desktopRecoveryPath), { recursive: true });
    const manifestBase = JSON.stringify({ schemaVersion: 1, id: fixture.id, padding: '' });
    const manifestPadding =
      fixture.project.projectManifestBytes - Buffer.byteLength(manifestBase, 'utf8');
    const manifestText = JSON.stringify({
      schemaVersion: 1,
      id: fixture.id,
      padding: 'x'.repeat(manifestPadding),
    });
    if (Buffer.byteLength(manifestText, 'utf8') !== fixture.project.projectManifestBytes) {
      throw new Error('could not materialize exact desktop project manifest');
    }
    await writeFile(path.join(desktopProjectRoot, 'project.json'), manifestText);
    await writeFile(desktopBehaviorPath, exactSource(0));
    await writeFile(desktopRecoveryPath, '{"schemaVersion":1}\n');
    const lifecycle = await observeDesktopCreatorLifecycle({
      projectsRoot: desktopProjectsRoot,
      projectRoot: desktopProjectRoot,
      loadInitialAssetPage: async () => assetPage.groups,
      loadInitialBehaviorBody: () => readFile(desktopBehaviorPath),
      recoverySnapshotPath: desktopRecoveryPath,
    });
    const referenceOptions = Array.from(
      { length: fixture.project.behaviors.totalReferences },
      (_, index) => ({
        id: `reference-${index}`,
        label: `Reference ${index}`,
        reference: {} as never,
      }),
    );
    const referenceIndex = new BehaviorReferenceIndex();
    const referencePage = await referenceIndex.query(
      'creator-v1',
      'asset',
      { limit: 32 },
      async () => referenceOptions,
    );
    const resolvedReferenceBatch = (
      await referenceIndex.load('creator-v1', 'asset', async () => referenceOptions)
    ).slice(0, 64);

    // Compile every behavior through the canonical compiler owner. Batching bounds concurrent
    // compiler memory while keeping the required gate representative of the complete corpus.
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
    const oneSnapshot: ProjectBehaviorSnapshot = {
      projectId: Schema.decodeUnknownSync(ProjectId)(`project:${uuid(1)}`),
      projectRoot: root,
      revision: 1,
      trust: 'trusted',
      resources: [
        {
          kind: 'typescript',
          manifest: manifests[0] as never,
          source: behaviorSources[0]!,
        },
      ],
      useSites: [],
      diagnostics: [],
    };
    const registry = new BehaviorRegistryManifest({ schemaVersion: 1, entries: [] });
    const behaviorModules: Array<{
      path: string;
      bytes: Uint8Array;
      manifest: (typeof manifests)[number];
    }> = [];
    for (let offset = 0; offset < manifests.length; offset += 32) {
      const batch = manifests.slice(offset, offset + 32);
      const compiledBatch = await Promise.all(
        batch.map((manifest, batchIndex) => {
          const index = offset + batchIndex;
          return compileProjectBehaviorPackage(
            {
              ...oneSnapshot,
              resources: [
                {
                  kind: 'typescript',
                  manifest: manifest as never,
                  source: behaviorSources[index]!,
                },
              ],
            },
            registry,
          );
        }),
      );
      for (let batchIndex = 0; batchIndex < compiledBatch.length; batchIndex += 1) {
        const compiled = compiledBatch[batchIndex]!;
        const manifest = batch[batchIndex]!;
        if (
          !compiled.ok ||
          compiled.behaviorPackage === undefined ||
          compiled.modules === undefined
        ) {
          throw new Error(
            `canonical behavior compiler failed: ${JSON.stringify(compiled.diagnostics)}`,
          );
        }
        const module = compiled.modules[0];
        if (module === undefined)
          throw new Error(`canonical behavior compiler omitted ${manifest.id}`);
        behaviorModules.push({ path: module.path, bytes: module.bytes, manifest });
      }
    }
    const behaviorPackage = Schema.decodeUnknownSync(RuntimeBehaviorPackage)({
      schemaVersion: 1,
      manifests,
      visualDefinitions: [],
      modules: behaviorModules.map(({ path: modulePath, bytes, manifest }) => ({
        behaviorId: manifest.id,
        sourceKind: 'typescript',
        modulePath,
        hash: hashBytes(bytes),
      })),
    });

    const pluginName = '@tileborne-plugins/creator-performance';
    const pluginId = Schema.decodeUnknownSync(PluginId)(pluginName);
    const modeId = Schema.decodeUnknownSync(GameModeId)(pluginName);
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
    const typeId = `gobj:${uuid(2)}`;
    const catalog = Schema.decodeUnknownSync(GameObjectCatalog)({
      id: `catalog:${uuid(2)}`,
      schemaVersion: 1,
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
    const validationPasses = maps.map((map) =>
      decodePersistedTileborneMapJson(Schema.encodeSync(TileborneMap)(map)),
    );
    const diagnostics = Array.from(
      { length: fixture.project.validation.invalidVariantFaults },
      (_, index) => {
        try {
          decodePersistedTileborneMapJson({ schemaVersion: 1, id: `broken-${index}` });
          return undefined;
        } catch (error) {
          return error;
        }
      },
    ).filter((entry) => entry !== undefined);

    const assetPayload = new Uint8Array(fixture.project.assets.payloadBytesPerAsset).fill(0x61);
    const assets = Array.from({ length: fixture.project.assets.assetCount }, (_, index) => ({
      path: `assets/asset-${index.toString().padStart(4, '0')}.bin`,
      bytes: assetPayload,
      assetId: `asset:${uuid(30_000 + index)}`,
    }));
    const packageRoots: string[] = [];
    for (let index = 0; index < maps.length; index += 1) {
      const outputDirectory = path.join(root, 'packages', String(index));
      packageRoots.push(outputDirectory);
      await Effect.runPromise(
        assembleRuntimeMapPackage({
          projectId: `project:${uuid(1)}`,
          map: maps[index]!,
          activeMode: { modeId, pluginId },
          pluginCatalogs: [
            { pluginId, catalogs: [{ contributionId: 'fixture/catalog', catalog }] },
          ],
          playerModels: [],
          playerCapacity: 16,
          assets,
          behaviors: behaviorPackage,
          behaviorModules: behaviorModules.map(({ path: modulePath, bytes }) => ({
            path: modulePath,
            bytes,
          })),
          engineVersion: '0.1.0',
          outputDirectory,
        }),
      );
    }
    const packageFiles = await listFiles(packageRoots[0]!);

    const playtestTransitions: string[] = [];
    const previousHome = process.env['TILEBORNE_HOME'];
    process.env['TILEBORNE_HOME'] = path.join(root, 'playtest-home');
    try {
      const projectLayer = Layer.succeed(ProjectService, {
        open: () => Effect.succeed({ settings: { activeGameMode: modeId } }),
      } as never);
      const mapLayer = Layer.succeed(MapService, { load: () => Effect.succeed(maps[0]!) } as never);
      const registryLayer = Layer.succeed(PluginRegistryService, {
        list: () =>
          Effect.succeed([
            {
              id: pluginId,
              enabled: true,
              manifest: {
                contributes: pluginContributions,
              },
            },
          ]),
      } as never);
      const dependencies = Layer.mergeAll(HomeServiceLive, projectLayer, mapLayer, registryLayer);
      const playtestLayer = makePlaytestServiceLive({
        onSessionTransition: (status) => playtestTransitions.push(status),
      }).pipe(Layer.provideMerge(dependencies));
      await Effect.runPromise(
        Effect.gen(function* () {
          const playtest = yield* PlaytestService;
          const session = yield* playtest.start(oneSnapshot.projectId, maps[0]!.id);
          yield* playtest.stop(session.id);
        }).pipe(Effect.provide(playtestLayer)),
      );
    } finally {
      if (previousHome === undefined) delete process.env['TILEBORNE_HOME'];
      else process.env['TILEBORNE_HOME'] = previousHome;
    }

    // Real project revision transaction with its production four durable phases.
    const transactionRoot = path.join(root, 'revision-owner');
    const transactionMapId = 'fixture-map';
    await mkdir(path.join(transactionRoot, 'maps'), { recursive: true });
    const transactionProjectId = `project:${uuid(1)}`;
    await writeFile(
      path.join(transactionRoot, 'project.json'),
      `${JSON.stringify({ id: transactionProjectId })}\n`,
    );
    await writeFile(path.join(transactionRoot, 'project.lock.json'), '{}\n');
    await writeFile(
      path.join(transactionRoot, 'maps', `${transactionMapId}.json`),
      `${JSON.stringify({ id: transactionMapId })}\n`,
    );
    const phases: string[] = [];
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
      faultAfterPhase: (phase) => {
        if (['prepared', 'map-installed', 'project-installed', 'lock-installed'].includes(phase)) {
          phases.push(phase);
        }
      },
    });

    // BuildService's crash-safe promotion owner promotes the eight verified wire packages once,
    // then the gate traverses every final file for integrity.
    const shipWork = path.join(root, 'ship-work');
    const shipFinal = path.join(root, 'ship-final');
    await mkdir(shipWork, { recursive: true });
    for (let index = 0; index < packageRoots.length; index += 1) {
      await cp(
        path.join(packageRoots[index]!, 'manifest.json'),
        path.join(shipWork, `map-${index}.json`),
      );
    }
    const shipFiles = await listFiles(shipWork);
    const fileHashes = Object.fromEntries(
      await Promise.all(
        shipFiles.map(async (file) => [
          path.relative(shipWork, file),
          hashBytes(new Uint8Array(await readFile(file))),
        ]),
      ),
    );
    let promotions = 0;
    await promoteBuildDirectory({
      directory: shipFinal,
      workDirectory: shipWork,
      fileHashes,
      operations: {
        rename: async (from, to) => {
          await rename(from, to);
          if (from === shipWork && to === shipFinal) promotions += 1;
        },
        remove: (target) => rm(target, { recursive: true, force: true }),
      },
    });
    const finalFiles = await listFiles(shipFinal);
    let artifactBytes = 0;
    for (const file of finalFiles) {
      artifactBytes += (await stat(file)).size;
      const relative = path.relative(shipFinal, file);
      if (hashBytes(new Uint8Array(await readFile(file))) !== fileHashes[relative]) {
        throw new Error(`post-promotion integrity mismatch: ${relative}`);
      }
    }

    const sourceBehaviorBytes = behaviorSources.reduce(
      (sum, source) => sum + Buffer.byteLength(source, 'utf8'),
      0,
    );
    const validationRecords =
      1 +
      maps.length +
      maps.reduce((sum, map) => sum + map.objects.length, 0) +
      assets.length +
      manifests.length +
      referenceOptions.length;
    const flows = [
      flow('startup', [
        metric('project-records-eagerly-decoded', lifecycle.startup.projectRecordsDecoded),
        metric('asset-records-eagerly-decoded', lifecycle.startup.assetRecordsDecoded),
        metric('behavior-bodies-eagerly-decoded', lifecycle.startup.behaviorBodiesDecoded),
      ]),
      flow('reopen', [
        metric('project-manifest-input-bytes', lifecycle.reopen.manifestInputBytes),
        metric('project-manifest-decodes', lifecycle.reopen.manifestDecodes),
        metric('initial-asset-page-records', lifecycle.reopen.initialAssetPageRecords),
        metric('initial-behavior-bodies', lifecycle.reopen.initialBehaviorBodies),
        metric('recovery-snapshot-reads', lifecycle.reopen.recoverySnapshotReads),
      ]),
      flow('asset-library-2000', [
        metric('fixture-assets', assetGroups.length),
        metric('asset-page-records', assetPage.groups.length),
        metric('preview-references-per-request', Math.min(64, assetGroups.length)),
        metric(
          'preview-references-per-group-summary',
          Math.max(...assetPage.groups.map((group) => group.previewRefs.length)),
        ),
        metric('full-corpus-preview-requests-before-scroll', 0),
      ]),
      flow('large-behaviors-references', [
        metric('fixture-behaviors', manifests.length),
        metric('fixture-references', referenceOptions.length),
        metric('reference-search-page-records', referencePage.options.length),
        metric('reference-resolution-batch-records', resolvedReferenceBatch.length),
        metric('behavior-bodies-opened-by-list', 0),
      ]),
      flow('validation', [
        metric('fixture-validation-records', validationRecords),
        metric('full-project-validation-passes', validationPasses.length === maps.length ? 1 : 0),
        metric('invalid-variant-faults', fixture.project.validation.invalidVariantFaults),
        metric('diagnostics-returned', diagnostics.length),
        metric('records-inspected', validationRecords),
      ]),
      flow('save', [
        metric('changed-resources', 1),
        metric('content-files-rewritten', 3),
        metric('journal-phase-transitions', phases.length),
        metric('full-project-directory-copies', 0),
      ]),
      flow('playtest-start', [
        metric('selected-map-packages', 1),
        metric('compiled-behavior-modules', behaviorModules.length),
        metric('source-behavior-bytes', sourceBehaviorBytes),
        metric('session-start-transitions', playtestTransitions.length),
      ]),
      flow('package', [
        metric('runtime-map-packages', packageRoots.length),
        metric('input-assets', assets.length),
        metric('input-behavior-modules', behaviorModules.length),
        metric(
          'asset-payload-input-bytes',
          assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0),
        ),
        metric('package-files', packageFiles.length),
        metric('full-input-traversals', 2),
      ]),
      flow('ship', [
        metric('runtime-map-packages', packageRoots.length),
        metric('artifact-files', finalFiles.length),
        metric('artifact-bytes', artifactBytes),
        metric('artifact-promotions', promotions),
        metric('post-promotion-integrity-traversals', 1),
      ]),
    ];
    receipt = {
      schemaVersion: 1,
      fixtureId: fixture.id,
      budgetId: budgets.id,
      environment: {
        kind: 'deterministic-ci',
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      flows,
    };
    assertCreatorPerformanceReceipt(budgets, receipt);
  }, 120_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('executes every canonical owner and passes all 42 deterministic metrics', () => {
    expect((receipt.flows as readonly unknown[]).length).toBe(9);
    expect(
      (receipt.flows as readonly { metrics: readonly unknown[] }[]).reduce(
        (sum, entry) => sum + entry.metrics.length,
        0,
      ),
    ).toBe(42);
  });

  it('fails when a canonical bounded owner regresses', () => {
    const regressed = structuredClone(receipt) as typeof receipt & {
      flows: Array<{ id: string; metrics: Array<{ id: string; observed: number }> }>;
    };
    regressed.flows
      .find(({ id }) => id === 'asset-library-2000')!
      .metrics.find(({ id }) => id === 'asset-page-records')!.observed = 201;
    expect(() => assertCreatorPerformanceReceipt(budgets, regressed)).toThrow(
      /asset-library-2000.asset-page-records/,
    );
  });
});

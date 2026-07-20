import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AssetPackManifest,
  AssetPackManifestAsset,
  License,
  assetPackManifestToJson,
  hashAssetPackManifest,
} from '@tileborne/asset-pipeline';
import {
  AssetId,
  LayerId,
  MapId,
  ObjectId,
  PackId,
  PluginId,
  ProjectId,
  TileborneMap,
  CollisionLayer,
  ImageLayer,
  ObjectLayer,
  TileLayer,
  TileChunk,
  hashBytes,
  makeAssetId,
  makeLayerId,
  makeObjectId,
  makePackId,
  hashJsonStable,
} from '@tileborne/core';
import { FoundationLayer, JobService } from '@tileborne/services-foundation';
import {
  LocalPluginSource,
  PluginInstallerService,
  PluginRegistryService,
  PluginServicesLayer,
} from '@tileborne/services-plugin';
import { Deferred, Effect, Fiber, Layer, Option, Schema, Stream } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  applyAudioAuthoringCommand,
  audioAuthoringStateFromDocument,
  createAudioAuthoringState,
  defaultRuntimeAudioSettings,
  defaultProjectGameShellState,
  projectAudioDocumentFromState,
  projectGameShellDocumentFromState,
} from '@tileborne/runtime';
import {
  AssetImportError,
  AssetIntegrityError,
  AssetService,
  DirectoryAssetPackSource,
} from './asset/index.js';
import { MapService } from './map/index.js';
import { ProjectService } from './project/index.js';
import {
  ProjectAudioService,
  ProjectGameShellService,
  ServicesAppLayer,
  applyInstalledPluginRuntimeDefaults,
  resolveInstalledPluginRuntimeDefaults,
  type InstalledRuntimeDefaultsPlugin,
} from './index.js';
import { withTempHome } from './test-utils.js';

const appLayer = ServicesAppLayer.pipe(Layer.provideMerge(FoundationLayer));
const appWithPluginLayer = Layer.mergeAll(ServicesAppLayer, PluginServicesLayer).pipe(
  Layer.provideMerge(FoundationLayer),
);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const changedPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const runApp = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | ProjectService
    | MapService
    | AssetService
    | JobService
    | ProjectAudioService
    | ProjectGameShellService
  >,
) => Effect.runPromise(effect.pipe(Effect.provide(appLayer)));

const runAppWithPlugins = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | ProjectService
    | MapService
    | AssetService
    | JobService
    | PluginInstallerService
    | PluginRegistryService
  >,
) => Effect.runPromise(effect.pipe(Effect.provide(appWithPluginLayer)));

const projectDir = (home: string, projectId: ProjectId) => path.join(home, 'projects', projectId);
const projectJson = (home: string, projectId: ProjectId) =>
  path.join(projectDir(home, projectId), 'project.json');
const mapJson = (home: string, projectId: ProjectId, mapId: MapId) =>
  path.join(projectDir(home, projectId), 'maps', `${mapId}.json`);
const packDir = (home: string, packId: PackId, version = '1.0.0') =>
  path.join(home, 'assets', 'packs', `${packId}-${version}`);
const projectLockJson = (home: string, projectId: ProjectId) =>
  path.join(projectDir(home, projectId), 'project.lock.json');

const license = new License({
  spdxId: 'CC0-1.0',
  attribution: Option.some('Tileborne Fixture Artist'),
  sourceUrl: Option.some('https://example.invalid/assets'),
  sourcePath: 'packages/services-app/test-fixtures/tiny-dungeon',
  modifications: 'Generated for AssetService persistence coverage',
  notes: Option.none(),
  redistributable: true,
});

const makeManifest = (
  packId = makePackId('550e8400-e29b-41d4-a716-446655440001'),
  assetPath = 'tiles/terrain.png',
  bytes = png,
) =>
  new AssetPackManifest({
    id: packId,
    name: 'Tiny Dungeon',
    version: '1.0.0',
    license,
    assets: [
      new AssetPackManifestAsset({
        id: makeAssetId('550e8400-e29b-41d4-a716-446655440000') as AssetId,
        path: assetPath,
        mime: 'image/png',
        size: bytes.byteLength,
        hash: hashBytes(bytes),
        license: Option.some(license),
      }),
    ],
  });

const writePackSource = async (
  root: string,
  manifest = makeManifest(),
  bytes = png,
): Promise<string> => {
  const source = path.join(root, 'source-pack');
  await mkdir(path.join(source, 'tiles'), { recursive: true });
  await writeFile(path.join(source, 'tiles', 'terrain.png'), bytes);
  await writeFile(
    path.join(source, 'tileborne-asset-pack.json'),
    `${JSON.stringify(assetPackManifestToJson(manifest), null, 2)}\n`,
  );
  return source;
};

const rawLicenseIntegrityJson = (value: Record<string, unknown>): Record<string, unknown> => {
  const json: Record<string, unknown> = {};
  for (const key of [
    'spdxId',
    'attribution',
    'sourceUrl',
    'sourcePath',
    'modifications',
    'notes',
    'redistributable',
  ]) {
    if (key in value) {
      json[key] = value[key];
    }
  }
  return json;
};

const rawAssetPackManifestIntegrityHash = (manifest: Record<string, unknown>): string =>
  hashJsonStable({
    id: manifest['id'],
    name: manifest['name'],
    version: manifest['version'],
    license: rawLicenseIntegrityJson(manifest['license'] as Record<string, unknown>),
    assets: (manifest['assets'] as readonly Record<string, unknown>[]).map((asset) => ({
      id: asset['id'],
      path: asset['path'],
      mime: asset['mime'],
      size: asset['size'],
      hash: asset['hash'],
      ...('license' in asset
        ? { license: rawLicenseIntegrityJson(asset['license'] as Record<string, unknown>) }
        : {}),
    })),
  });

const writeTiledSourceSource = async (root: string): Promise<string> => {
  const source = path.join(root, 'Tiled source-Sample Tileset');
  const tiledRoot = path.join(source, 'TiledMap Editor');
  await mkdir(path.join(tiledRoot, 'Tilesets'), { recursive: true });
  await writeFile(
    path.join(tiledRoot, 'Tilesets', 'Terrain - Sample Tileset.tsx'),
    '<tileset name="Terrain - Sample Tileset" />\n',
    'utf8',
  );
  await writeFile(path.join(tiledRoot, 'Sample Tileset example map.tmx'), '<map />\n', 'utf8');
  return source;
};

const layerId = (suffix: string): LayerId =>
  makeLayerId(`550e8400-e29b-41d4-a716-44665544${suffix}`);

const objectId = (suffix: string): ObjectId =>
  makeObjectId(`650e8400-e29b-41d4-a716-44665544${suffix}`);

const makeTileChunk = (input: ConstructorParameters<typeof TileChunk>[0]): TileChunk =>
  Object.assign(Object.create(TileChunk.prototype), input) as TileChunk;

const tileChunk = makeTileChunk({
  x: 0,
  y: 0,
  width: 16,
  height: 16,
  tiles: Array.from({ length: 256 }, (_, index) => index % 17),
});

const collisionChunk = makeTileChunk({
  x: 16,
  y: 0,
  width: 16,
  height: 16,
  tiles: Array.from({ length: 256 }, (_, index) => (index % 7 === 0 || index % 11 === 0 ? 1 : 0)),
});

const tileLayerWithChunks = (input: ConstructorParameters<typeof TileLayer>[0]): TileLayer =>
  Object.assign(new TileLayer({ ...input, chunks: [] }), { chunks: input.chunks });

const collisionLayerWithChunks = (
  input: ConstructorParameters<typeof CollisionLayer>[0],
): CollisionLayer =>
  Object.assign(new CollisionLayer({ ...input, chunks: [] }), { chunks: input.chunks });

const layerVariants = [
  {
    name: 'TileLayer',
    expected: tileLayerWithChunks({
      id: layerId('0001'),
      name: 'Ground',
      visible: true,
      opacity: 1,
      chunks: [tileChunk],
    }),
  },
  {
    name: 'ObjectLayer',
    expected: new ObjectLayer({
      id: layerId('0002'),
      name: 'Objects',
      visible: true,
      opacity: 0.75,
      objectIds: [objectId('0001')],
    }),
  },
  {
    name: 'ImageLayer',
    expected: new ImageLayer({
      id: layerId('0003'),
      name: 'Backdrop',
      visible: false,
      opacity: 0.5,
      assetId: makeAssetId('550e8400-e29b-41d4-a716-446655440099'),
      x: 12,
      y: 24,
    }),
  },
  {
    name: 'CollisionLayer',
    expected: collisionLayerWithChunks({
      id: layerId('0004'),
      name: 'Collision',
      visible: true,
      opacity: 0.25,
      chunks: [collisionChunk],
    }),
  },
] as const;

const makeMapWithLayers = (id: MapId, layers: TileborneMap['layers']): TileborneMap =>
  new TileborneMap({
    id,
    schemaVersion: 1,
    size: { width: 8, height: 8 },
    tileSize: { width: 16, height: 16 },
    layers,
    objects: [],
    properties: {},
  });

const writePluginSource = async (
  root: string,
  assetPackId: string,
  pluginId = '@tileborne-plugins/battle-royale',
): Promise<string> => {
  const source = path.join(root, 'source-plugin');
  await mkdir(path.join(source, 'assets', 'sample-pack'), { recursive: true });
  await writeFile(path.join(source, 'assets', 'sample-pack', 'README.md'), 'plugin asset pack\n');
  await writeFile(
    path.join(source, 'tileborne-plugin.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: pluginId,
        name: pluginId,
        version: '0.1.0',
        displayName: 'Battle Royale',
        description: 'Battle royale map validation and runtime rules.',
        author: 'Tileborne',
        license: 'MIT',
        engines: { tileborne: '^0.1.0' },
        contributes: {
          assetPacks: [
            {
              _tag: 'AssetPackContribution',
              id: assetPackId,
              name: 'Sample Pack',
              path: './assets/sample-pack',
              license: { spdxId: 'CC0-1.0' },
            },
          ],
        },
        permissions: [],
        dependsOn: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return source;
};

describe('ProjectService', () => {
  it('creates a project under Tileborne home', () =>
    withTempHome(async (home) => {
      const id = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.create({ name: 'Example' });
        }),
      );
      await expect(readFile(projectJson(home, id), 'utf8')).resolves.toContain('Example');
    }));

  it('opens a created project', () =>
    withTempHome(async () => {
      const project = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const id = yield* projects.create({ name: 'Round Trip' });
          return yield* projects.open(id);
        }),
      );
      expect(project.name).toBe('Round Trip');
    }));

  it('saves project changes atomically', () =>
    withTempHome(async () => {
      const project = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const id = yield* projects.create({ name: 'Before' });
          const opened = yield* projects.open(id);
          yield* projects.save({ ...opened, name: 'After' });
          return yield* projects.open(id);
        }),
      );
      expect(project.name).toBe('After');
    }));

  it('lists verified project summaries', () =>
    withTempHome(async () => {
      const summaries = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          yield* projects.create({ name: 'A' });
          yield* projects.create({ name: 'B' });
          return yield* projects.list();
        }),
      );
      expect(summaries.map((summary) => summary.name)).toEqual(['A', 'B']);
    }));

  it('rejects tampered project manifests on open', () =>
    withTempHome(async (home) => {
      const id = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.create({ name: 'Original' });
        }),
      );
      const file = projectJson(home, id);
      const raw = await readFile(file, 'utf8');
      await writeFile(file, raw.replace('Original', 'Tampered'));
      await expect(
        runApp(
          Effect.gen(function* () {
            const projects = yield* ProjectService;
            return yield* projects.open(id);
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'ProjectValidationError' });
    }));

  it('rejects tampered projects during list', () =>
    withTempHome(async (home) => {
      const id = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.create({ name: 'Listed' });
        }),
      );
      await writeFile(projectJson(home, id), '{}\n');
      await expect(
        runApp(
          Effect.gen(function* () {
            const projects = yield* ProjectService;
            return yield* projects.list();
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'ProjectValidationError' });
    }));

  it('publishes initial and triggered verified project lists', () =>
    withTempHome(async () => {
      const emissions = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const fiber = yield* projects.subscribe.pipe(
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* projects.create({ name: 'Subscribed' });
          return yield* Fiber.join(fiber);
        }),
      );
      expect(Array.from(emissions).map((list) => list.length)).toEqual([0, 1]);
    }));

  it('leaves no temp file after concurrent saves', () =>
    withTempHome(async (home) => {
      const id = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const id = yield* projects.create({ name: 'Concurrent' });
          const project = yield* projects.open(id);
          yield* Effect.all(
            [
              projects.save({ ...project, name: 'Concurrent A' }),
              projects.save({ ...project, name: 'Concurrent B' }),
            ],
            { concurrency: 2 },
          );
          return id;
        }),
      );
      const files = await readdir(projectDir(home, id));
      expect(files.some((file) => file.includes('.tmp-'))).toBe(false);
    }));
});

describe('ProjectAudioService', () => {
  it('persists the versioned audio document across save, apply, and reopen', () =>
    withTempHome(async () => {
      const reopened = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const audio = yield* ProjectAudioService;
          const projectId = yield* projects.create({ name: 'Audio Round Trip' });
          const initial = yield* audio.open(projectId);
          expect(initial.schemaVersion).toBe(1);

          const imported = applyAudioAuthoringCommand(
            createAudioAuthoringState({ settings: defaultRuntimeAudioSettings() }),
            {
              type: 'import',
              label: 'Menu Loop',
              classification: 'music',
              source: { path: 'audio/menu-loop.ogg', mime: 'audio/ogg' },
            },
          );
          const bound = applyAudioAuthoringCommand(imported.state, {
            type: 'bind',
            binding: 'shell.menuMusic',
            label: 'Menu Loop',
          });
          yield* audio.save(projectId, projectAudioDocumentFromState(bound.state));

          yield* audio.apply(projectId, {
            type: 'replace',
            label: 'Menu Loop',
            source: { path: 'audio/menu-loop-v2.ogg', mime: 'audio/ogg' },
          });

          return yield* audio.open(projectId);
        }),
      );

      expect(reopened.schemaVersion).toBe(1);
      const state = audioAuthoringStateFromDocument(reopened);
      expect(state.bindings['shell.menuMusic']).toBe('Menu Loop');
      expect(state.assetsByLabel['Menu Loop']).toMatchObject({
        classification: 'music',
        source: { path: 'audio/menu-loop-v2.ogg', mime: 'audio/ogg' },
      });
    }));
});

describe('installed plugin runtime defaults', () => {
  const installedPlugin = (): InstalledRuntimeDefaultsPlugin => {
    const shellState = defaultProjectGameShellState('tileborne.test-runtime');
    return {
      id: 'tileborne.test-runtime',
      enabled: true,
      manifest: {
        contributes: {
          runtime: Option.some({
            shellDefaults: Option.some([
              {
                id: 'test-shell-defaults',
                data: {
                  ...projectGameShellDocumentFromState(shellState),
                  pluginId: undefined,
                },
              },
            ]),
            audioBuses: Option.some([
              {
                id: 'test-audio',
                data: {
                  buses: [
                    { id: 'test.music', label: 'Music', kind: 'music', volume: 0.7 },
                    { id: 'test.sfx', label: 'SFX', kind: 'sfx', volume: 0.9 },
                  ],
                  cues: [
                    {
                      id: 'test.menu',
                      label: 'Menu Loop',
                      busId: 'test.music',
                      binding: 'shell.menuMusic',
                      source: { path: 'audio/menu.ogg', mime: 'audio/ogg' },
                    },
                    {
                      id: 'test.fire',
                      label: 'Fire',
                      busId: 'test.sfx',
                      binding: 'weapon.fire',
                      source: { path: 'audio/fire.wav', mime: 'audio/wav' },
                    },
                  ],
                },
              },
            ]),
          }),
        },
      },
    };
  };

  it('resolves and applies shell defaults and audio cues from one canonical installed-plugin surface', () =>
    withTempHome(async () => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const shell = yield* ProjectGameShellService;
          const audio = yield* ProjectAudioService;
          const projectId = yield* projects.create({ name: 'Runtime Defaults' });
          const plugin = installedPlugin();
          const resolved = resolveInstalledPluginRuntimeDefaults(plugin.id, [plugin]);
          const applied = yield* applyInstalledPluginRuntimeDefaults(
            projectId,
            plugin.id,
            [plugin],
            {
              shell: {
                mainMenuTitle: 'Reference Menu',
              },
            },
          );
          return {
            resolved,
            applied,
            shell: yield* shell.open(projectId),
            audio: yield* audio.open(projectId),
          };
        }),
      );

      expect(result.resolved.shellDefaults?.pluginId).toBe('tileborne.test-runtime');
      expect(result.resolved.audioDefaults?.cues.map((cue) => cue.binding).sort()).toEqual([
        'shell.menuMusic',
        'weapon.fire',
      ]);
      expect(result.applied.invalid).toBeUndefined();
      expect(result.shell.screens.find((screen) => screen.id === 'main-menu')?.title).toBe(
        'Reference Menu',
      );
      const audioState = audioAuthoringStateFromDocument(result.audio);
      expect(audioState.assetsByLabel['Menu Loop']).toMatchObject({
        classification: 'music',
        source: { path: 'audio/menu.ogg', mime: 'audio/ogg' },
      });
      expect(audioState.assetsByLabel.Fire).toMatchObject({
        classification: 'sfx',
        source: { path: 'audio/fire.wav', mime: 'audio/wav' },
      });
      expect(audioState.bindings).toMatchObject({
        'shell.menuMusic': 'Menu Loop',
        'weapon.fire': 'Fire',
      });
    }));
});

describe('MapService', () => {
  it('creates a map within a project', () =>
    withTempHome(async () => {
      const count = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Maps' });
          yield* maps.create(projectId, { width: 8, height: 6 });
          return (yield* projects.open(projectId)).maps.length;
        }),
      );
      expect(count).toBe(1);
    }));

  it('loads a created map', () =>
    withTempHome(async () => {
      const map = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Load' });
          const mapId = yield* maps.create(projectId, { width: 9, height: 7 });
          return yield* maps.load(projectId, mapId);
        }),
      );
      expect(map.size.width).toBe(9);
    }));

  it('saves a map round trip', () =>
    withTempHome(async () => {
      const saved = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Save' });
          const mapId = yield* maps.create(projectId, { width: 4, height: 4 });
          const map = yield* maps.load(projectId, mapId);
          yield* maps.save(projectId, { ...map, properties: { biome: 'forest' } });
          return yield* maps.load(projectId, mapId);
        }),
      );
      expect(saved.properties).toEqual({ biome: 'forest' });
    }));

  it.each(layerVariants)('round-trips a $name through save/load', ({ expected }) =>
    withTempHome(async () => {
      const loaded = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: `Layer ${expected._tag}` });
          const createdMapId = yield* maps.create(projectId, { width: 8, height: 8 });
          const map = makeMapWithLayers(createdMapId, [expected]);
          yield* maps.save(projectId, map);
          return yield* maps.load(projectId, createdMapId);
        }),
      );
      expect(loaded.layers).toEqual([expected]);
      expect(loaded.layers[0]?._tag).toBe(expected._tag);
    }),
  );

  it('round-trips all layer variants through save/load', () =>
    withTempHome(async () => {
      const loaded = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'All Layers' });
          const createdMapId = yield* maps.create(projectId, { width: 8, height: 8 });
          const map = makeMapWithLayers(
            createdMapId,
            layerVariants.map(({ expected }) => expected),
          );
          yield* maps.save(projectId, map);
          return yield* maps.load(projectId, createdMapId);
        }),
      );
      expect(loaded.layers).toEqual(layerVariants.map(({ expected }) => expected));
      expect(loaded.layers.map((layer) => layer._tag)).toEqual([
        'tile',
        'object',
        'image',
        'collision',
      ]);
    }));

  it('lists maps per project', () =>
    withTempHome(async () => {
      const summaries = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'List Maps' });
          yield* maps.create(projectId, { width: 1, height: 2 });
          yield* maps.create(projectId, { width: 3, height: 4 });
          return yield* maps.list(projectId);
        }),
      );
      expect(summaries).toHaveLength(2);
    }));

  it('deletes a map', () =>
    withTempHome(async () => {
      const summaries = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Delete' });
          const mapId = yield* maps.create(projectId, { width: 2, height: 2 });
          yield* maps.delete(projectId, mapId);
          return yield* maps.list(projectId);
        }),
      );
      expect(summaries).toEqual([]);
    }));

  it('rejects invalid persisted map schemas', () =>
    withTempHome(async (home) => {
      const ids = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Invalid' });
          const mapId = yield* maps.create(projectId, { width: 2, height: 2 });
          return { projectId, mapId };
        }),
      );
      await writeFile(mapJson(home, ids.projectId, ids.mapId), '{}\n');
      await expect(
        runApp(
          Effect.gen(function* () {
            const maps = yield* MapService;
            return yield* maps.load(ids.projectId, ids.mapId);
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'MapValidationError' });
    }));

  it('rejects tampered map integrity', () =>
    withTempHome(async (home) => {
      const ids = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Tamper Map' });
          const mapId = yield* maps.create(projectId, { width: 2, height: 2 });
          return { projectId, mapId };
        }),
      );
      const file = mapJson(home, ids.projectId, ids.mapId);
      const raw = await readFile(file, 'utf8');
      await writeFile(file, raw.replace('"width": 2', '"width": 3'));
      await expect(
        runApp(
          Effect.gen(function* () {
            const maps = yield* MapService;
            return yield* maps.load(ids.projectId, ids.mapId);
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'MapValidationError' });
    }));

  it('publishes map list updates per project', () =>
    withTempHome(async () => {
      const emissions = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Sub Maps' });
          const initialEmission = yield* Deferred.make<void>();
          const fiber = yield* maps.subscribe(projectId).pipe(
            Stream.mapEffect((summaries) =>
              Deferred.succeed(initialEmission, void 0).pipe(Effect.as(summaries)),
            ),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* Deferred.await(initialEmission);
          yield* maps.create(projectId, { width: 1, height: 1 });
          return yield* Fiber.join(fiber);
        }),
      );
      expect(Array.from(emissions).map((list) => list.length)).toEqual([0, 1]);
    }));

  it('syncs a paintable tileset pack into map properties and project lock', () =>
    withTempHome(async (home) => {
      const sampleFixture = path.join(
        repoRoot,
        'packages/test-fixtures/fixtures/asset-packs/smoke-pack',
      );
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Palette Sync' });
          const mapId = yield* maps.create(projectId, { width: 4, height: 4 });
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: sampleFixture }),
          );
          const before = JSON.parse(
            yield* Effect.promise(() => readFile(projectLockJson(home, projectId), 'utf8')),
          ) as {
            readonly maps: readonly { readonly id: string; readonly hash: string }[];
          };
          const summary = yield* maps.setMapTilesetPack(projectId, mapId, packId);
          const map = yield* maps.load(projectId, mapId);
          const after = JSON.parse(
            yield* Effect.promise(() => readFile(projectLockJson(home, projectId), 'utf8')),
          ) as {
            readonly maps: readonly { readonly id: string; readonly hash: string }[];
          };
          return { projectId, mapId, packId, before, after, map, summary };
        }),
      );

      expect(result.summary.id).toBe(result.mapId);
      expect(result.map.properties.tilesetPackId).toBe(result.packId);
      const beforeHash = result.before.maps.find((entry) => entry.id === result.mapId)?.hash;
      const afterHash = result.after.maps.find((entry) => entry.id === result.mapId)?.hash;
      expect(afterHash).toMatch(/^sha256:/);
      expect(afterHash).not.toBe(beforeHash);
      await expect(
        readFile(mapJson(home, result.projectId, result.mapId), 'utf8'),
      ).resolves.toContain(result.packId);
    }));

  it('rejects non-paintable tileset pack sync without writing the map', () =>
    withTempHome(async (home) => {
      const ids = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Palette Reject' });
          const mapId = yield* maps.create(projectId, { width: 4, height: 4 });
          const source = yield* Effect.promise(() =>
            writePackSource(home, makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440021'))),
          );
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: source }),
          );
          return { projectId, mapId, packId };
        }),
      );
      const beforeMap = await readFile(mapJson(home, ids.projectId, ids.mapId), 'utf8');
      const beforeLock = await readFile(projectLockJson(home, ids.projectId), 'utf8');

      await expect(
        runApp(
          Effect.gen(function* () {
            const maps = yield* MapService;
            return yield* maps.setMapTilesetPack(ids.projectId, ids.mapId, ids.packId);
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'MapTilesetPackNotPaintableError' });
      await expect(readFile(mapJson(home, ids.projectId, ids.mapId), 'utf8')).resolves.toBe(
        beforeMap,
      );
      await expect(readFile(projectLockJson(home, ids.projectId), 'utf8')).resolves.toBe(
        beforeLock,
      );
    }));

  it('generates a procedural map and persists tile layers', () =>
    withTempHome(async () => {
      const generated = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Generate' });
          return yield* maps.generate(projectId, {
            width: 16,
            height: 12,
            seed: 42,
            preset: 'dungeon',
          });
        }),
      );
      expect(generated.size.width).toBe(16);
      expect(generated.layers).toHaveLength(3);
      expect(generated.layers.map((layer) => layer._tag)).toEqual(['tile', 'object', 'object']);
      expect(generated.layers.map((layer) => layer.name)).toEqual(['terrain', 'props', 'entities']);
      expect(generated.properties.preset).toBe('dungeon');
    }));

  it('generates concrete terrain tile indices when a paintable pack is selected', () =>
    withTempHome(async () => {
      const sampleFixture = path.join(
        repoRoot,
        'packages/test-fixtures/fixtures/asset-packs/smoke-pack',
      );
      const generated = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Generate Projected' });
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: sampleFixture }),
          );
          return yield* maps.generate(projectId, {
            width: 16,
            height: 12,
            seed: 42,
            preset: 'dungeon',
            tilesetPackId: packId,
          });
        }),
      );
      const terrain = generated.layers[0]?._tag === 'tile' ? generated.layers[0] : undefined;
      const nonZeroTiles = terrain?.chunks[0]?.tiles.filter((tile) => tile !== 0) ?? [];
      const projection = generated.properties.tilesetProjection as
        | {
            readonly semantics?: {
              readonly floor?: { readonly tileIndex: number };
              readonly wall?: { readonly tileIndex: number };
            };
          }
        | undefined;

      expect(generated.properties.tilesetPackId).toBeDefined();
      expect(projection?.semantics?.floor?.tileIndex).toBeGreaterThan(2);
      expect(projection?.semantics?.wall?.tileIndex).toBeGreaterThan(2);
      expect(nonZeroTiles).not.toContain(1);
      expect(nonZeroTiles).not.toContain(2);
      expect(new Set(nonZeroTiles)).toEqual(
        new Set([projection!.semantics!.floor!.tileIndex, projection!.semantics!.wall!.tileIndex]),
      );
    }));

  it('exportToFile writes canonical json atomically', () =>
    withTempHome(async (home) => {
      const { projectId, outFile } = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Export' });
          const created = yield* maps.create(projectId, { width: 4, height: 4 });
          const outFile = 'export.json';
          yield* maps.exportToFile(projectId, created, 'json', outFile);
          return { projectId, outFile, mapId: created };
        }),
      );
      const exported = JSON.parse(
        await readFile(path.join(projectDir(home, projectId), outFile), 'utf8'),
      ) as { readonly id: string };
      expect(exported.id).toBeDefined();
    }));

  it('importFromTiledFile creates a map and canonical paintable pack from an external source folder', () =>
    withTempHome(async (home) => {
      const imported = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Import' });
          const sourceRoot = path.join(home, 'external-tiled-source');
          yield* Effect.promise(async () => {
            await mkdir(sourceRoot, { recursive: true });
            await writeFile(path.join(sourceRoot, 'terrain.png'), png);
            await writeFile(
              path.join(sourceRoot, 'tiled-ground.tmj'),
              `${JSON.stringify(
                {
                  compressionlevel: -1,
                  height: 1,
                  infinite: false,
                  layers: [
                    {
                      data: [1, 2],
                      height: 1,
                      id: 1,
                      name: 'ground',
                      opacity: 1,
                      type: 'tilelayer',
                      visible: true,
                      width: 2,
                      x: 0,
                      y: 0,
                    },
                  ],
                  nextlayerid: 2,
                  nextobjectid: 1,
                  orientation: 'orthogonal',
                  renderorder: 'right-down',
                  tileheight: 32,
                  tilesets: [
                    {
                      firstgid: 1,
                      name: 'ground',
                      image: 'terrain.png',
                      imagewidth: 64,
                      imageheight: 32,
                      tilewidth: 32,
                      tileheight: 32,
                      tilecount: 2,
                      columns: 2,
                    },
                  ],
                  tilewidth: 32,
                  type: 'map',
                  version: '1.10',
                  width: 2,
                },
                null,
                2,
              )}\n`,
            );
          });
          const imported = yield* maps.importFromTiledFile(
            projectId,
            path.join(sourceRoot, 'tiled-ground.tmj'),
          );
          if (imported.kind !== 'map') {
            throw new Error(`expected map import, got ${imported.kind}`);
          }
          const pack =
            imported.packId === undefined ? undefined : yield* assets.getPack(imported.packId);
          return { imported, pack };
        }),
      );
      expect(imported.imported.mapId).toMatch(/^map:/);
      expect(imported.pack?.capability.paintable).toBe(true);
      expect(imported.pack?.capability.tileCount).toBe(2);
      const manifest = JSON.parse(
        await readFile(
          path.join(
            packDir(home, imported.imported.packId!, imported.pack!.version),
            'tileborne-asset-pack.json',
          ),
          'utf8',
        ),
      ) as {
        readonly assets?: readonly {
          readonly size?: unknown;
          readonly hash?: unknown;
          readonly license?: unknown;
        }[];
      };
      expect(manifest.assets?.[0]).toHaveProperty('size');
      expect(manifest.assets?.[0]).toHaveProperty('hash');
      expect(manifest.assets?.[0]).toHaveProperty('license');
    }));
});

describe('AssetService', () => {
  it('imports a pack immediately', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const packId = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );
      expect(packId).toMatch(/^pack:/);
    }));

  it('preserves canonical tileset manifest fields on import', () =>
    withTempHome(async (home) => {
      const manifest = makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440009'));
      const source = await writePackSource(home, manifest);
      const rawManifest = {
        ...assetPackManifestToJson(manifest),
        terrainClasses: ['terrain:grass'],
        tilesets: [
          {
            id: 'tileset:550e8400-e29b-41d4-a716-446655440009',
            name: 'Terrain',
            atlasAssetId: manifest.assets[0]?.id,
            cellSize: { width: 16, height: 16 },
            margin: 0,
            spacing: 0,
          },
        ],
        tiles: [
          {
            id: 'tile:550e8400-e29b-41d4-a716-446655440009',
            tilesetId: 'tileset:550e8400-e29b-41d4-a716-446655440009',
            uv: { x: 0, y: 0, w: 16, h: 16 },
            tags: ['grass'],
            terrainClass: 'terrain:grass',
          },
        ],
        autotileRules: [],
        variantFilters: [],
        animations: [],
        terrainTransitions: [],
        collisionMasks: [],
      };
      await writeFile(
        path.join(source, 'tileborne-asset-pack.json'),
        `${JSON.stringify(rawManifest, null, 2)}\n`,
        'utf8',
      );

      const packId = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );

      const installed = JSON.parse(
        await readFile(path.join(packDir(home, packId), 'tileborne-asset-pack.json'), 'utf8'),
      ) as { readonly tiles?: readonly unknown[]; readonly terrainClasses?: readonly unknown[] };
      expect(installed.terrainClasses).toEqual(['terrain:grass']);
      expect(installed.tiles).toHaveLength(1);
    }));

  it('imports a pack through JobService', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const job = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const jobs = yield* JobService;
          const jobId = yield* assets.importPack(new DirectoryAssetPackSource({ path: source }));
          yield* Effect.sleep('50 millis');
          const state = (yield* jobs.list()).find((entry) => entry.id === jobId);
          return { jobId, state };
        }),
      );
      expect(job.jobId).toMatch(/^job:/);
      expect(job.state?.status._tag).toBe('Completed');
    }));

  it('rejects raw Tiled source folders before creating an import job', () =>
    withTempHome(async (home) => {
      const source = await writeTiledSourceSource(home);
      const result = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const jobs = yield* JobService;
          const failure = yield* assets
            .importPack(new DirectoryAssetPackSource({ path: source }))
            .pipe(
              Effect.match({
                onFailure: (error) => error,
                onSuccess: (jobId) => jobId,
              }),
            );
          const jobStates = yield* jobs.list();
          return { failure, jobs: jobStates };
        }),
      );
      expect(result.failure).toBeInstanceOf(AssetImportError);
      expect(result.failure).toMatchObject({
        message:
          'This folder contains raw Tiled source files, not a Tileborne asset pack. Use the Tiled import panel with a .tmx/.tmj map file, or choose a folder containing tileborne-asset-pack.json.',
      });
      expect(result.jobs).toHaveLength(0);
    }));

  it('lists verified packs', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const packs = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          return yield* assets.listPacks();
        }),
      );
      expect(packs.map((pack) => pack.name)).toEqual(['Tiny Dungeon']);
    }));

  it('gets a verified pack by id', () =>
    withTempHome(async (home) => {
      const manifest = makeManifest();
      const source = await writePackSource(home, manifest);
      const packId = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );
      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.getPack(packId);
        }),
      );
      expect(pack.id).toBe(manifest.id);
      expect(pack.license).toMatchObject({
        attribution: Option.some('Tileborne Fixture Artist'),
        sourcePath: 'packages/services-app/test-fixtures/tiny-dungeon',
        modifications: 'Generated for AssetService persistence coverage',
        redistributable: true,
      });
      const assetLicense = pack.assets[0]?.license;
      if (assetLicense === undefined) {
        throw new Error('expected imported asset license');
      }
      expect(Option.getOrUndefined(assetLicense)).toMatchObject({
        attribution: Option.some('Tileborne Fixture Artist'),
        sourcePath: 'packages/services-app/test-fixtures/tiny-dungeon',
        modifications: 'Generated for AssetService persistence coverage',
        redistributable: true,
      });
    }));

  it('verifies a pack once then serves it from the in-memory cache', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const result = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const id = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          // First call verifies + caches the pack.
          const first = yield* assets.getPack(id);
          // Corrupt the installed asset bytes on disk. A cached getPack must NOT
          // re-read/re-hash them, so it should still succeed with the same data.
          yield* Effect.promise(() =>
            writeFile(path.join(packDir(home, id), 'tiles', 'terrain.png'), changedPng),
          );
          const second = yield* assets.getPack(id);
          return { firstId: first.id, secondId: second.id };
        }),
      );
      expect(result.secondId).toBe(result.firstId);
    }));

  it('invalidates the cached pack after removal', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const outcome = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const id = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          yield* assets.getPack(id);
          yield* assets.removePack(id);
          return yield* assets.getPack(id).pipe(
            Effect.match({
              onFailure: (error) => error._tag,
              onSuccess: () => 'unexpected-success',
            }),
          );
        }),
      );
      expect(outcome).toBe('AssetPackNotFoundError');
    }));

  it('clears the pack selection from a legacy-`kind` map during pack removal', () =>
    withTempHome(async (home) => {
      const sampleFixture = path.join(
        repoRoot,
        'packages/test-fixtures/fixtures/asset-packs/smoke-pack',
      );
      const ids = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Legacy Cleanup' });
          const mapId = yield* maps.create(projectId, { width: 4, height: 4 });
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: sampleFixture }),
          );
          yield* maps.setMapTilesetPack(projectId, mapId, packId);
          return { projectId, mapId, packId };
        }),
      );

      // Rewrite the persisted map with a pre-ADR-0019 free-string `kind` object
      // (and omitted optional keys). Pack-removal cleanup must decode it through
      // the canonical migration boundary instead of failing on the legacy shape.
      const mapFile = mapJson(home, ids.projectId, ids.mapId);
      const persisted = JSON.parse(await readFile(mapFile, 'utf8')) as {
        objects: unknown[];
        layers: readonly { readonly id: string }[];
      };
      persisted.objects = [
        ...persisted.objects,
        {
          id: 'object:f08061c1-423d-4532-b972-0cb221b1a08a',
          kind: 'spawn-point',
          x: 1,
          y: 1,
          layerId: persisted.layers[0]?.id ?? 'layer:00000000-0000-4000-8000-000000000004',
          properties: {},
        },
      ];
      await writeFile(mapFile, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

      await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          yield* assets.removePack(ids.packId);
        }),
      );

      await expect(readFile(mapFile, 'utf8')).resolves.not.toContain(ids.packId);
    }));

  it('re-verifies a pack after re-import invalidates the cache', () =>
    withTempHome(async (home) => {
      const packId = makePackId('550e8400-e29b-41d4-a716-446655440031');
      // Distinct but still-valid PNG (valid 8-byte signature + trailing byte) so
      // the re-import passes security validation while changing the pack hash.
      const png2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const source = await writePackSource(
        home,
        makeManifest(packId, 'tiles/terrain.png', png),
        png,
      );
      const result = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const id = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          const before = yield* assets.getPack(id);
          // Re-author the same source with changed bytes, then re-import. The
          // import must drop the cache so the next getPack re-verifies the new
          // content rather than returning the stale cached pack.
          yield* Effect.promise(() =>
            writePackSource(home, makeManifest(id, 'tiles/terrain.png', png2), png2),
          );
          yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          const after = yield* assets.getPack(id);
          return {
            beforeHash: before.assets[0]?.hash,
            afterHash: after.assets[0]?.hash,
          };
        }),
      );
      expect(result.afterHash).toBeDefined();
      expect(result.afterHash).not.toBe(result.beforeHash);
    }));

  it('rejects path traversal during pack import', () =>
    withTempHome(async (home) => {
      const manifest = makeManifest(
        makePackId('550e8400-e29b-41d4-a716-446655440002'),
        '../escape.png',
      );
      const source = await writePackSource(home, manifest);
      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'AssetImportError' });
    }));

  it('rejects staged asset symlinks that escape before hashing', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(
        home,
        makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440003')),
      );
      const outside = path.join(home, 'outside.png');
      await writeFile(outside, png);
      await rm(path.join(source, 'tiles', 'terrain.png'));
      await symlink(outside, path.join(source, 'tiles', 'terrain.png'));

      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'AssetImportError' });
    }));

  it('rejects source pack manifest symlinks that escape during import', () =>
    withTempHome(async (home) => {
      const manifest = makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440005'));
      const source = await writePackSource(home, manifest);
      const outside = path.join(home, 'outside-manifest.json');
      await writeFile(
        outside,
        `${JSON.stringify(assetPackManifestToJson(manifest), null, 2)}\n`,
        'utf8',
      );
      await rm(path.join(source, 'tileborne-asset-pack.json'));
      await symlink(outside, path.join(source, 'tileborne-asset-pack.json'));

      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          }),
        ),
      ).rejects.toBeInstanceOf(AssetImportError);
    }));

  it('rejects staged pack lock symlinks before writing the lock', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(
        home,
        makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440006')),
      );
      const outside = path.join(home, 'outside-lock.json');
      await writeFile(outside, '{}\n', 'utf8');
      await symlink(outside, path.join(source, 'lock.json'));

      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          }),
        ),
      ).rejects.toBeInstanceOf(AssetImportError);
    }));

  it('records integrity hashes in the pack lock', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const id = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );
      const lock = JSON.parse(
        await readFile(path.join(packDir(home, id), 'lock.json'), 'utf8'),
      ) as {
        readonly manifestHash: string;
        readonly files: readonly { readonly hash: string }[];
      };
      expect(lock.manifestHash).toMatch(/^sha256:/);
      expect(lock.files[0]?.hash).toMatch(/^sha256:/);
    }));

  it('refreshes stale manifest integrity locks for valid canonical manifests', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(
        home,
        makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440019')),
      );
      const id = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );

      const installedManifestPath = path.join(packDir(home, id), 'tileborne-asset-pack.json');
      const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8')) as {
        license?: Record<string, unknown>;
        assets?: { license?: Record<string, unknown> }[];
      } & Record<string, unknown>;
      delete installedManifest.license?.['redistributable'];
      for (const asset of installedManifest.assets ?? []) {
        delete asset.license?.['redistributable'];
      }
      await writeFile(
        installedManifestPath,
        `${JSON.stringify(installedManifest, null, 2)}\n`,
        'utf8',
      );

      const lockPath = path.join(packDir(home, id), 'lock.json');
      const staleLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        manifestHash: string;
      };
      staleLock.manifestHash = rawAssetPackManifestIntegrityHash(installedManifest);
      await writeFile(lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, 'utf8');

      const pack = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const packs = yield* assets.listPacks();
          return packs.find((candidate) => candidate.id === id);
        }),
      );
      expect(pack).toBeDefined();

      const migratedLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly manifestHash: string;
      };
      expect(migratedLock.manifestHash).toBe(hashAssetPackManifest(pack!));

      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.getPack(id);
          }),
        ),
      ).resolves.toMatchObject({ id });
    }));

  it('rejects asset tampering on read', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const id = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );
      await writeFile(path.join(packDir(home, id), 'tiles', 'terrain.png'), changedPng);
      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.getPack(id);
          }),
        ),
      ).rejects.toBeInstanceOf(AssetIntegrityError);
    }));

  it('rejects installed asset symlinks that escape on read', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(
        home,
        makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440004')),
      );
      const id = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );
      const outside = path.join(home, 'outside-installed.png');
      await writeFile(outside, png);
      await rm(path.join(packDir(home, id), 'tiles', 'terrain.png'));
      await symlink(outside, path.join(packDir(home, id), 'tiles', 'terrain.png'));

      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.getPack(id);
          }),
        ),
      ).rejects.toBeInstanceOf(AssetIntegrityError);
    }));

  it('rejects installed pack lock symlinks that escape on read', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(
        home,
        makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440007')),
      );
      const id = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );
      const installedLock = path.join(packDir(home, id), 'lock.json');
      const outside = path.join(home, 'outside-installed-lock.json');
      await writeFile(outside, await readFile(installedLock, 'utf8'), 'utf8');
      await rm(installedLock);
      await symlink(outside, installedLock);

      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.getPack(id);
          }),
        ),
      ).rejects.toBeInstanceOf(AssetIntegrityError);
    }));

  it('rejects installed pack manifest symlinks that escape on read', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(
        home,
        makeManifest(makePackId('550e8400-e29b-41d4-a716-446655440008')),
      );
      const id = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          return yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
        }),
      );
      const installedManifest = path.join(packDir(home, id), 'tileborne-asset-pack.json');
      const outside = path.join(home, 'outside-installed-manifest.json');
      await writeFile(outside, await readFile(installedManifest, 'utf8'), 'utf8');
      await rm(installedManifest);
      await symlink(outside, installedManifest);

      await expect(
        runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.getPack(id);
          }),
        ),
      ).rejects.toBeInstanceOf(AssetIntegrityError);
    }));

  it('removes an imported pack directory', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const packs = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const id = yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          yield* assets.removePack(id);
          return yield* assets.listPacks();
        }),
      );
      expect(packs).toEqual([]);
    }));

  it('removes project and map references before deleting an installed pack', () =>
    withTempHome(async (home) => {
      const sampleFixture = path.join(
        repoRoot,
        'packages/test-fixtures/fixtures/asset-packs/smoke-pack',
      );
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const packId = yield* assets.importPackNow(
            new DirectoryAssetPackSource({ path: sampleFixture }),
          );
          const installed = yield* assets.getPack(packId);
          const projectId = yield* projects.create({
            name: 'Remove Pack References',
            assetPacks: [{ id: packId, version: installed.version }],
          });
          const generated = yield* maps.generate(projectId, {
            width: 8,
            height: 8,
            seed: 42,
            preset: 'dungeon',
            tilesetPackId: packId,
          });
          const beforeLock = JSON.parse(
            yield* Effect.promise(() => readFile(projectLockJson(home, projectId), 'utf8')),
          ) as {
            readonly maps: readonly { readonly id: string; readonly hash: string }[];
          };

          yield* assets.removePack(packId);

          const project = yield* projects.open(projectId);
          const map = yield* maps.load(projectId, generated.id);
          const packs = yield* assets.listPacks();
          const afterLock = JSON.parse(
            yield* Effect.promise(() => readFile(projectLockJson(home, projectId), 'utf8')),
          ) as {
            readonly maps: readonly { readonly id: string; readonly hash: string }[];
          };
          const mapFile = yield* Effect.promise(() =>
            readFile(mapJson(home, projectId, generated.id), 'utf8'),
          );
          return {
            packId,
            projectId,
            mapId: generated.id,
            project,
            map,
            packs,
            beforeLock,
            afterLock,
            mapFile,
          };
        }),
      );

      expect(result.packs).toEqual([]);
      expect(result.project.assetPacks).toEqual([]);
      expect(result.map.properties.tilesetPackId).toBeUndefined();
      expect(result.map.properties.tilesetProjection).toBeUndefined();
      expect(result.mapFile).not.toContain(result.packId);
      expect(result.mapFile).not.toContain('tilesetProjection');
      const beforeHash = result.beforeLock.maps.find((entry) => entry.id === result.mapId)?.hash;
      const afterHash = result.afterLock.maps.find((entry) => entry.id === result.mapId)?.hash;
      expect(afterHash).toMatch(/^sha256:/);
      expect(afterHash).not.toBe(beforeHash);
      await expect(readFile(packDir(home, result.packId), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }));

  it('publishes pack list updates', () =>
    withTempHome(async (home) => {
      const source = await writePackSource(home);
      const emissions = await runApp(
        Effect.gen(function* () {
          const assets = yield* AssetService;
          const fiber = yield* assets.subscribe.pipe(
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* assets.importPackNow(new DirectoryAssetPackSource({ path: source }));
          return yield* Fiber.join(fiber);
        }),
      );
      expect(Array.from(emissions).map((list) => list.length)).toEqual([0, 1]);
    }));
});

describe('Cross-service references', () => {
  it('round-trips plugin-contributed asset-pack references through the registry', () =>
    withTempHome(async (home) => {
      const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/battle-royale');
      const contributedPackId = 'sample-tileset';
      const source = await writePluginSource(home, contributedPackId, pluginId);
      const result = await runAppWithPlugins(
        Effect.gen(function* () {
          const installer = yield* PluginInstallerService;
          const registry = yield* PluginRegistryService;
          const projects = yield* ProjectService;
          const installed = yield* installer.install(new LocalPluginSource({ path: source }));
          const discovered = yield* registry.discover();
          const projectId = yield* projects.create({
            name: 'Contributed',
            plugins: [
              {
                id: installed.id,
                version: installed.version,
              },
            ],
            assetPacks: [{ id: contributedPackId, version: installed.version }],
          });
          const created = yield* projects.open(projectId);
          yield* projects.save(created);
          const reopened = yield* projects.open(projectId);
          const manifest = yield* registry.getManifest(installed.id);
          return { discovered, manifest, project: reopened };
        }),
      );
      const contribution = Option.getOrUndefined(result.manifest.contributes.assetPacks)?.[0];
      expect(result.discovered.map((plugin) => plugin.id)).toContain(pluginId);
      expect(result.project.plugins[0]?.id).toBe(pluginId);
      expect(result.project.assetPacks[0]?.id).toBe(contribution?.id);
      expect(result.project.assetPacks[0]?.version).toBe('0.1.0');
    }));
});

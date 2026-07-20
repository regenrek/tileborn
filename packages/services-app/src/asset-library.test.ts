import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';

import { decodeEditorTilesetIndex } from '@tileborne/sdk-tileset/editor-index';

import {
  AssetLibraryReference,
  MapObject,
  MapObjectPlacement,
  TileborneMap,
  type Uuid,
  gameObjectTypeIdForKey,
  hashBytes,
  makeObjectId,
  makePlaceableId,
  makeTileId,
} from '@tileborne/core';
import { FoundationLayer } from '@tileborne/services-foundation';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { AssetService, DirectoryAssetPackSource, packManifestContentHash } from './asset/index.js';
import { AssetLibraryService, WorkingPaletteService } from './asset-library/index.js';
import { ServicesAppLayer } from './index.js';
import { removeAssetPack } from './asset-removal.js';
import { MapService } from './map/index.js';
import { ProjectService } from './project/index.js';
import { withTempHome } from './test-utils.js';

const appLayer = ServicesAppLayer.pipe(Layer.provideMerge(FoundationLayer));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sampleFixture = path.join(repoRoot, 'packages/test-fixtures/fixtures/asset-packs/smoke-pack');
const cacheSegment = (value: string): string => value.replace(/[^a-zA-Z0-9.-]/g, '_');
const cacheDir = (home: string): string => path.join(home, 'cache/asset-library/index-metadata');
const editorIndexDir = (home: string): string =>
  path.join(home, 'cache/asset-library/editor-index');
const editorIndexFiles = async (home: string): Promise<readonly string[]> => {
  try {
    return (await readdir(editorIndexDir(home))).filter((entry) => entry.endsWith('.json')).sort();
  } catch {
    return [];
  }
};
const cacheFiles = async (home: string): Promise<readonly string[]> =>
  (await readdir(cacheDir(home))).filter((entry) => entry.endsWith('.json')).sort();
const readCachePayload = async (home: string, fileName: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path.join(cacheDir(home), fileName), 'utf8')) as Record<
    string,
    unknown
  >;
const writeOtherPackFixture = async (home: string): Promise<string> => {
  const destination = path.join(home, 'other-smoke-pack');
  await cp(sampleFixture, destination, { recursive: true });
  const manifestPath = path.join(destination, 'tileborne-asset-pack.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest['id'] = 'pack:550e8400-e29b-41d4-a716-446655440188';
  manifest['name'] = 'Other Smoke Pack';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return destination;
};

const writeStandaloneAssetPackFixture = async (home: string): Promise<string> => {
  const destination = path.join(home, 'standalone-asset-smoke-pack');
  await cp(sampleFixture, destination, { recursive: true });
  const manifestPath = path.join(destination, 'tileborne-asset-pack.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    assets: Array<Record<string, unknown>>;
  } & Record<string, unknown>;
  manifest.license = {
    spdxId: 'CC0-1.0',
    attribution: 'Pack Artist',
    sourceUrl: 'https://example.invalid/inherited-pack-license',
    redistributable: true,
  };
  const assetPath = 'images/standalone-background.png';
  const inheritedAssetPath = 'images/inherited-license-background.png';
  const destinationAsset = path.join(destination, assetPath);
  const inheritedDestinationAsset = path.join(destination, inheritedAssetPath);
  await mkdir(path.join(destination, 'images'), { recursive: true });
  await cp(path.join(destination, 'tiles/terrain.png'), destinationAsset, { force: true });
  await cp(path.join(destination, 'tiles/terrain.png'), inheritedDestinationAsset, { force: true });
  const assetBytes = await readFile(destinationAsset);
  manifest.assets.push({
    id: 'asset:550e8400-e29b-41d4-a716-446655440020',
    path: assetPath,
    mime: 'image/png',
    size: assetBytes.byteLength,
    hash: hashBytes(assetBytes),
    license: {
      spdxId: 'CC-BY-4.0',
      attribution: 'Standalone Artist',
      redistributable: false,
    },
  });
  manifest.assets.push({
    id: 'asset:550e8400-e29b-41d4-a716-446655440021',
    path: inheritedAssetPath,
    mime: 'image/png',
    size: assetBytes.byteLength,
    hash: hashBytes(assetBytes),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return destination;
};

const runApp = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    AssetService | AssetLibraryService | ProjectService | WorkingPaletteService | MapService
  >,
) => Effect.runPromise(effect.pipe(Effect.provide(appLayer)));

describe('AssetLibraryService', () => {
  it(
    'groups a canonical paintable pack without returning every tile as a sidebar item',
    () =>
      withTempHome(async () => {
        const result = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            const pack = yield* assets.getPack(packId);
            const index = yield* library.getPackLibrary({ packId, limit: 50 });
            return { pack, index };
          }),
        );

        expect(result.pack.capability.tileCount).toBeGreaterThan(0);
        expect(result.index.groups.length).toBeLessThanOrEqual(50);
        expect(result.index.total).toBeLessThanOrEqual(
          result.pack.capability.tileCount + result.pack.assets.length,
        );
        expect(result.index.groups.some((group) => group.kind === 'tileset')).toBe(true);
        expect(result.index.groups.every((group) => group.previewRefs.length <= 8)).toBe(true);
      }),
    20_000,
  );

  it(
    'filters and paginates grouped library metadata',
    () =>
      withTempHome(async () => {
        const response = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            return yield* library.getPackLibrary({
              packId,
              groupKind: 'terrain',
              query: 'grass',
              offset: 0,
              limit: 5,
            });
          }),
        );

        expect(response.groups.length).toBeLessThanOrEqual(5);
        expect(response.groups.every((group) => group.kind === 'terrain')).toBe(true);
        expect(response.groups.every((group) => group.searchText.includes('grass'))).toBe(true);
      }),
    20_000,
  );

  it(
    'indexes standalone manifest assets with license metadata for diagnostic focus',
    () =>
      withTempHome(async (home) => {
        const fixture = await writeStandaloneAssetPackFixture(home);
        const result = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: fixture }),
            );
            return yield* library.getPackLibrary({
              packId,
              groupKind: 'asset',
              query: 'asset:550e8400-e29b-41d4-a716-446655440020',
              limit: 5,
            });
          }),
        );

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]?.kind).toBe('asset');
        expect(result.groups[0]?.label).toBe('standalone-background.png');
        expect(result.groups[0]?.metadata).toMatchObject({
          assetId: 'asset:550e8400-e29b-41d4-a716-446655440020',
          path: 'images/standalone-background.png',
          mime: 'image/png',
          licenseSpdxId: 'CC-BY-4.0',
          licenseAttribution: 'Standalone Artist',
          licenseScope: 'asset override',
          licenseRedistributable: 'false',
        });
      }),
    20_000,
  );

  it(
    'indexes inherited pack license metadata on raw manifest assets',
    () =>
      withTempHome(async (home) => {
        const fixture = await writeStandaloneAssetPackFixture(home);
        const result = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: fixture }),
            );
            return yield* library.getPackLibrary({
              packId,
              groupKind: 'asset',
              query: 'asset:550e8400-e29b-41d4-a716-446655440021',
              limit: 5,
            });
          }),
        );

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]?.metadata).toMatchObject({
          assetId: 'asset:550e8400-e29b-41d4-a716-446655440021',
          path: 'images/inherited-license-background.png',
          licenseScope: 'inherited from pack',
          licenseSpdxId: 'CC0-1.0',
          licenseAttribution: 'Pack Artist',
          licenseSourceUrl: 'https://example.invalid/inherited-pack-license',
          licenseRedistributable: 'true',
        });
      }),
    20_000,
  );

  it(
    'caches a pack index by integrity and serves search/page from the cached index',
    () =>
      withTempHome(async (home) => {
        const result = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            const cold = yield* library.getPackCacheStatus({ packId });
            const first = yield* library.getPackLibrary({ packId, limit: 5 });
            const cached = yield* library.getPackCacheStatus({ packId });
            const second = yield* library.getPackLibrary({
              packId,
              groupKind: 'terrain',
              query: 'grass',
              offset: 0,
              limit: 5,
            });
            return { cold, first, cached, second };
          }),
        );
        const [fileName] = await cacheFiles(home);
        const payload = await readCachePayload(home, fileName!);

        expect(result.cold.state).toBe('cold');
        expect(result.first.integrityHash).toMatch(/^sha256:/);
        expect(result.first.indexSchemaVersion).toBe(2);
        expect(result.first.previewRefLimit).toBe(8);
        expect(result.first.groups.every((group) => group.previewRefs.length <= 8)).toBe(true);
        expect(result.first.groups.some((group) => group.previewRefs[0]?.thumbnailCacheKey)).toBe(
          true,
        );
        expect(result.cached.state).toBe('cached');
        expect(result.cached.groupCount).toBeGreaterThanOrEqual(result.first.total);
        expect(result.second.groups.every((group) => group.kind === 'terrain')).toBe(true);
        expect(payload['integrityHash']).toBe(result.first.integrityHash);
        expect(payload['schemaVersion']).toBe(2);
      }),
    40_000,
  );

  it(
    'ignores seeded v1 metadata caches and rebuilds raw asset groups into v2',
    () =>
      withTempHome(async (home) => {
        const fixture = await writeStandaloneAssetPackFixture(home);
        const seed = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: fixture }),
            );
            const pack = yield* assets.getPack(packId);
            return { packId, integrityHash: packManifestContentHash(pack) };
          }),
        );
        await mkdir(cacheDir(home), { recursive: true });
        await writeFile(
          path.join(
            cacheDir(home),
            `v1-${cacheSegment(seed.packId)}-${cacheSegment(seed.integrityHash)}.json`,
          ),
          `${JSON.stringify(
            {
              schemaVersion: 1,
              packId: seed.packId,
              integrityHash: seed.integrityHash,
              updatedAt: '2026-07-17T00:00:00.000Z',
              previewRefCount: 0,
              index: { packId: seed.packId, totalGroups: 0, groups: [] },
            },
            null,
            2,
          )}\n`,
          'utf8',
        );

        const rebuilt = await runApp(
          Effect.gen(function* () {
            const library = yield* AssetLibraryService;
            return yield* library.getPackLibrary({
              packId: seed.packId,
              groupKind: 'asset',
              query: 'asset:550e8400-e29b-41d4-a716-446655440021',
              limit: 5,
            });
          }),
        );
        const entries = await cacheFiles(home);
        const rebuiltFile = entries.find((entry) =>
          entry.startsWith(`v2-${cacheSegment(seed.packId)}-`),
        );
        const rebuiltPayload =
          rebuiltFile === undefined ? undefined : await readCachePayload(home, rebuiltFile);

        expect(rebuilt.groups).toHaveLength(1);
        expect(rebuilt.groups[0]?.metadata['licenseScope']).toBe('inherited from pack');
        expect(entries.some((entry) => entry.startsWith(`v1-${cacheSegment(seed.packId)}-`))).toBe(
          true,
        );
        expect(rebuiltFile).toBeDefined();
        expect(rebuiltPayload?.['schemaVersion']).toBe(2);
        expect(rebuiltPayload?.['integrityHash']).toBe(seed.integrityHash);
      }),
    40_000,
  );

  it(
    'marks old integrity cache files stale before rebuilding the current index',
    () =>
      withTempHome(async (home) => {
        const packId = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
          }),
        );
        await mkdir(cacheDir(home), { recursive: true });
        await writeFile(
          path.join(
            cacheDir(home),
            `v2-${cacheSegment(packId)}-${cacheSegment(`sha256:${'0'.repeat(64)}`)}.json`,
          ),
          '{}',
          'utf8',
        );

        const status = await runApp(
          Effect.gen(function* () {
            const library = yield* AssetLibraryService;
            return yield* library.getPackCacheStatus({ packId });
          }),
        );

        expect(status.state).toBe('stale');
      }),
    40_000,
  );

  it(
    'invalidates incompatible disk schema and reloads the metadata cache',
    () =>
      withTempHome(async (home) => {
        const initial = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            const first = yield* library.getPackLibrary({ packId, limit: 1 });
            return { packId, first };
          }),
        );
        const [fileName] = await cacheFiles(home);
        const filePath = path.join(cacheDir(home), fileName!);
        const stalePayload = await readCachePayload(home, fileName!);
        await writeFile(filePath, `${JSON.stringify({ ...stalePayload, schemaVersion: 0 })}\n`);

        const afterSchemaChange = await runApp(
          Effect.gen(function* () {
            const library = yield* AssetLibraryService;
            const rebuilt = yield* library.getPackLibrary({ packId: initial.packId, limit: 1 });
            const reloaded = yield* library.reloadPackCache({ packId: initial.packId });
            return { rebuilt, reloaded };
          }),
        );
        const payloads = await Promise.all(
          (await cacheFiles(home)).map((entry) => readCachePayload(home, entry)),
        );

        expect(afterSchemaChange.rebuilt.integrityHash).toBe(initial.first.integrityHash);
        expect(
          payloads.some(
            (payload) =>
              payload['schemaVersion'] === 2 &&
              payload['integrityHash'] === initial.first.integrityHash,
          ),
        ).toBe(true);
        expect(afterSchemaChange.reloaded.state).toBe('cached');
        expect(afterSchemaChange.reloaded.cacheKind).toBe('index-metadata');
        expect(afterSchemaChange.reloaded.thumbnailSheetsAvailable).toBe(false);
      }),
    40_000,
  );

  it(
    'removes a pack through the app workflow, invalidating cache and pruning palette items',
    () =>
      withTempHome(async (home) => {
        const result = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const projects = yield* ProjectService;
            const palettes = yield* WorkingPaletteService;

            const removedPackId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            const otherFixture = yield* Effect.promise(() => writeOtherPackFixture(home));
            const otherPackId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: otherFixture }),
            );
            const removedLibrary = yield* library.getPackLibrary({
              packId: removedPackId,
              limit: 200,
            });
            const removedRef =
              removedLibrary.groups.find((group) => group.primaryRef !== undefined)?.primaryRef ??
              removedLibrary.groups[0]!.previewRefs[0]!;
            const otherTileId = makeTileId('550e8400-e29b-41d4-a716-446655440777');
            const otherRef = new AssetLibraryReference({
              packId: otherPackId,
              kind: 'tile',
              refId: otherTileId,
              tileId: otherTileId,
            });
            const projectId = yield* projects.create({ name: 'Pack Removal Palettes' });
            const maps = yield* MapService;
            const mapId = yield* maps.create(projectId, {
              width: 8,
              height: 8,
              properties: { tilesetPackId: removedPackId },
            });
            const map = yield* maps.load(projectId, mapId);
            yield* maps.save(
              projectId,
              new TileborneMap({
                ...map,
                objects: [
                  new MapObject({
                    id: makeObjectId('00000000-0000-4000-8000-000000000091' as Uuid),
                    kind: gameObjectTypeIdForKey('tree'),
                    x: 32,
                    y: 64,
                    width: Option.none(),
                    height: Option.none(),
                    layerId: map.layers[0]!.id,
                    properties: {},
                    placement: new MapObjectPlacement({
                      packId: Option.some(removedPackId),
                      placeableId: makePlaceableId('00000000-0000-4000-8000-000000000092' as Uuid),
                      source: 'tiled-object',
                      assetId: Option.none(),
                      tileId: Option.none(),
                      gid: Option.none(),
                    }),
                  }),
                ],
              }),
            );
            const palette = yield* palettes.create({
              projectId,
              name: 'Mixed pack palette',
              items: [
                { ref: removedRef, label: 'Removed pack item' },
                { ref: otherRef, label: 'Other pack item' },
              ],
            });
            yield* library.reloadPackCache({ packId: removedPackId });

            const removal = yield* removeAssetPack(removedPackId);
            const afterPalettes = yield* palettes.list({ projectId });
            const afterPacks = yield* assets.listPacks();

            return {
              removedPackId,
              otherPackId,
              projectId,
              paletteId: palette.id,
              removal,
              afterPalettes,
              afterPacks,
            };
          }),
        );
        const cacheEntriesAfterRemoval = await cacheFiles(home);

        expect(result.removal.removedPackId).toBe(result.removedPackId);
        expect(result.removal.invalidatedAssetLibraryCacheEntries).toBeGreaterThan(0);
        expect(result.removal.prunedWorkingPaletteItemCount).toBe(1);
        expect(result.removal.affectedProjectIds).toContain(result.projectId);
        expect(result.removal.affectedPaletteIds).toContain(result.paletteId);
        expect(result.afterPalettes.palettes[0]?.items.map((item) => item.ref.packId)).toEqual([
          result.otherPackId,
        ]);
        expect(result.afterPacks.map((pack) => pack.id)).toEqual([result.otherPackId]);
        expect(
          cacheEntriesAfterRemoval.some((entry) =>
            entry.startsWith(`v2-${cacheSegment(result.removedPackId)}-`),
          ),
        ).toBe(false);
        const reimported = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            const packLibrary = yield* library.getPackLibrary({ packId, limit: 1 });
            return { packId, packLibrary };
          }),
        );
        expect(reimported.packId).toBe(result.removedPackId);
        expect(reimported.packLibrary.groups.length).toBeGreaterThan(0);
      }),
    40_000,
  );

  it(
    'builds, persists and serves a compact editor index that self-heals when deleted',
    () =>
      withTempHome(async (home) => {
        const first = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            const pack = yield* assets.getPack(packId);
            const result = yield* library.getEditorIndex({ packId });
            return { packId, tileCount: pack.capability.tileCount, result };
          }),
        );

        // The served index decodes into the same global tile-index ordering the
        // renderer would otherwise derive from the full manifest.
        const decodedFirst = decodeEditorTilesetIndex(JSON.parse(first.result.indexJson));
        expect(first.result.schemaVersion).toBe(1);
        expect(first.result.integrityHash).toMatch(/^sha256:/);
        expect(decodedFirst.tileIndexByTileId.size).toBe(first.tileCount);
        expect(decodedFirst.tileFramesByIndex.size).toBeGreaterThan(0);

        // Persisted, content-addressed by integrity hash.
        const cachedFiles = await editorIndexFiles(home);
        expect(cachedFiles.length).toBe(1);
        const onDisk = JSON.parse(
          await readFile(path.join(editorIndexDir(home), cachedFiles[0]!), 'utf8'),
        ) as Record<string, unknown>;
        expect(onDisk['integrityHash']).toBe(first.result.integrityHash);
        expect(onDisk['schemaVersion']).toBe(1);

        // Deleting the cache file self-heals on the next request (regenerated).
        await rm(path.join(editorIndexDir(home), cachedFiles[0]!), { force: true });
        const second = await runApp(
          Effect.gen(function* () {
            const library = yield* AssetLibraryService;
            return yield* library.getEditorIndex({ packId: first.packId });
          }),
        );
        expect(second.indexJson).toBe(first.result.indexJson);
        expect((await editorIndexFiles(home)).length).toBe(1);
      }),
    40_000,
  );

  it(
    'removes the editor index cache when a pack is removed',
    () =>
      withTempHome(async (home) => {
        const packId = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const library = yield* AssetLibraryService;
            const importedPackId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            yield* library.getEditorIndex({ packId: importedPackId });
            return importedPackId;
          }),
        );
        expect((await editorIndexFiles(home)).length).toBe(1);

        await runApp(removeAssetPack(packId).pipe(Effect.asVoid));
        expect(await editorIndexFiles(home)).toEqual([]);
      }),
    40_000,
  );
});

describe('WorkingPaletteService', () => {
  it(
    'creates a bounded default palette for a project pack and persists palette CRUD',
    () =>
      withTempHome(async () => {
        const result = await runApp(
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const projects = yield* ProjectService;
            const library = yield* AssetLibraryService;
            const palettes = yield* WorkingPaletteService;

            const packId = yield* assets.importPackNow(
              new DirectoryAssetPackSource({ path: sampleFixture }),
            );
            const pack = yield* assets.getPack(packId);
            const projectId = yield* projects.create({
              name: 'Working Palettes',
              assetPacks: [{ id: packId, version: pack.version }],
            });

            const initial = yield* palettes.list({ projectId });
            const firstDefault = initial.palettes[0]!;
            const selectableGroup = (yield* library.getPackLibrary({
              packId,
              limit: 200,
            })).groups.find((group) => group.primaryRef !== undefined)!;
            const created = yield* palettes.create({
              projectId,
              name: 'Curated Terrain',
              items: [{ ref: selectableGroup.primaryRef!, label: selectableGroup.label }],
            });
            const active = yield* palettes.setActive({ projectId, paletteId: created.id });
            const withSecondItem = yield* palettes.addItems({
              projectId,
              paletteId: created.id,
              items: [{ ref: firstDefault.items[1]!.ref, label: 'Default second item' }],
            });
            const reordered = yield* palettes.reorderItems({
              projectId,
              paletteId: created.id,
              itemIds: [...withSecondItem.items].reverse().map((item) => item.id),
            });
            const removed = yield* palettes.removeItem({
              projectId,
              paletteId: created.id,
              itemId: reordered.items[0]!.id,
            });
            yield* palettes.delete({ projectId, paletteId: created.id });
            const finalList = yield* palettes.list({ projectId });

            return {
              initial,
              firstDefault,
              created,
              active,
              withSecondItem,
              reordered,
              removed,
              finalList,
            };
          }),
        );

        expect(result.initial.activePaletteId).toBe(result.firstDefault.id);
        expect(result.firstDefault.items.length).toBeGreaterThan(0);
        expect(result.firstDefault.items.length).toBeLessThanOrEqual(24);
        expect(result.created.items).toHaveLength(1);
        expect(result.active.id).toBe(result.created.id);
        expect(result.withSecondItem.items).toHaveLength(2);
        expect(result.reordered.items[0]?.id).toBe(result.withSecondItem.items[1]?.id);
        expect(result.removed.items).toHaveLength(1);
        expect(result.finalList.palettes.map((palette) => palette.id)).toEqual([
          result.firstDefault.id,
        ]);
      }),
    20_000,
  );
});

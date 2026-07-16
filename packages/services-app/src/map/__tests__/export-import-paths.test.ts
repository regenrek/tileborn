import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { ProjectId } from '@tileborne/core';
import { FoundationLayer } from '@tileborne/services-foundation';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ServicesAppLayer } from '../../index.js';
import { MapService } from '../index.js';
import { AssetService } from '../../asset/index.js';
import { WorkingPaletteService } from '../../asset-library/index.js';
import {
  appendProjectImportRecord,
  ProjectService,
  type ImportRecord,
} from '../../project/index.js';
import { withTempHome } from '../../test-utils.js';

const appLayer = ServicesAppLayer.pipe(Layer.provideMerge(FoundationLayer));

const runApp = <A, E>(
  effect: Effect.Effect<A, E, AssetService | ProjectService | MapService | WorkingPaletteService>,
) => Effect.runPromise(effect.pipe(Effect.provide(appLayer)));

const projectDir = (home: string, projectId: ProjectId) => path.join(home, 'projects', projectId);

const escapingImageTmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="1" height="1" tilewidth="16" tileheight="16">
  <tileset firstgid="1" name="objects" tilewidth="16" tileheight="16" tilecount="1" columns="0">
    <tile id="0">
      <image source="../../outside.png" width="16" height="16"/>
    </tile>
  </tileset>
  <objectgroup id="1" name="objects">
    <object id="1" gid="1" x="0" y="16" width="16" height="16"/>
  </objectgroup>
</map>`;

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzJ7wAAAABJRU5ErkJggg==',
  'base64',
);

const tileLayerBase64 = (gids: readonly number[]): string => {
  const bytes = new Uint8Array(gids.length * 4);
  const view = new DataView(bytes.buffer);
  gids.forEach((gid, index) => view.setUint32(index * 4, gid, true));
  return Buffer.from(bytes).toString('base64');
};

const compressedGroundTmx = (payload: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="2" height="2" tilewidth="16" tileheight="16">
  <tileset firstgid="1" name="ground" tilewidth="16" tileheight="16" tilecount="4" columns="2">
    <image source="ground.png" width="32" height="32"/>
  </tileset>
  <layer id="1" name="ground" width="2" height="2">
    <data encoding="base64" compression="zlib">${payload}</data>
  </layer>
</map>`;

const standaloneTilesetTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.10.2" name="props" tilewidth="16" tileheight="16" tilecount="1" columns="0">
  <tile id="1618" type="Tree">
    <image source="tree.png" width="16" height="16"/>
  </tile>
</tileset>`;

const standaloneTilesetWithSiblingImageRootTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.10.2" name="props" tilewidth="16" tileheight="16" tilecount="1" columns="0">
  <tile id="1618" type="Tree">
    <image source="../../Props/tree.png" width="16" height="16"/>
  </tile>
</tileset>`;

describe('MapService export/import path security', () => {
  it('exportToFile writes under the project root', () =>
    withTempHome(async (home) => {
      const { projectId, result } = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Export Paths' });
          const mapId = yield* maps.create(projectId, { width: 2, height: 2 });
          const result = yield* maps.exportToFile(projectId, mapId, 'json', 'exports/out.json');
          return { projectId, result };
        }),
      );
      const exported = JSON.parse(await readFile(result.out, 'utf8')) as { readonly id: string };
      expect(exported.id).toBe(result.mapId);
      expect(result.out).toBe(path.join(projectDir(home, projectId), 'exports/out.json'));
    }));

  it('exportToFile rejects traversal destinations', () =>
    withTempHome(async () => {
      const error = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Export Traversal' });
          const mapId = yield* maps.create(projectId, { width: 2, height: 2 });
          return yield* maps.exportToFile(projectId, mapId, 'json', '../../etc/passwd');
        }),
      ).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: 'MapSaveError',
        message: expect.stringContaining('Path traversal is not allowed'),
      });
    }));

  it('importFromTiledFile reads a TMX fixture from the project root', () =>
    withTempHome(async (home) => {
      const fixture = path.resolve(
        import.meta.dirname,
        '../../../../test-fixtures/fixtures/maps/tiled-ground/ground.tmx',
      );
      const mapId = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import TMX Paths' });
          const relativeFixture = 'imports/ground.tmx';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), 'imports'), { recursive: true });
            await writeFile(
              path.join(projectDir(home, projectId), relativeFixture),
              await readFile(fixture, 'utf8'),
            );
            await writeFile(path.join(projectDir(home, projectId), 'imports/ground.png'), png);
          });
          const imported = yield* maps.importFromTiledFile(projectId, relativeFixture);
          if (imported.kind !== 'map') {
            throw new Error(`expected map import, got ${imported.kind}`);
          }
          return imported.mapId;
        }),
      );
      expect(mapId).toMatch(/^map:/);
    }));

  it('importFromTiledFile imports zlib-compressed base64 tile-layer data', () =>
    withTempHome(async (home) => {
      const payload = deflateSync(Buffer.from(tileLayerBase64([1, 2, 3, 4]), 'base64')).toString(
        'base64',
      );
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import Compressed TMX' });
          const relativeFixture = 'imports/compressed-ground.tmx';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), 'imports'), { recursive: true });
            await writeFile(
              path.join(projectDir(home, projectId), relativeFixture),
              compressedGroundTmx(payload),
            );
            await writeFile(path.join(projectDir(home, projectId), 'imports/ground.png'), png);
          });
          return yield* maps.importFromTiledFile(projectId, relativeFixture);
        }),
      );

      expect(result).toMatchObject({ kind: 'map', mapId: expect.stringMatching(/^map:/) });
      expect(result.report.diagnostics).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ _tag: 'TiledUnsupportedCompression' })]),
      );
    }));

  it('importFromTiledFile reads a TMJ fixture from the project root', () =>
    withTempHome(async (home) => {
      const fixture = path.resolve(
        import.meta.dirname,
        '../../../../test-fixtures/fixtures/maps/tiled-image-collection/standard.tmj',
      );
      const fixtureDir = path.dirname(fixture);
      const mapId = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import Paths' });
          const relativeFixture = 'imports/tiled-ground.tmj';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), 'imports'), { recursive: true });
            await writeFile(
              path.join(projectDir(home, projectId), relativeFixture),
              await readFile(fixture, 'utf8'),
            );
            await writeFile(
              path.join(projectDir(home, projectId), 'imports/terrain.png'),
              await readFile(path.join(fixtureDir, 'terrain.png')),
            );
            await writeFile(
              path.join(projectDir(home, projectId), 'imports/tree.png'),
              await readFile(path.join(fixtureDir, 'tree.png')),
            );
          });
          const imported = yield* maps.importFromTiledFile(projectId, relativeFixture);
          if (imported.kind !== 'map') {
            throw new Error(`expected map import, got ${imported.kind}`);
          }
          return imported.mapId;
        }),
      );
      expect(mapId).toMatch(/^map:/);
    }));

  it('importFromTiledFile persists an ImportRecord with source identity and applied plan', () =>
    withTempHome(async (home) => {
      const fixture = path.resolve(
        import.meta.dirname,
        '../../../../test-fixtures/fixtures/maps/tiled-image-collection/standard.tmj',
      );
      const fixtureDir = path.dirname(fixture);
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import Record' });
          const relativeFixture = 'imports/tiled-ground.tmj';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), 'imports'), { recursive: true });
            await writeFile(
              path.join(projectDir(home, projectId), relativeFixture),
              await readFile(fixture, 'utf8'),
            );
            await writeFile(
              path.join(projectDir(home, projectId), 'imports/terrain.png'),
              await readFile(path.join(fixtureDir, 'terrain.png')),
            );
            await writeFile(
              path.join(projectDir(home, projectId), 'imports/tree.png'),
              await readFile(path.join(fixtureDir, 'tree.png')),
            );
          });
          const imported = yield* maps.importFromTiledFile(projectId, relativeFixture);
          return { projectId, imported };
        }),
      );
      const recordsPath = path.join(
        projectDir(home, result.projectId),
        '.tileborne/import-records.json',
      );
      const store = JSON.parse(await readFile(recordsPath, 'utf8')) as {
        readonly records: readonly {
          readonly id: string;
          readonly sourceIdentity: { readonly kind: string; readonly path: string };
          readonly appliedPlan: {
            readonly selectedMapPath: string;
            readonly importRecommendation: {
              readonly primaryAction: string;
              readonly browseTarget: string;
            };
          };
          readonly report: { readonly outputs: { readonly kind: string; readonly mapId?: string } };
        }[];
      };

      expect(store.records).toHaveLength(1);
      expect(store.records[0]).toMatchObject({
        id: result.imported.report.importRecordId,
        sourceIdentity: { kind: 'tiled-map' },
        appliedPlan: {
          selectedMapPath: expect.stringContaining('tiled-ground.tmj'),
          importRecommendation: {
            primaryAction: 'import-mixed-assets',
            browseTarget: 'tilesets',
          },
        },
        report: { outputs: { kind: 'map' } },
      });
      expect(store.records[0]?.sourceIdentity.path).toBe(
        path.join(projectDir(home, result.projectId), 'imports/tiled-ground.tmj'),
      );

      const validDocument = JSON.parse(await readFile(recordsPath, 'utf8')) as {
        readonly records: readonly ImportRecord[];
      };
      const record = validDocument.records[0];
      if (record === undefined) {
        throw new Error('expected persisted import record');
      }
      const sourceInventory = {
        summary: {
          tilesetCount: 1,
          tileCount: 2,
          frameCount: 2,
          imageCollectionTileCount: 0,
          wangSetCount: 1,
          animationCount: 1,
          animationFrameCount: 2,
          tileProbabilityCount: 1,
          wangColorProbabilityCount: 1,
          collisionObjectCount: 1,
          ruleMapCount: 1,
          rulesIndexCount: 1,
          exampleMapCount: 1,
        },
        tilesets: [
          {
            name: 'terrain',
            path: 'imports/terrain.tsx',
            kind: 'grid',
            tileCount: 2,
            frameCount: 2,
            imageCollectionTileCount: 0,
            wangSetCount: 1,
            animationCount: 1,
            animationFrameCount: 2,
            tileProbabilityCount: 1,
            wangColorProbabilityCount: 1,
            collisionObjectCount: 1,
          },
        ],
        frames: [
          {
            tilesetName: 'terrain',
            tilesetPath: 'imports/terrain.tsx',
            localTileId: 0,
            image: 'terrain.png',
            probability: 0.75,
            animationFrameCount: 2,
            collisionObjectCount: 1,
            wangSetNames: ['ground'],
          },
        ],
        rules: [
          { path: 'rules/index.json', kind: 'rules-index' },
          { path: 'rules/ground.json', kind: 'rule-map' },
        ],
        exampleMaps: [
          { path: 'examples/ground.tmj', width: 2, height: 2, tileWidth: 16, tileHeight: 16 },
        ],
      } as const;
      const diagnostic = {
        _tag: 'MissingAtlas',
        severity: 'error',
        path: 'imports/terrain.tsx',
        message: 'atlas missing',
        atlasAssetId: 'asset:terrain',
      } as const;
      const appliedPlan = {
        ...record.appliedPlan,
        scan: { ...record.appliedPlan.scan, sourceInventory },
        diagnostics: [diagnostic],
      };
      const recordWithCompletePlan: ImportRecord = {
        ...record,
        appliedPlan,
        report: {
          ...record.report,
          diagnostics: [diagnostic],
          appliedPlan,
        },
      };
      await writeFile(
        recordsPath,
        JSON.stringify({ schemaVersion: 1, records: [recordWithCompletePlan] }),
      );
      await Effect.runPromise(
        appendProjectImportRecord(projectDir(home, result.projectId), recordWithCompletePlan),
      );
      const roundTripped = JSON.parse(await readFile(recordsPath, 'utf8')) as {
        readonly records: readonly ImportRecord[];
      };
      expect(roundTripped.records[0]?.appliedPlan.scan.sourceInventory).toEqual(sourceInventory);
      expect(roundTripped.records[0]?.appliedPlan.diagnostics).toEqual([diagnostic]);
      expect(roundTripped.records[0]?.report.diagnostics).toEqual([diagnostic]);

      for (const raw of [
        '{"schemaVersion":0,"records":[]}',
        '{"schemaVersion":2,"records":[],"future":"preserve"}',
        '{"schemaVersion":1,"records":[{"id":"import:00000000-0000-4000-8000-000000000000","projectId":"invalid-project","createdAt":"2026-07-16T00:00:00.000Z","sourceIdentity":{},"appliedPlan":{},"report":{}}],"sentinel":"preserve-corrupt-v1"}',
        '{not-json',
      ]) {
        await writeFile(recordsPath, raw);
        const attempted = await Effect.runPromiseExit(
          appendProjectImportRecord(projectDir(home, result.projectId), record),
        );
        expect(attempted._tag).toBe('Failure');
        expect(await readFile(recordsPath, 'utf8')).toBe(raw);
      }
    }));

  it('planTiledImport defaults to the SDK recommended profile and carries source roles', () =>
    withTempHome(async (home) => {
      const hintedAtlasTmj = JSON.stringify({
        type: 'map',
        version: '1.10',
        orientation: 'orthogonal',
        width: 1,
        height: 1,
        tilewidth: 16,
        tileheight: 16,
        tilesets: [
          {
            firstgid: 1,
            name: 'props',
            tilewidth: 16,
            tileheight: 16,
            tilecount: 1,
            columns: 1,
            image: 'props.png',
            imagewidth: 16,
            imageheight: 16,
            tiles: [
              {
                id: 0,
                properties: [{ name: 'tileborne.placeable', type: 'bool', value: true }],
              },
            ],
          },
        ],
        layers: [
          {
            type: 'objectgroup',
            name: 'objects',
            objects: [{ id: 1, gid: 1, x: 0, y: 16, width: 16, height: 16 }],
          },
        ],
      });
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Recommended Profile' });
          const relativeFixture = 'imports/hinted.tmj';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), 'imports'), { recursive: true });
            await writeFile(
              path.join(projectDir(home, projectId), relativeFixture),
              hintedAtlasTmj,
            );
            await writeFile(path.join(projectDir(home, projectId), 'imports/props.png'), png);
          });
          return yield* maps.planTiledImport(projectId, relativeFixture);
        }),
      );

      expect(result.plan.profile).toBe('standard-plus-hints');
      expect(result.plan.importRecommendation).toBe(result.plan.scan.importRecommendation);
      expect(result.plan.importRecommendation.sourceRoles).toEqual(result.plan.scan.sourceRoles);
      expect(result.plan.importRecommendation.sourceRoles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'placeable-object',
            evidence: 'tileborne-placeable-hint',
          }),
        ]),
      );
    }));

  it('importFromTiledFile uses the SDK importer for image-collection object placements', () =>
    withTempHome(async (home) => {
      const fixtureDir = path.resolve(
        import.meta.dirname,
        '../../../../test-fixtures/fixtures/maps/tiled-image-collection',
      );
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const palettes = yield* WorkingPaletteService;
          const projectId = yield* projects.create({ name: 'Import SDK Tiled' });
          const relativeDir = 'imports/tiled-image-collection';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), relativeDir), { recursive: true });
            for (const file of ['standard.tmj', 'terrain.png', 'tree.png']) {
              await writeFile(
                path.join(projectDir(home, projectId), relativeDir, file),
                await readFile(path.join(fixtureDir, file)),
              );
            }
          });
          const imported = yield* maps.importFromTiledFile(
            projectId,
            path.join(relativeDir, 'standard.tmj'),
          );
          if (imported.kind !== 'map') {
            throw new Error(`expected map import, got ${imported.kind}`);
          }
          const workingPalettes = yield* palettes.list({ projectId });
          return { imported, workingPalettes };
        }),
      );
      expect(result.imported.objectCount).toBe(1);
      expect(result.imported.packId).toMatch(/^pack:/);
      expect(result.imported.report.appliedPlan.importRecommendation.primaryAction).toBe(
        'import-mixed-assets',
      );
      expect(result.imported.report.appliedPlan.importRecommendation.sourceRoles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'placeable-object', evidence: 'image-collection' }),
        ]),
      );
      expect(result.workingPalettes.palettes[0]?.items.at(-1)?.ref.kind).toBe('placeable');
    }));

  it('importFromTiledFile imports standalone TSX tilesets as asset packs', () =>
    withTempHome(async (home) => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const palettes = yield* WorkingPaletteService;
          const projectId = yield* projects.create({ name: 'Import Standalone TSX' });
          const relativeDir = 'imports/standalone';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), relativeDir), { recursive: true });
            await writeFile(
              path.join(projectDir(home, projectId), relativeDir, 'props.tsx'),
              standaloneTilesetTsx,
            );
            await writeFile(path.join(projectDir(home, projectId), relativeDir, 'tree.png'), png);
          });
          const imported = yield* maps.importFromTiledFile(
            projectId,
            path.join(relativeDir, 'props.tsx'),
          );
          const pack =
            imported.kind === 'asset-pack' ? yield* assets.getPack(imported.packId) : undefined;
          const workingPalettes = yield* palettes.list({ projectId });
          return { imported, pack, workingPalettes };
        }),
      );

      expect(result.imported).toMatchObject({
        kind: 'asset-pack',
        packId: expect.stringMatching(/^pack:/),
      });
      expect(result.imported.report.appliedPlan.importRecommendation.primaryAction).toBe(
        'import-placeable-objects',
      );
      expect(result.pack?.capability.placeableCount).toBe(1);
      expect(result.workingPalettes.palettes[0]?.items[0]?.ref.kind).toBe('placeable');
    }));

  it('importFromTiledFile imports external standalone TSX tilesets with sibling image roots', () =>
    withTempHome(async (home) => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Import External Standalone TSX' });
          const externalRoot = path.join(home, 'external-tiled-source');
          const sourcePath = path.join(externalRoot, 'TiledMap Editor', 'Tilesets', 'props.tsx');
          yield* Effect.promise(async () => {
            await mkdir(path.join(externalRoot, 'TiledMap Editor', 'Tilesets'), {
              recursive: true,
            });
            await mkdir(path.join(externalRoot, 'Props'), { recursive: true });
            await writeFile(sourcePath, standaloneTilesetWithSiblingImageRootTsx);
            await writeFile(path.join(externalRoot, 'Props', 'tree.png'), png);
          });
          const imported = yield* maps.importFromTiledFile(projectId, sourcePath);
          const pack =
            imported.kind === 'asset-pack' ? yield* assets.getPack(imported.packId) : undefined;
          return { imported, pack };
        }),
      );

      expect(result.imported).toMatchObject({
        kind: 'asset-pack',
        packId: expect.stringMatching(/^pack:/),
      });
      expect(result.pack?.assets.map((asset) => asset.path)).toEqual(['Props/tree.png']);
      expect(result.pack?.capability.placeableCount).toBe(1);
    }));

  it('importFromTiledFile imports raw Tiled source folders as asset packs', () =>
    withTempHome(async (home) => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Import Source Folder' });
          const relativeDir = 'imports/source-folder';
          yield* Effect.promise(async () => {
            const root = path.join(projectDir(home, projectId), relativeDir);
            await mkdir(path.join(root, 'Rules'), { recursive: true });
            await writeFile(path.join(root, 'props.tsx'), standaloneTilesetTsx);
            await writeFile(path.join(root, 'tree.png'), png);
            await writeFile(path.join(root, 'rules.txt'), 'Rules/place-props.tmx\n');
            await writeFile(
              path.join(root, 'Rules/place-props.tmx'),
              '<?xml version="1.0" encoding="UTF-8"?><map version="1.10" orientation="orthogonal" width="1" height="1" tilewidth="16" tileheight="16"><layers/></map>',
            );
          });
          const imported = yield* maps.importFromTiledFile(projectId, relativeDir);
          const pack =
            imported.kind === 'asset-pack' ? yield* assets.getPack(imported.packId) : undefined;
          return { imported, pack };
        }),
      );

      expect(result.imported).toMatchObject({
        kind: 'asset-pack',
        packId: expect.stringMatching(/^pack:/),
      });
      expect(result.pack?.capability.placeableCount).toBe(1);
    }));

  it('importFromTiledFile imports source folders whose nested tilesets reference sibling assets', () =>
    withTempHome(async (home) => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const assets = yield* AssetService;
          const projectId = yield* projects.create({ name: 'Import External Source Folder' });
          const externalRoot = path.join(home, 'external-source-folder');
          const sourceFolder = path.join(externalRoot, 'TiledMap Editor');
          yield* Effect.promise(async () => {
            await mkdir(path.join(sourceFolder, 'Tilesets'), { recursive: true });
            await mkdir(path.join(externalRoot, 'Props'), { recursive: true });
            await writeFile(
              path.join(sourceFolder, 'Tilesets', 'props.tsx'),
              standaloneTilesetWithSiblingImageRootTsx,
            );
            await writeFile(path.join(externalRoot, 'Props', 'tree.png'), png);
          });
          const imported = yield* maps.importFromTiledFile(projectId, sourceFolder);
          const pack =
            imported.kind === 'asset-pack' ? yield* assets.getPack(imported.packId) : undefined;
          return { imported, pack };
        }),
      );

      expect(result.imported).toMatchObject({
        kind: 'asset-pack',
        packId: expect.stringMatching(/^pack:/),
      });
      expect(result.pack?.assets.map((asset) => asset.path)).toEqual(['Props/tree.png']);
      expect(result.pack?.capability.placeableCount).toBe(1);
    }));

  it('importFromTiledFile rejects unsupported Tiled features under standard', () =>
    withTempHome(async (home) => {
      const raw = JSON.stringify({
        type: 'map',
        version: '1.10',
        orientation: 'orthogonal',
        infinite: true,
        width: 1,
        height: 1,
        tilewidth: 16,
        tileheight: 16,
        tilesets: [
          {
            firstgid: 1,
            name: 'terrain',
            tilewidth: 16,
            tileheight: 16,
            tilecount: 1,
            columns: 1,
            image: 'terrain.png',
            imagewidth: 16,
            imageheight: 16,
          },
        ],
        layers: [
          {
            type: 'tilelayer',
            name: 'ground',
            width: 1,
            height: 1,
            data: [1],
            chunks: [{ x: 0, y: 0, width: 1, height: 1, data: [1] }],
          },
          {
            type: 'objectgroup',
            name: 'objects',
            objects: [{ id: 1, x: 0, y: 0, template: 'tree.tx', rotation: 45 }],
          },
        ],
      });
      const error = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import Unsupported Tiled' });
          const relativeFixture = 'imports/unsupported.tmj';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), 'imports'), { recursive: true });
            await writeFile(path.join(projectDir(home, projectId), relativeFixture), raw);
          });
          return yield* maps.importFromTiledFile(projectId, relativeFixture, {
            profile: 'standard',
          });
        }),
      ).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: 'MapValidationError',
        message: expect.stringMatching(/Infinite chunk maps|templates|rotation/),
      });
    }));

  it('importFromTiledFile rejects traversal sources', () =>
    withTempHome(async () => {
      const error = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import Traversal' });
          return yield* maps.importFromTiledFile(projectId, '../../etc/passwd');
        }),
      ).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: 'MapValidationError',
        message: expect.stringContaining('Path traversal is not allowed'),
      });
    }));

  it('importFromTiledFile rejects escaping Tiled image paths before staging', () =>
    withTempHome(async (home) => {
      let createdProjectId: ProjectId | undefined;
      const error = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import Escaping Image' });
          createdProjectId = projectId;
          const relativeFixture = 'imports/escaping-image.tmx';
          yield* Effect.promise(async () => {
            await mkdir(path.join(projectDir(home, projectId), 'imports'), { recursive: true });
            await writeFile(
              path.join(projectDir(home, projectId), relativeFixture),
              escapingImageTmx,
            );
          });
          return yield* maps.importFromTiledFile(projectId, relativeFixture);
        }),
      ).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: 'MapValidationError',
        message: expect.stringMatching(
          /Tiled (image source must not escape|asset source path escapes)/,
        ),
      });

      expect(createdProjectId).toBeDefined();
      const stagingEntries =
        createdProjectId === undefined
          ? ['missing-project']
          : await readdir(
              path.join(projectDir(home, createdProjectId), '.tileborne', 'tiled-import-staging'),
            ).catch(() => []);
      expect(stagingEntries).toEqual([]);
    }));

  it('importFromTiledFile rejects symlink sources outside the project root', () =>
    withTempHome(async (home) => {
      const fixture = path.resolve(
        import.meta.dirname,
        '../../../../cli/src/__fixtures__/tiled-ground.json',
      );
      const outsideDir = path.join(home, 'outside');
      await mkdir(outsideDir, { recursive: true });
      await writeFile(path.join(outsideDir, 'tiled-ground.json'), await readFile(fixture, 'utf8'));

      const error = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Import Symlink' });
          yield* Effect.promise(async () => {
            await symlink(
              path.join(outsideDir, 'tiled-ground.json'),
              path.join(projectDir(home, projectId), 'escape-link.json'),
            );
          });
          return yield* maps.importFromTiledFile(projectId, 'escape-link.json');
        }),
      ).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: 'MapValidationError',
        message: expect.stringMatching(/Symlink escapes root|Path traversal is not allowed/),
      });
    }));

  it('exportToFile rejects symlink destinations outside the project root', () =>
    withTempHome(async (home) => {
      const outsideDir = path.join(home, 'outside');
      await mkdir(outsideDir, { recursive: true });

      const error = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: 'Export Symlink' });
          const mapId = yield* maps.create(projectId, { width: 2, height: 2 });
          yield* Effect.promise(async () => {
            await symlink(outsideDir, path.join(projectDir(home, projectId), 'escape-link'), 'dir');
          });
          return yield* maps.exportToFile(projectId, mapId, 'json', 'escape-link/out.json');
        }),
      ).catch((cause) => cause);

      expect(error).toMatchObject({
        _tag: 'MapSaveError',
        message: expect.stringMatching(/Symlink escapes root|Path traversal is not allowed/),
      });
    }));
});

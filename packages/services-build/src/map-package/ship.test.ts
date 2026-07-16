import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AssetPackManifest } from '@tileborne/asset-pipeline';
import { ProjectManifest, decodePersistedTileborneMapJson } from '@tileborne/core';
import { Effect, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PACKAGE_PLAYER_CAPACITY,
  collectRuntimeMapPackageAssets,
  loadPluginModeDataExporter,
  loadPluginPlayerModels,
  resolvePackagePlayerCapacity,
} from './ship.js';

const UUID = '12345678-1234-4234-8234-123456789abc';
const PLUGIN = '@tileborne-plugins/example-mode';

const tempDirs: string[] = [];
const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeMap = (properties: Record<string, unknown>) =>
  decodePersistedTileborneMapJson({
    id: `map:${UUID}`,
    schemaVersion: 1,
    size: { width: 4, height: 4 },
    tileSize: { width: 32, height: 32 },
    layers: [],
    objects: [],
    properties,
  });

describe('resolvePackagePlayerCapacity', () => {
  it("reads the active plugin's namespaced maxPlayers", () => {
    const map = makeMap({ [PLUGIN]: { maxPlayers: 12 } });
    expect(resolvePackagePlayerCapacity(map, PLUGIN)).toBe(12);
  });

  it('falls back to the neutral default for absent or invalid values', () => {
    expect(resolvePackagePlayerCapacity(makeMap({}), PLUGIN)).toBe(DEFAULT_PACKAGE_PLAYER_CAPACITY);
    expect(resolvePackagePlayerCapacity(makeMap({ [PLUGIN]: { maxPlayers: -3 } }), PLUGIN)).toBe(
      DEFAULT_PACKAGE_PLAYER_CAPACITY,
    );
  });
});

describe('collectRuntimeMapPackageAssets (M2 nit N1 producer)', () => {
  it('packages the pack manifest and every listed payload with assetIds', async () => {
    const root = await makeTempDir('tileborne-ship-pack-');
    const assetId = `asset:${UUID}`;
    const manifest = Schema.decodeUnknownSync(AssetPackManifest)({
      id: 'pack:550e8400-e29b-41d4-a716-446655440042',
      name: 'Ship Pack',
      version: '1.0.0',
      license: { spdxId: 'CC0-1.0' },
      assets: [
        {
          id: assetId,
          path: 'atlas/tiles.png',
          mime: 'image/png',
          size: 3,
          hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          license: undefined,
        },
      ],
    });
    await writeFile(
      path.join(root, 'tileborne-asset-pack.json'),
      `${JSON.stringify(Schema.encodeSync(AssetPackManifest)(manifest), null, 2)}\n`,
    );
    await mkdir(path.join(root, 'atlas'), { recursive: true });
    await writeFile(path.join(root, 'atlas/tiles.png'), new Uint8Array([1, 2, 3]));

    const inputs = await Effect.runPromise(collectRuntimeMapPackageAssets([{ manifest, root }]));

    const packDir = `assets/packs/${manifest.id}-1.0.0`;
    expect(inputs.map((input) => input.path)).toEqual([
      `${packDir}/tileborne-asset-pack.json`,
      `${packDir}/atlas/tiles.png`,
    ]);
    expect(inputs[0]?.assetId).toBeUndefined();
    expect(inputs[1]?.assetId).toBe(assetId);
    expect([...(inputs[1]?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it('fails with the missing payload path when a listed asset is absent', async () => {
    const root = await makeTempDir('tileborne-ship-pack-missing-');
    const manifest = Schema.decodeUnknownSync(AssetPackManifest)({
      id: 'pack:550e8400-e29b-41d4-a716-446655440043',
      name: 'Broken Pack',
      version: '1.0.0',
      license: { spdxId: 'CC0-1.0' },
      assets: [
        {
          id: `asset:${UUID}`,
          path: 'missing.png',
          mime: 'image/png',
          size: 1,
          hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          license: undefined,
        },
      ],
    });
    await writeFile(
      path.join(root, 'tileborne-asset-pack.json'),
      `${JSON.stringify(Schema.encodeSync(AssetPackManifest)(manifest), null, 2)}\n`,
    );

    const result = await Effect.runPromise(
      Effect.result(collectRuntimeMapPackageAssets([{ manifest, root }])),
    );
    expect(Result.isFailure(result)).toBe(true);
  });
});

const fixtureProject = Schema.decodeUnknownSync(ProjectManifest)({
  id: `project:${UUID}`,
  name: 'Ship Fixture',
  schemaVersion: 1,
  engineVersion: '0.1.0',
  plugins: [],
  assetPacks: [],
  maps: [],
});

const writePluginFixture = async (serverBody: string | undefined): Promise<string> => {
  const root = await makeTempDir('tileborne-ship-plugin-');
  const manifest = {
    schemaVersion: 1,
    id: PLUGIN,
    name: PLUGIN,
    version: '0.0.1',
    entry: serverBody === undefined ? {} : { server: './server.mjs' },
  };
  await writeFile(path.join(root, 'tileborne-plugin.json'), `${JSON.stringify(manifest)}\n`);
  if (serverBody !== undefined) {
    await writeFile(path.join(root, 'server.mjs'), serverBody);
  }
  return root;
};

describe('plugin node-entry discovery (generic exports)', () => {
  it('discovers exportModeData on the node entry', async () => {
    const root = await writePluginFixture(
      "export const exportModeData = () => ({ _tag: 'Success', success: { fixture: true } });\n",
    );
    const exporter = await Effect.runPromise(loadPluginModeDataExporter(root));
    expect(typeof exporter).toBe('function');
  });

  it('loads and executes the bundled Example Arena Ship exporter', async () => {
    const packageRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../plugin-example-arena',
    );
    const exporter = await Effect.runPromise(loadPluginModeDataExporter(packageRoot));
    expect(typeof exporter).toBe('function');
    const result = exporter?.({
      map: makeMap({ '@tileborne-plugins/example-arena': { arenaRadius: 48, enemyCount: 10 } }),
      catalog: [],
      placements: [],
      settings: { arenaRadius: 48, enemyCount: 10 },
    });
    expect(result && Result.isSuccess(result)).toBe(true);
    if (result !== undefined && Result.isSuccess(result)) {
      expect(result.success).toEqual({ schemaVersion: 1, arenaRadius: 48, enemyCount: 10 });
    }
  });

  it('returns undefined when the plugin has no node entry', async () => {
    const root = await writePluginFixture(undefined);
    const exporter = await Effect.runPromise(loadPluginModeDataExporter(root));
    expect(exporter).toBeUndefined();
  });

  it('returns an empty roster when the plugin exports no resolvePlayerModels', async () => {
    const root = await writePluginFixture('export const exportModeData = () => ({});\n');
    const models = await Effect.runPromise(loadPluginPlayerModels(root, fixtureProject));
    expect(models).toEqual([]);
  });

  it('fails with a structured error when the roster wire is invalid', async () => {
    const root = await writePluginFixture(
      "export const resolvePlayerModels = () => [{ not: 'a model' }];\n",
    );
    const result = await Effect.runPromise(
      Effect.result(loadPluginPlayerModels(root, fixtureProject)),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain('player-model roster is invalid');
    }
  });
});

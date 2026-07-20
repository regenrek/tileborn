import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashBytes, type ContentHash } from '@tileborne/core';

import { buildBundledManifest, hashManifestPayload } from './build/manifest.js';
import type { BundledManifest } from './types.js';

describe('build-manifest', () => {
  it('hashes manifest payload deterministically', () => {
    const payload = {
      schemaVersion: 1 as const,
      plugin: {
        id: '@tileborne-plugins/fixture',
        version: '1.0.0',
        files: [{ path: 'plugin/runtime.js', hash: 'sha256:abc' as ContentHash, size: 12 }],
      },
      assetPacks: [],
      maps: [],
      runtimeVersion: '0.0.0',
      protocolVersion: 1,
      workerFiles: [{ path: 'worker.js', hash: 'sha256:def' as ContentHash, size: 99 }],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const left = hashManifestPayload(payload);
    const right = hashManifestPayload(payload);
    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('buildId changes when worker file hash changes', () => {
    const base = buildBundledManifest({
      plugin: { id: 'p', version: '1', files: [] },
      assetPacks: [],
      maps: [],
      runtimeVersion: '0.0.0',
      workerFiles: [
        {
          path: 'worker.js',
          hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' as ContentHash,
          size: 1,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const changed = buildBundledManifest({
      plugin: { id: 'p', version: '1', files: [] },
      assetPacks: [],
      maps: [],
      runtimeVersion: '0.0.0',
      workerFiles: [
        {
          path: 'worker.js',
          hash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222' as ContentHash,
          size: 1,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(base.buildId).not.toBe(changed.buildId);
  });

  it('filters SDK tileset manifests to only referenced tile renderables', async () => {
    const { buildReferencedTilesetManifest } =
      await import('../scripts/generate-bundled-modules.mjs');
    const manifest = {
      schemaVersion: 1,
      id: 'pack:test',
      name: 'Tiny',
      version: '1.0.0',
      license: { spdxId: 'CC0-1.0' },
      assets: [{ id: 'asset:atlas', path: 'atlas.png', mime: 'image/png' }],
      terrainClasses: [],
      tilesets: [
        {
          id: 'tileset:main',
          name: 'Main',
          atlasAssetId: 'asset:atlas',
          cellSize: { width: 32, height: 32 },
          margin: 0,
          spacing: 0,
        },
      ],
      tiles: Array.from({ length: 8 }, (_, index) => ({
        id: `tile:${index + 1}`,
        tilesetId: 'tileset:main',
        uv: { x: index * 32, y: 0, w: 32, h: 32 },
        tags: [],
      })),
      animations: [],
      collisionMasks: [
        { tileId: 'tile:2', mask: { _tag: 'bitmask', passable: 0, blocked: 15 } },
        { tileId: 'tile:7', mask: { _tag: 'bitmask', passable: 0, blocked: 15 } },
      ],
      autotileRules: [],
      variantFilters: [],
      terrainTransitions: [],
    };

    const subset = buildReferencedTilesetManifest(manifest, ['tile:2', 'tile:4', 'tile:6']);

    expect(subset.tiles.map((tile: { id: string }) => tile.id)).toEqual([
      'tile:2',
      'tile:4',
      'tile:6',
    ]);
    expect(subset.collisionMasks).toEqual([
      { tileId: 'tile:2', mask: { _tag: 'bitmask', passable: 0, blocked: 15 } },
    ]);
    expect(subset.assets).toEqual([{ id: 'asset:atlas', path: 'atlas.png', mime: 'image/png' }]);
  });
});

describe('buildCloudflareGameHost fixture bundle', () => {
  it('resolves build assets from an Electron Vite working directory without import.meta ownership', async () => {
    const { resolveGameHostBuildAssets } = await import('./build/cloudflare.js');
    const assets = resolveGameHostBuildAssets(path.join(process.cwd(), 'apps/desktop/.vite/build'));
    expect(assets.workerEntry).toMatch(
      /apps\/game-host\/(?:dist\/build-assets\/worker-entry\.js|dist\/worker-entry\.js|src\/worker\.ts)$/,
    );
    expect(assets.behaviorWorkerEntry).toMatch(
      /apps\/game-host\/(?:dist\/build-assets\/behavior\/workerd\/service-worker\.js|dist\/behavior\/workerd\/service-worker\.js|src\/behavior\/workerd\/service-worker\.ts)$/,
    );
    expect(assets.wranglerTemplatePath).toMatch(
      /apps\/game-host\/(?:dist\/build-assets\/)?wrangler\.template\.toml$/,
    );
  });

  it('canonicalizes display names into injection-safe Cloudflare slugs', async () => {
    const { canonicalCloudflareSiteSlug } = await import('./build/cloudflare.js');
    expect(canonicalCloudflareSiteSlug('My Battle Royale!')).toBe('my-battle-royale');
    expect(canonicalCloudflareSiteSlug('evil"\n[vars]\nTOKEN="owned')).toBe(
      'evil-vars-token-owned',
    );
    expect(canonicalCloudflareSiteSlug('🔥🔥')).toBe('tileborne-game-host');
    expect(canonicalCloudflareSiteSlug('x'.repeat(100))).toMatch(/^x{54}-[0-9a-f]{8}$/);
  });

  it('removes its unique incomplete output when cancellation is already requested', async () => {
    const { buildCloudflareGameHost } = await import('./build/cloudflare.js');
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'tileborne-gh-cancel-'));
    const pluginRoot = path.join(tempRoot, 'plugin-src');
    const outDir = path.join(tempRoot, 'unique-building-output');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await writeFile(path.join(pluginRoot, 'dist/runtime.js'), 'export default {};\n', 'utf8');
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'partial.tmp'), 'incomplete', 'utf8');
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildCloudflareGameHost({
        outDir,
        pluginId: '@tileborne-plugins/fixture',
        pluginVersion: '0.1.0',
        pluginRoot,
        assetPacks: [],
        mapPackages: [],
        runtimeVersion: '0.0.0',
        siteName: 'cancelled-host',
        createdAt: '2026-01-01T00:00:00.000Z',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(stat(outDir)).rejects.toThrow();
    await expect(stat(path.join(outDir, 'manifest.json'))).rejects.toThrow();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('produces manifest.json and worker.js for a fixture plugin', async () => {
    const { buildCloudflareGameHost } = await import('./build/cloudflare.js');
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'tileborne-gh-build-'));
    const pluginRoot = path.join(tempRoot, 'plugin-src');
    await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
    await writeFile(
      path.join(pluginRoot, 'dist/runtime.js'),
      "export default { id: 'fixture' };\n",
      'utf8',
    );

    const mapId = 'map:00000000-0000-4000-8000-000000000001';
    const packageId = 'mappkg:00000000-0000-4000-8000-000000000002';
    const behaviorCode = `export default {id:'test.ship-runtime',sourceKind:'typescript',state:{ticks:0},on:{'runtime.tick':({state,event})=>state.set('ticks',event.tick)}};`;
    const mapPackageWire = {
      manifest: { packageId, mapId },
      behaviors: {
        modules: [
          {
            behaviorId: 'behavior:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            sourceKind: 'typescript',
            modulePath: 'behaviors/modules/ship-runtime.mjs',
            hash: hashBytes(new TextEncoder().encode(behaviorCode)),
          },
        ],
      },
    };
    const mapPackageDir = path.join(tempRoot, 'map-package');
    await mkdir(path.join(mapPackageDir, 'behaviors', 'modules'), { recursive: true });
    await writeFile(
      path.join(mapPackageDir, 'behaviors', 'modules', 'ship-runtime.mjs'),
      behaviorCode,
      'utf8',
    );
    await writeFile(
      path.join(mapPackageDir, 'package.json'),
      `${JSON.stringify(mapPackageWire, null, 2)}\n`,
      'utf8',
    );

    const outDir = path.join(tempRoot, 'out');
    const result = await buildCloudflareGameHost({
      outDir,
      pluginId: '@tileborne-plugins/fixture',
      pluginVersion: '0.1.0',
      pluginRoot,
      assetPacks: [],
      mapPackages: [
        {
          mapId,
          packageId,
          sourceDir: mapPackageDir,
          mapPackage: mapPackageWire,
        },
      ],
      runtimeVersion: '0.0.0',
      siteName: 'fixture-host',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.files).toContain('worker.js');
    expect(result.files).toContain('behavior-worker.js');
    expect(result.files).toContain('manifest.json');
    expect(result.files).toContain('deployment.json');
    expect(result.files).toContain('wrangler.toml');
    expect(result.files).toContain('wrangler.behavior.toml');
    const mapFilePath = 'maps/map-00000000-0000-4000-8000-000000000001/package.json';
    expect(result.files).toContain(mapFilePath);
    const manifest = JSON.parse(
      await readFile(path.join(outDir, 'manifest.json'), 'utf8'),
    ) as BundledManifest;
    expect(manifest.buildId).toBe(result.manifestHash);
    expect(manifest.plugin.id).toBe('@tileborne-plugins/fixture');
    expect(manifest.maps).toHaveLength(1);
    expect(manifest.maps[0]).toMatchObject({ mapId, packageId });
    expect(manifest.maps[0]!.files.map((entry) => entry.path)).toContain(mapFilePath);
    for (const entry of manifest.maps[0]!.files) {
      expect(entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.size).toBeGreaterThan(0);
    }
    const copied = JSON.parse(await readFile(path.join(outDir, mapFilePath), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(copied).toEqual(mapPackageWire);
    const deployment = JSON.parse(await readFile(path.join(outDir, 'deployment.json'), 'utf8')) as {
      readonly schemaVersion: number;
      readonly defaultAdapter: string;
      readonly artifact: { readonly runtimeBuildId: string };
      readonly adapters: readonly {
        readonly id: string;
        readonly provider: string;
        readonly operations: readonly string[];
        readonly credentialRequirements: readonly { readonly name: string }[];
        readonly ownsConfigFiles: readonly string[];
      }[];
    };
    expect(deployment).toMatchObject({
      schemaVersion: 1,
      defaultAdapter: 'local',
      artifact: { runtimeBuildId: result.manifestHash },
    });
    expect(deployment.adapters.find((adapter) => adapter.id === 'local')).toMatchObject({
      provider: 'local',
      credentialRequirements: [],
    });
    expect(
      deployment.adapters.find((adapter) => adapter.id === 'alchemy-cloudflare'),
    ).toMatchObject({
      provider: 'cloudflare',
      operations: ['plan', 'preview', 'deploy', 'status', 'logs', 'destroy'],
      ownsConfigFiles: ['wrangler.toml', 'wrangler.behavior.toml'],
    });
    const deploymentJson = await readFile(path.join(outDir, 'deployment.json'), 'utf8');
    expect(deploymentJson).not.toMatch(/acct-secret|token-secret|secret-value|wrangler deploy/i);
    // The worker bundle bakes in the bundled map package for packageless
    // /rooms/create resolution (M5 S1).
    const workerSource = await readFile(result.bundlePath, 'utf8');
    const behaviorWorkerSource = await readFile(path.join(outDir, 'behavior-worker.js'), 'utf8');
    expect(workerSource).toContain('export');
    expect(workerSource).toContain(packageId);
    expect(workerSource).not.toContain('test.ship-runtime');
    expect(workerSource).not.toContain('AuthoritativeBehaviorRuntimeHost');
    expect(behaviorWorkerSource).toContain('test.ship-runtime');
    expect(behaviorWorkerSource).toContain('AuthoritativeBehaviorRuntimeHost');
    expect(behaviorWorkerSource).toContain('createNamespace');
    expect(behaviorWorkerSource).not.toContain(`from "${path.join(mapPackageDir, 'behaviors')}`);
    // The generated wrangler.toml never ships a live signing key — only the
    // `wrangler secret put` instruction (the worker rejects the placeholder).
    const wranglerToml = await readFile(path.join(outDir, 'wrangler.toml'), 'utf8');
    expect(wranglerToml).not.toContain('replace-me-in-production');
    expect(wranglerToml).not.toMatch(/^HANDOFF_SIGNING_KEY\s*=/m);
    expect(wranglerToml).toContain('wrangler secret put HANDOFF_SIGNING_KEY');
    expect(wranglerToml).toContain('binding = "BEHAVIOR_RUNTIME"');
    expect(wranglerToml).toContain('service = "fixture-host-behaviors"');
    const behaviorWranglerToml = await readFile(
      path.join(outDir, 'wrangler.behavior.toml'),
      'utf8',
    );
    expect(behaviorWranglerToml).toContain('main = "behavior-worker.js"');
    expect(behaviorWranglerToml).toContain('cpu_ms = 50');
    // Build-time staging never ships inside the artifact.
    await expect(stat(path.join(outDir, '.staging'))).rejects.toThrow();

    const repeatOut = path.join(tempRoot, 'repeat-out');
    const repeat = await buildCloudflareGameHost({
      outDir: repeatOut,
      pluginId: '@tileborne-plugins/fixture',
      pluginVersion: '0.1.0',
      pluginRoot,
      assetPacks: [],
      mapPackages: [{ mapId, packageId, sourceDir: mapPackageDir, mapPackage: mapPackageWire }],
      runtimeVersion: '0.0.0',
      siteName: 'fixture-host',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(repeat.manifestHash).toBe(result.manifestHash);
    expect(repeat.fileHashes).toEqual(result.fileHashes);
    for (const relativePath of result.files) {
      expect(await readFile(path.join(repeatOut, relativePath))).toEqual(
        await readFile(path.join(outDir, relativePath)),
      );
    }
    await rm(tempRoot, { recursive: true, force: true });
  }, 120_000);
});

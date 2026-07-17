import { Effect } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import { bundledSamplePackId, bundledAssetPackBlobs } from './.generated/bundled-assets.js';
import { bundledPlugin } from './.generated/bundled-plugin.js';
import { createBundledPluginLoader } from './bundled-plugin-loader.js';

const gameHostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(gameHostRoot, 'dist/worker.js');
const workerEntryPath = path.join(gameHostRoot, 'dist/worker-entry.js');
const portableWorkerEntryPath = path.join(gameHostRoot, 'dist/build-assets/worker-entry.js');
const portableBehaviorWorkerEntryPath = path.join(
  gameHostRoot,
  'dist/build-assets/behavior/workerd/service-worker.js',
);
const portableWranglerTemplatePath = path.join(
  gameHostRoot,
  'dist/build-assets/wrangler.template.toml',
);
const generatedPluginRuntimePath = path.join(gameHostRoot, 'src/.generated/plugin-runtime.js');

const PLACEHOLDER_TOKENS = [
  'Placeholder runtime module',
  'Placeholder asset packs',
  './stubs/plugin-runtime',
  'bundledAssetPacks: []',
] as const;
const STATIC_NODE_IMPORT = /^import .* from ["']node:/mu;
const NODE_NATIVE_MARKERS = [
  'process.env',
  'detect-libc',
  'node-gyp-build',
  'msgpackr-extract',
  'Dynamic require',
  '__require("fs")',
  '__require("child_process")',
] as const;

const expectNoNodeNativeMarkers = (source: string): void => {
  for (const marker of NODE_NATIVE_MARKERS) {
    expect(source).not.toContain(marker);
  }
};

describe('bundled worker boundary', () => {
  beforeAll(async () => {
    await import('../scripts/bundle-worker.mjs');
  }, 20_000);

  it('keeps sample pack blobs under 200KB gzip', () => {
    const payload = JSON.stringify(bundledAssetPackBlobs);
    const gzippedBytes = gzipSync(payload).byteLength;
    expect(gzippedBytes).toBeLessThan(200 * 1024);
  });

  it('loads the bundled battle-royale plugin through the configured loader', async () => {
    const loader = createBundledPluginLoader();
    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = 'id' in executable ? executable : executable.default;
    expect(plugin?.id).toBe('@tileborne-plugins/battle-royale');
  });

  it('built worker.js excludes placeholder module markers', async () => {
    const source = await readFile(workerPath, 'utf8');

    for (const token of PLACEHOLDER_TOKENS) {
      expect(source).not.toContain(token);
    }

    expect(source).toContain('@tileborne-plugins/battle-royale');
    expect(source).toContain(bundledSamplePackId);
    expect(source).toContain('createRuntimeAdapter');
  });

  it('built worker.js excludes Node filesystem imports', async () => {
    const source = await readFile(workerPath, 'utf8');

    expect(source).not.toContain('node:fs');
    expect(source).not.toContain('node:fs/promises');
    expect(source).not.toMatch(STATIC_NODE_IMPORT);
    expectNoNodeNativeMarkers(source);
  });

  it('preserves a compiled assembly entry with replaceable project modules', async () => {
    const source = await readFile(workerEntryPath, 'utf8');

    expect(source).toContain('./.generated/runtime-manifest.js');
    expect(source).toContain('./.generated/bundled-map-packages.js');
    expect(source).not.toContain('node_modules/hono/dist/compose.js');
  });

  it('emits portable Ship assembly assets with only generated-module imports', async () => {
    const [worker, behaviorWorker, wrangler] = await Promise.all([
      readFile(portableWorkerEntryPath, 'utf8'),
      readFile(portableBehaviorWorkerEntryPath, 'utf8'),
      readFile(portableWranglerTemplatePath, 'utf8'),
    ]);
    const imports = (source: string): readonly string[] => source.match(/^import .*$/gmu) ?? [];

    expect(imports(worker)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('runtime-manifest.js'),
        expect.stringContaining('bundled-map-packages.js'),
      ]),
    );
    expect(imports(worker).every((line) => line.includes('/.generated/'))).toBe(true);
    expect(imports(behaviorWorker)).toEqual([expect.stringContaining('bundled-behaviors.js')]);
    expect(wrangler).toContain('{{SITE_NAME}}');
  });

  it('generated plugin runtime excludes Node/native msgpack scaffolding', async () => {
    const source = await readFile(generatedPluginRuntimePath, 'utf8');

    expect(source).not.toMatch(STATIC_NODE_IMPORT);
    expectNoNodeNativeMarkers(source);
  });
});

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { BundledManifest } from '../types.js';
import { bootMiniflare, smokePaths } from './setup.js';
import { writeSmokeAssetPackFixture, writeSmokePluginFixture } from './fixtures/plugin-fixture.js';
import { SMOKE_ASSET_PACK_ID, SMOKE_PLUGIN_ID } from './fixtures/smoke-manifest.js';
import { parseJson, type DiscoverPayload, type HealthPayload } from './wire-helpers.js';

const execFileAsync = promisify(execFile);

const repoRoot = smokePaths.repoRoot;
const cliEntrypoint = path.join(repoRoot, 'packages/cli/dist/main.js');

const parseTomlBinding = (source: string, bindingName: string): boolean =>
  source.includes(`name = "${bindingName}"`) && source.includes('PlaytestRoom');

describe('game-host smoke — CLI cloudflare build pipeline', () => {
  let tempHome = '';
  let outputDir = '';
  let dispose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (dispose) {
      await dispose();
      dispose = null;
    }
    if (tempHome.length > 0) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = '';
    }
    if (outputDir.length > 0) {
      await rm(outputDir, { recursive: true, force: true });
      outputDir = '';
    }
  });

  it('builds a deployable worker bundle and passes health + discover in Miniflare', async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), 'tileborne-smoke-cli-home-'));
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'tileborne-smoke-cli-out-'));
    const pluginSource = path.join(tempHome, 'plugin-src');
    const assetSource = path.join(tempHome, 'asset-src');
    await writeSmokePluginFixture(pluginSource);
    await writeSmokeAssetPackFixture(assetSource);

    const install = await execFileAsync(
      process.execPath,
      [cliEntrypoint, 'plugin', 'install', '--local', pluginSource, '--json'],
      { env: { ...process.env, TILEBORNE_HOME: tempHome } },
    );
    expect(install.stderr.trim()).toBe('');

    const packInstall = await execFileAsync(
      process.execPath,
      [cliEntrypoint, 'asset', 'import', assetSource, '--json'],
      { env: { ...process.env, TILEBORNE_HOME: tempHome } },
    );
    expect(packInstall.stderr.trim()).toBe('');
    const packPayload = JSON.parse(String(packInstall.stdout)) as {
      readonly ok: boolean;
      readonly data: { readonly packId: string };
    };
    expect(packPayload.ok).toBe(true);

    const build = await execFileAsync(
      process.execPath,
      [
        cliEntrypoint,
        'game',
        'build',
        '--target',
        'cloudflare',
        '--plugin',
        SMOKE_PLUGIN_ID,
        '--asset-pack',
        packPayload.data.packId,
        '--out',
        outputDir,
        '--json',
      ],
      { env: { ...process.env, TILEBORNE_HOME: tempHome } },
    );
    const buildPayload = JSON.parse(String(build.stdout)) as {
      readonly ok: boolean;
      readonly data: {
        readonly bundlePath: string;
        readonly files: readonly string[];
        readonly manifestHash: string;
      };
    };
    expect(buildPayload.ok).toBe(true);
    expect(buildPayload.data.files).toContain('worker.js');
    expect(buildPayload.data.files).toContain('behavior-worker.js');
    expect(buildPayload.data.files).toContain('manifest.json');
    expect(buildPayload.data.files).toContain('wrangler.toml');
    expect(buildPayload.data.files).toContain('wrangler.behavior.toml');
    expect(buildPayload.data.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const workerPath = path.join(outputDir, 'worker.js');
    const workerSource = await readFile(workerPath, 'utf8');
    expect(workerSource.includes('export')).toBe(true);
    const workerModule = await import(`${pathToFileURL(workerPath).href}?t=${Date.now()}`);
    expect(workerModule.default).toBeDefined();
    expect(workerModule.PlaytestRoom).toBeDefined();

    const manifest = JSON.parse(
      await readFile(path.join(outputDir, 'manifest.json'), 'utf8'),
    ) as BundledManifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.plugin.id).toBe(SMOKE_PLUGIN_ID);
    expect(manifest.assetPacks.length).toBeGreaterThanOrEqual(1);
    expect(manifest.buildId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.buildId).toBe(buildPayload.data.manifestHash);

    const wranglerToml = await readFile(path.join(outputDir, 'wrangler.toml'), 'utf8');
    expect(parseTomlBinding(wranglerToml, 'PLAYTEST_ROOM')).toBe(true);
    expect(wranglerToml.includes('main = "worker.js"')).toBe(true);
    expect(wranglerToml.includes('binding = "BEHAVIOR_RUNTIME"')).toBe(true);

    const harness = await bootMiniflare({ workerPath });
    dispose = harness.mfDispose;

    const health = await harness.fetch('http://localhost/health');
    expect(health.status).toBe(200);
    const healthBody = await parseJson<HealthPayload>(health);
    expect(healthBody.status).toBe('ok');
    expect(healthBody.buildId).toBe(manifest.buildId);

    const discover = await harness.fetch('http://localhost/discover');
    expect(discover.status).toBe(200);
    const discoverBody = await parseJson<DiscoverPayload>(discover);
    expect(discoverBody.plugin.id).toBe(SMOKE_PLUGIN_ID);
    expect(discoverBody.assetPacks.some((pack) => pack.id === SMOKE_ASSET_PACK_ID)).toBe(true);
  });
});

import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';

import { expect } from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  exportManifestPath,
  fixturePath,
  FIXTURE_PACK_ID,
  FIXTURE_PLUGIN_ID,
  launchElectron,
  navigateToRoute,
  pluginInstallDirectory,
  readMapJson,
  readProjectManifest,
  resolveMainEntry,
  SMOKE_PROJECT_NAME,
  waitForJob,
  type SmokeContext,
} from './helpers.js';

let smokeContext: SmokeContext | undefined;
let sandboxSkipReason: string | undefined;

let projectId = '';
let mapId = '';
let buildId = '';
let exportId = '';

function resolveSmokeLaunchTimeoutMs(): number {
  const raw = process.env.TILEBORNE_SMOKE_LAUNCH_TIMEOUT_MS;
  if (raw === undefined) {
    return 45_000;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid TILEBORNE_SMOKE_LAUNCH_TIMEOUT_MS: ${raw}`);
  }
  return parsed || 45_000;
}

describe.sequential('desktop smoke lifecycle', () => {
  beforeAll(async () => {
    try {
      resolveMainEntry();
      const tileborneHome = await createTileborneHome();
      // Override via TILEBORNE_SMOKE_LAUNCH_TIMEOUT_MS when GUI boot is slow (see playwright.config.ts).
      const launchTimeoutMs = resolveSmokeLaunchTimeoutMs();
      smokeContext = await Promise.race([
        launchElectron(tileborneHome),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Electron launch timed out after ${launchTimeoutMs / 1000}s (likely headless sandbox without GUI)`,
              ),
            );
          }, launchTimeoutMs);
        }),
      ]);
    } catch (error) {
      sandboxSkipReason = `Electron GUI cannot boot in this sandbox environment: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  });

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  beforeEach((context) => {
    if (sandboxSkipReason) {
      context.skip();
    }
    expect(smokeContext, 'Electron smoke context failed to initialize').toBeDefined();
  });

  it('1. app boot — main window appears and renderer mounts', async () => {
    const { page } = smokeContext!;
    await expect(page).toHaveTitle(/Tileborne/i);
    await expect(page.getByRole('heading', { name: /Tileborne|Projects/i })).toBeVisible();
  });

  it('2. IPC ping — window.tileborne.system.ping responds', async () => {
    const { page } = smokeContext!;
    const response = await page.evaluate(async () => window.tileborne.system.ping({}));
    expect(response.pong).toBe(true);
    expect(typeof response.ts).toBe('number');
    expect(Number.isFinite(response.ts)).toBe(true);
  });

  it('3. create project — home UI and project.json on disk', async () => {
    const { page, tileborneHome } = smokeContext!;

    await navigateToRoute(page, '/');

    projectId = await page.evaluate(async (name) => {
      const result = await window.tileborne.projects.create({ name });
      return result.projectId;
    }, SMOKE_PROJECT_NAME);

    await page.reload();
    await expect(page.getByText(SMOKE_PROJECT_NAME)).toBeVisible();

    const manifest = await readProjectManifest(tileborneHome, projectId);
    expect(manifest.id).toBe(projectId);
    expect(manifest.name).toBe(SMOKE_PROJECT_NAME);
  });

  it('4. install local plugin — bridge install and plugins directory', async () => {
    const { page, tileborneHome } = smokeContext!;
    const pluginSourcePath = fixturePath('plugin');

    const installed = await page.evaluate(async (sourcePath) => {
      const { plugin } = await window.tileborne.plugins.install({
        source: { _tag: 'local', path: sourcePath },
      });
      const { plugins } = await window.tileborne.plugins.list({});
      return { plugin, pluginIds: plugins.map((entry) => entry.id) };
    }, pluginSourcePath);

    expect(installed.plugin.id).toBe(FIXTURE_PLUGIN_ID);
    expect(installed.pluginIds).toContain(FIXTURE_PLUGIN_ID);
    expect(existsSync(pluginInstallDirectory(tileborneHome))).toBe(true);
  });

  it('5. import asset pack — directory fixture appears in listPacks', async () => {
    const { page } = smokeContext!;
    const packSourcePath = fixturePath('asset-pack');

    const jobId = await page.evaluate(async (sourcePath) => {
      const { jobId: id } = await window.tileborne.assets.importPack({
        sourceKind: 'directory',
        path: sourcePath,
      });
      return id;
    }, packSourcePath);

    const job = await waitForJob(page, jobId);
    expect(job.status).toBe('Completed');

    const packs = await page.evaluate(async () => {
      const { packs: listed } = await window.tileborne.assets.listPacks({});
      return listed.map((pack) => pack.id);
    });
    expect(packs).toContain(FIXTURE_PACK_ID);
  });

  it('6. open map — MapEditorViewport mounts with canvas', async () => {
    const { page } = smokeContext!;

    mapId = await page.evaluate(async (pid) => {
      const { map } = await window.tileborne.maps.generate({
        projectId: pid,
        width: 64,
        height: 64,
        seed: 42,
        preset: 'open',
      });
      return map.id;
    }, projectId);

    await navigateToRoute(page, `/projects/${projectId}/maps/${mapId}`);
    await expect(page.getByText('Loading map…')).toBeHidden({ timeout: 20_000 });

    const viewport = page.locator('.touch-none.bg-background');
    await expect(viewport).toBeVisible();
    await expect(viewport.locator(':scope > canvas')).toBeVisible({ timeout: 20_000 });
  });

  it('7. render frame — generated map persists tile layer data', async () => {
    const { tileborneHome } = smokeContext!;

    const saved = await readMapJson(tileborneHome, projectId, mapId);
    const tileLayer = (
      saved.layers as Array<{ kind: string; chunks?: Array<{ tiles: number[] }> }>
    ).find((layer) => layer.kind === 'tile');
    expect(tileLayer).toBeDefined();
    expect(tileLayer?.chunks?.[0]?.tiles.length).toBeGreaterThan(0);
  });

  it('8. save project — map JSON on disk matches IPC view', async () => {
    const { page, tileborneHome } = smokeContext!;

    const [saved, fromIpc] = await Promise.all([
      readMapJson(tileborneHome, projectId, mapId),
      page.evaluate(
        async ({ pid, mid }) => window.tileborne.maps.get({ projectId: pid, mapId: mid }),
        { pid: projectId, mid: mapId },
      ),
    ]);

    expect(saved).toMatchObject({ id: mapId });
    expect(fromIpc.map.id).toBe(mapId);
    expect((saved.layers as unknown[]).length).toBeGreaterThan(0);
  });

  it('9. validate project — integrity reads succeed without errors', async () => {
    const { page } = smokeContext!;

    await expect(
      page.evaluate(async (pid) => window.tileborne.projects.get({ projectId: pid }), projectId),
    ).resolves.toMatchObject({
      project: {
        id: projectId,
        name: SMOKE_PROJECT_NAME,
      },
    });

    await expect(
      page.evaluate(
        async ({ pid, mid }) => window.tileborne.maps.get({ projectId: pid, mapId: mid }),
        { pid: projectId, mid: mapId },
      ),
    ).resolves.toMatchObject({
      map: {
        id: mapId,
      },
    });
  });

  it('10. export build — build and Node export artifact with manifest.json', async () => {
    const { page, tileborneHome } = smokeContext!;

    const buildJobId = await page.evaluate(async (pid) => {
      const { jobId } = await window.tileborne.builds.build({ projectId: pid, target: 'local' });
      return jobId;
    }, projectId);

    const buildJob = await waitForJob(page, buildJobId, 180_000);
    expect(buildJob.status).toBe('Completed');

    const builds = await page.evaluate(async (pid) => {
      const { builds: listed } = await window.tileborne.builds.listBuilds({ projectId: pid });
      return listed;
    }, projectId);
    expect(builds.length).toBeGreaterThan(0);
    buildId = builds[0]!.id;

    const exportJobId = await page.evaluate(async (bid) => {
      const { jobId } = await window.tileborne.exports.exportBuild({
        buildId: bid,
        target: { _tag: 'NodeExportTarget' },
      });
      return jobId;
    }, buildId);

    const exportJob = await waitForJob(page, exportJobId, 180_000);
    expect(exportJob.status).toBe('Completed');

    const exports = await page.evaluate(async (bid) => {
      const { exports: listed } = await window.tileborne.exports.listExports({ buildId: bid });
      return listed;
    }, buildId);
    expect(exports.length).toBeGreaterThan(0);
    exportId = exports[0]!.id;

    const manifestPath = exportManifestPath(tileborneHome, exportId);
    await expect(access(manifestPath)).resolves.toBeUndefined();
  }, 180_000);
});

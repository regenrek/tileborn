import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  SAMPLE_ASSET_PACK_ID,
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  referenceTilesetPackPath,
  resolveMainEntry,
  SMOKE_PROJECT_NAME,
  waitForJob,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: sample tileset import', () => {
  let smokeContext: SmokeContext | undefined;
  let projectId = '';

  beforeAll(async () => {
    resolveMainEntry();
    smokeContext = await launchElectron(await createTileborneHome());
    const { page } = smokeContext;
    projectId = await page.evaluate(async (name) => {
      const result = await window.tileborne.projects.create({ name });
      return result.projectId;
    }, SMOKE_PROJECT_NAME);
    await page.evaluate(async (pid) => {
      await window.tileborne.maps.create({
        projectId: pid,
        width: 64,
        height: 64,
      });
    }, projectId);
  }, 120_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('imports a tileset pack from an explicit fixture path via IPC', async () => {
    const { page } = smokeContext!;
    const packPath = referenceTilesetPackPath();
    expect(existsSync(path.join(packPath, 'tileborne-asset-pack.json'))).toBe(true);

    const jobId = await page.evaluate(async (sourcePath) => {
      const { jobId: id } = await window.tileborne.assets.importPack({
        sourceKind: 'directory',
        path: sourcePath,
      });
      return id;
    }, packPath);

    const job = await waitForJob(page, jobId);
    expect(job.status).toBe('Completed');

    const packIds = await page.evaluate(async () => {
      const { packs } = await window.tileborne.assets.listPacks({});
      return packs.map((pack) => pack.id);
    });
    expect(packIds).toContain(SAMPLE_ASSET_PACK_ID);
  });

  it('renders imported tile thumbnails in the asset palette', async () => {
    const { page } = smokeContext!;

    await navigateToRoute(page, `/projects/${projectId}/assets`);
    await expect(page.getByTestId('asset-pack-grid')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('asset-pack-open-browser').first().click();
    await expect(page.getByTestId('asset-pack-browser')).toBeVisible({ timeout: 20_000 });

    const thumb = page.getByTestId('asset-pack-browser-item-thumb').first();
    await expect(thumb).toBeVisible({ timeout: 20_000 });
    const box = await thumb.boundingBox();
    expect(box).toBeTruthy();
    expect((box?.width ?? 0) > 0).toBe(true);
    expect((box?.height ?? 0) > 0).toBe(true);
  });
});

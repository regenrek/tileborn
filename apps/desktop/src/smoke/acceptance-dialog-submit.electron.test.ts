import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  referenceTilesetPackPath,
  resolveMainEntry,
  SMOKE_PROJECT_NAME,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: generate map dialog submit', () => {
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

    await page.evaluate(async (path) => {
      const { jobId } = await window.tileborne.assets.importPack({
        sourceKind: 'directory',
        path,
      });
      const started = Date.now();
      while (Date.now() - started < 60_000) {
        const { job } = await window.tileborne.jobs.get({ jobId });
        if (job.status === 'Completed') {
          return;
        }
        if (job.status === 'Failed' || job.status === 'Cancelled') {
          throw new Error(job.errorMessage ?? 'import failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('import timed out');
    }, referenceTilesetPackPath());
  }, 120_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('submits the dialog and shows the new map in the sidebar', async () => {
    const { page } = smokeContext!;

    await navigateToRoute(page, `/projects/${projectId}`);
    await page.getByRole('button', { name: 'Generate Map', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /Generate map/i })).toBeVisible();

    await expect(page.getByTestId('generate-map-submit')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('generate-map-submit').click();
    await expect(page.getByRole('dialog', { name: /Generate map/i })).toBeHidden({
      timeout: 20_000,
    });

    const sidebarMaps = page.getByTestId('sidebar-map-list');
    await expect(sidebarMaps.locator('a')).not.toHaveCount(0, { timeout: 5_000 });
    await expect(sidebarMaps).toContainText('×', { timeout: 5_000 });
  });
});

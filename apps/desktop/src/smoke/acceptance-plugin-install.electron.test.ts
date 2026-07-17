import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  BATTLE_ROYALE_PLUGIN_ID,
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  resolveBattleRoyaleInstallPath,
  resolveMainEntry,
  SMOKE_PROJECT_NAME,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: battle-royale plugin install UI', () => {
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

    const installPath = resolveBattleRoyaleInstallPath();
    await page.evaluate(
      async ({ sourcePath, pluginId }) => {
        await window.tileborne.plugins.install({
          source: { _tag: 'local', path: sourcePath },
        });
        const { plugins } = await window.tileborne.plugins.list({});
        const installed = plugins.find((plugin) => plugin.id === pluginId);
        if (!installed?.enabled) {
          await window.tileborne.plugins.enable({ pluginId });
        }
      },
      { sourcePath: installPath, pluginId: BATTLE_ROYALE_PLUGIN_ID },
    );
  }, 120_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('shows battle-royale as installed in the plugins sidebar tab', async () => {
    const { page } = smokeContext!;
    const installPath = resolveBattleRoyaleInstallPath();

    await navigateToRoute(page, `/projects/${projectId}`);
    await page.getByRole('tab', { name: 'Plugins' }).evaluate((tab) => {
      (tab as HTMLElement).click();
    });

    await expect(page.getByText(new RegExp(`${BATTLE_ROYALE_PLUGIN_ID}.*Enabled`))).toBeVisible({
      timeout: 20_000,
    });

    const plugins = await page.evaluate(async () => {
      const { plugins: listed } = await window.tileborne.plugins.list({});
      return listed;
    });
    expect(plugins.some((plugin) => plugin.id === BATTLE_ROYALE_PLUGIN_ID)).toBe(true);
    expect(installPath.length).toBeGreaterThan(0);
  });
});

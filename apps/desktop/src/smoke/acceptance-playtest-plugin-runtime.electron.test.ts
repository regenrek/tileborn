import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  BATTLE_ROYALE_PLUGIN_ID,
  addBattleRoyaleSpawnAnchors,
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  resolveBattleRoyaleInstallPath,
  resolveMainEntry,
  setProjectActiveGameMode,
  SMOKE_PROJECT_NAME,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: playtest plugin runtime', () => {
  let smokeContext: SmokeContext | undefined;
  let projectId = '';
  let mapId = '';

  beforeAll(async () => {
    resolveMainEntry();
    smokeContext = await launchElectron(await createTileborneHome());
    const { page } = smokeContext;
    projectId = await page.evaluate(async (name) => {
      const result = await window.tileborne.projects.create({ name });
      return result.projectId;
    }, SMOKE_PROJECT_NAME);

    mapId = await page.evaluate(async (pid) => {
      const { mapId: createdMapId } = await window.tileborne.maps.create({
        projectId: pid,
        width: 32,
        height: 32,
      });
      return createdMapId;
    }, projectId);
    await addBattleRoyaleSpawnAnchors(page, projectId, mapId);

    const pluginSourcePath = resolveBattleRoyaleInstallPath();
    await page.evaluate(
      async ({ sourcePath, pluginId }) => {
        await window.tileborne.plugins.install({
          source: { _tag: 'local', path: sourcePath },
        });
        const { plugins } = await window.tileborne.plugins.list({});
        const installed = plugins.find((plugin) => plugin.id === pluginId);
        if (!installed) {
          throw new Error(`Plugin not installed: ${pluginId}`);
        }
        if (!installed.enabled) {
          await window.tileborne.plugins.enable({ pluginId: installed.id });
        }
      },
      { sourcePath: pluginSourcePath, pluginId: BATTLE_ROYALE_PLUGIN_ID },
    );
    await setProjectActiveGameMode(page, projectId, BATTLE_ROYALE_PLUGIN_ID);
  }, 120_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('surfaces plugin runtime activity in the playtest overlay', async () => {
    const { page } = smokeContext!;

    await navigateToRoute(page, `/projects/${projectId}/maps/${mapId}`);
    await expect(page.getByText('Loading map…')).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId('readiness-status')).toContainText(/Ready|warnings/, {
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /Playtest menu/i }).click();
    await page.getByRole('menuitem', { name: /Single \(local-only\)/i }).click();
    await expect
      .poll(
        async () => {
          if (await page.getByTestId('playtest-viewport').isVisible()) {
            return 'running';
          }
          const alert = page.getByRole('alert');
          return (await alert.isVisible()) ? `error: ${await alert.textContent()}` : 'starting';
        },
        { timeout: 15_000 },
      )
      .toBe('running');
    await expect(page.getByTestId('playtest-viewport')).toBeVisible({ timeout: 15_000 });

    const runtimeStatus = page.getByTestId('playtest-runtime-status');
    await expect(runtimeStatus).toContainText(BATTLE_ROYALE_PLUGIN_ID, { timeout: 15_000 });
    await expect
      .poll(async () => runtimeStatus.textContent(), { timeout: 15_000 })
      .toMatch(/onInit|onTick:\d+/);
    await expect
      .poll(async () => runtimeStatus.textContent(), { timeout: 15_000 })
      .toMatch(/Tick [1-9]/);
  });
});

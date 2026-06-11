import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  addBattleRoyaleSpawnAnchors,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  resolveBattleRoyaleInstallPath,
  resolveMainEntry,
  setProjectActiveGameMode,
  SMOKE_PROJECT_NAME,
  BATTLE_ROYALE_PLUGIN_ID,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: playtest', () => {
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
          throw new Error('No plugin installed');
        }
        if (!installed.enabled) {
          await window.tileborne.plugins.enable({ pluginId: installed.id });
        }
      },
      { sourcePath: pluginSourcePath, pluginId: BATTLE_ROYALE_PLUGIN_ID },
    );
    await setProjectActiveGameMode(page, projectId, BATTLE_ROYALE_PLUGIN_ID);
  }, 60_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('starts playtest via IPC with artifact and active plugins', async () => {
    const { page } = smokeContext!;

    const session = await page.evaluate(
      async ({ pid, mid }) => {
        const { session: started } = await window.tileborne.playtest.start({
          projectId: pid,
          mapId: mid,
        });
        return started;
      },
      { pid: projectId, mid: mapId },
    );

    expect(session.status).toBe('Running');
    expect(session.artifactDirectory).toBeTruthy();
    expect(session.activePlugins?.length ?? 0).toBeGreaterThan(0);
  });

  it('launches playtest overlay from the top bar', async () => {
    const { page } = smokeContext!;

    await navigateToRoute(page, `/projects/${projectId}/maps/${mapId}`);
    await expect(page.getByText('Loading map…')).toBeHidden({ timeout: 20_000 });

    await page.getByRole('button', { name: /Playtest menu/i }).click();
    await page.getByRole('menuitem', { name: /Single \(local-only\)/i }).click();
    await expect(page.getByTestId('playtest-viewport')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Stop playtest/i })).toBeVisible();
  });
});

import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  addBattleRoyaleSpawnAnchors,
  disposeSmokeContext,
  launchElectron,
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

    await page.evaluate(async (pluginId) => {
      await window.tileborne.plugins.installBundledBattleRoyale({});
      const { plugins } = await window.tileborne.plugins.list({});
      const installed = plugins.find((plugin) => plugin.id === pluginId);
      if (!installed) {
        throw new Error('No plugin installed');
      }
      if (!installed.enabled) {
        await window.tileborne.plugins.enable({ pluginId: installed.id });
      }
    }, BATTLE_ROYALE_PLUGIN_ID);
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
    await page.evaluate(async (sessionId) => {
      await window.tileborne.playtest.stop({ sessionId });
    }, session.id);
  });
});

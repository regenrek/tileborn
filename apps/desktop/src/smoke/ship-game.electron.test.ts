import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  closeSmokeApp,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  readProjectManifest,
  resolveMainEntry,
  type SmokeContext,
} from './helpers.js';

describe('guided Ship Game (fresh-profile Electron)', () => {
  let context: SmokeContext | undefined;

  beforeAll(async () => {
    resolveMainEntry();
    context = await launchElectron(await createTileborneHome(), {
      TILEBORNE_E2E_SHIP_ASSEMBLY_DELAY_MS: '2500',
    });
  }, 120_000);

  afterAll(async () => {
    await disposeSmokeContext(context);
    context = undefined;
  });

  it('ships the selected authored BR map and launches its packaged preview room', async () => {
    let { app, page } = context!;
    const { tileborneHome } = context!;
    const created = await page.evaluate(async () =>
      window.tileborne.projects.createGame({
        name: 'Ship Game Smoke',
        gameType: 'battle-royale',
        idempotencyKey: 'ship-game-electron-smoke',
      }),
    );

    await navigateToRoute(page, `/projects/${created.projectId}`);
    await page.getByTestId('overview-ship-game').click();
    const dialog = page.getByTestId('ship-game-dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByLabel('Ship Game', { exact: true }).click();
    await page.getByTestId('topbar-ship-game').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const commandSearch = page.getByPlaceholder('Search commands, maps, plugins…');
    await expect(commandSearch).toBeFocused();
    await commandSearch.fill('Ship Game');
    const shipCommand = page.getByRole('option', { name: 'Ship Game…', exact: true });
    await expect(shipCommand).toBeVisible();
    await commandSearch.press('ArrowDown');
    await commandSearch.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Starter Battle Royale Arena')).toBeVisible();
    await expect(dialog.getByText(String(created.mapId), { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('ship-target')).toContainText('Local packaged preview');

    await page.getByTestId('ship-game-start').click();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByRole('alert')).toContainText('cancelled');
    await expect
      .poll(async () => {
        const games = path.join(tileborneHome, 'cache', 'builds', 'games');
        return (await readdir(games).catch(() => [])).filter((entry) =>
          entry.includes('.building-'),
        );
      })
      .toEqual([]);

    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('ship-artifact')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('ship-logs')).toContainText('Readiness passed');
    await expect(page.getByTestId('ship-logs')).toContainText('Artifact verified');

    const persisted = await readProjectManifest(tileborneHome, created.projectId);
    expect(persisted.settings).toMatchObject({
      startupMapId: created.mapId,
      shipTarget: 'local',
    });

    const artifact = await page.evaluate(async (startupMapId) => {
      const { jobs } = await window.tileborne.jobs.list({});
      const result = jobs.find(
        (job) =>
          job.status === 'Completed' &&
          typeof job.result === 'object' &&
          job.result !== null &&
          'startupMapId' in job.result &&
          job.result.startupMapId === startupMapId,
      )?.result;
      if (typeof result !== 'object' || result === null || !('directory' in result)) {
        throw new Error('Completed Ship Game artifact missing from JobService.');
      }
      return result as {
        readonly directory: string;
        readonly bundlePath: string;
        readonly buildId: string;
        readonly runtimeBuildId: string;
        readonly integrityHash: string;
      };
    }, created.mapId);
    const bundledManifest = JSON.parse(
      await readFile(`${artifact.directory}/manifest.json`, 'utf8'),
    ) as { readonly buildId: string; readonly maps: readonly { readonly mapId: string }[] };
    expect(bundledManifest.buildId).toBe(artifact.runtimeBuildId);
    expect(bundledManifest.maps.map((map) => map.mapId)).toEqual([created.mapId]);

    await page.getByTestId('ship-game-start').click();
    await expect(page.getByTestId('ship-artifact')).toBeVisible({ timeout: 90_000 });
    const repeated = await page.evaluate(async (startupMapId) => {
      const { jobs } = await window.tileborne.jobs.list({});
      const results = jobs
        .filter((job) => job.status === 'Completed')
        .map((job) => job.result)
        .filter(
          (result): result is Record<string, unknown> =>
            typeof result === 'object' && result !== null && result.startupMapId === startupMapId,
        );
      return results.at(-1);
    }, created.mapId);
    expect(repeated?.directory).toBe(artifact.directory);
    expect(repeated?.buildId).toBe(artifact.buildId);

    const windowsBeforePreview = app.windows().length;
    await page.getByRole('button', { name: 'Launch packaged preview' }).click();
    await expect
      .poll(() => app.windows().length, { timeout: 30_000 })
      .toBeGreaterThan(windowsBeforePreview);
    const preview = app.windows().find((window) => window !== page);
    expect(preview).toBeDefined();
    await expect.poll(() => preview!.url(), { timeout: 15_000 }).toContain('joinRoom=');
    expect(preview!.url()).toContain(encodeURIComponent(String(created.mapId)));

    await closeSmokeApp(context!);
    context = await launchElectron(tileborneHome);
    ({ app, page } = context);
    await navigateToRoute(page, `/projects/${created.projectId}`);
    await page.getByLabel('Ship Game', { exact: true }).click();
    await page.getByTestId('topbar-ship-game').click();
    await expect(page.getByTestId('ship-artifact')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ship-game-dialog')).toContainText(artifact.integrityHash);

    const windowsBeforeRestartPreview = app.windows().length;
    await page.getByRole('button', { name: 'Launch packaged preview' }).click();
    await expect
      .poll(() => app.windows().length, { timeout: 30_000 })
      .toBeGreaterThan(windowsBeforeRestartPreview);

    await writeFile(artifact.bundlePath, 'tampered worker', 'utf8');
    const tamperError = await page.evaluate(async () => {
      const { jobs } = await window.tileborne.jobs.list({});
      const artifact = jobs
        .map((job) => job.result)
        .find((result) => typeof result === 'object' && result !== null && 'bundlePath' in result);
      try {
        await window.tileborne.ship.launchPreview({ artifact: artifact as never });
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(tamperError).toContain('integrity');

    const arbitraryPathError = await page.evaluate(async () => {
      const { jobs } = await window.tileborne.jobs.list({});
      const artifact = jobs
        .map((job) => job.result)
        .find(
          (result) => typeof result === 'object' && result !== null && 'bundlePath' in result,
        ) as Record<string, unknown>;
      try {
        await window.tileborne.ship.launchPreview({
          artifact: {
            ...artifact,
            directory: '/tmp',
            manifestPath: '/tmp/manifest.json',
            bundlePath: '/tmp/worker.js',
          } as never,
        });
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(arbitraryPathError).toContain('managed build root');
  }, 240_000);
});

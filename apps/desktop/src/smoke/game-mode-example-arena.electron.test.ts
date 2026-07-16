import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect } from '@playwright/test';
import { createLocalGameHost } from '@tileborne/services-build/local-game-host';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  EXAMPLE_ARENA_PLUGIN_ID,
  launchElectron,
  navigateToRoute,
  resolveExampleArenaInstallPath,
  resolveMainEntry,
  setProjectActiveGameMode,
  waitForJob,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: Example Arena game-mode extension contract', () => {
  let context: SmokeContext | undefined;
  let projectId = '';
  let mapId = '';

  beforeAll(async () => {
    resolveMainEntry();
    context = await launchElectron(await createTileborneHome());
    const { page } = context;
    projectId = await page.evaluate(
      async () =>
        (await window.tileborne.projects.create({ name: 'Example Arena Contract Proof' }))
          .projectId,
    );
    mapId = await page.evaluate(
      async (pid) =>
        (await window.tileborne.maps.create({ projectId: pid, width: 32, height: 32 })).mapId,
      projectId,
    );
    await page.evaluate(
      async ({ path, pluginId }) => {
        const installed = await window.tileborne.plugins.install({
          source: { _tag: 'local', path },
        });
        if (!installed.plugin.enabled) {
          await window.tileborne.plugins.enable({ pluginId });
        }
      },
      { path: resolveExampleArenaInstallPath(), pluginId: EXAMPLE_ARENA_PLUGIN_ID },
    );
    await setProjectActiveGameMode(page, projectId, EXAMPLE_ARENA_PLUGIN_ID);
  }, 120_000);

  afterAll(async () => {
    await disposeSmokeContext(context);
    context = undefined;
  });

  it('renders and persists the generic schema settings fallback', async () => {
    const { page } = context!;
    await navigateToRoute(page, `/projects/${projectId}/maps/${mapId}`);
    await expect(page.getByText('Loading map…')).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId('generic-mode-settings-panel')).toBeVisible();
    await expect(page.getByText('Arena radius', { exact: true })).toBeVisible();
    await page.getByTestId('mode-setting-arenaRadius').fill('48');
    await page.getByTestId('mode-setting-enemyCount').fill('10');
    await page.getByTestId('mode-setting-save').click();
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ pid, mid, pluginId }) => {
            const { map } = await window.tileborne.maps.get({ projectId: pid, mapId: mid });
            return map.properties[pluginId];
          },
          { pid: projectId, mid: mapId, pluginId: EXAMPLE_ARENA_PLUGIN_ID },
        ),
      )
      .toEqual({
        arenaRadius: 48,
        enemyCount: 10,
      });
  });

  it('passes readiness, starts playtest, and completes Ship through generic paths', async () => {
    const { page } = context!;
    const readiness = await page.evaluate(
      async ({ pid, mid }) =>
        window.tileborne.readiness.check({ projectId: pid, mapId: mid, purpose: 'playtest' }),
      { pid: projectId, mid: mapId },
    );
    expect(readiness.report.ok).toBe(true);

    const session = await page.evaluate(
      async ({ pid, mid }) =>
        (await window.tileborne.playtest.start({ projectId: pid, mapId: mid })).session,
      { pid: projectId, mid: mapId },
    );
    expect(session.status).toBe('Running');
    expect(session.activePlugins).toEqual([EXAMPLE_ARENA_PLUGIN_ID]);
    await page.evaluate(async (sessionId) => {
      await window.tileborne.playtest.stop({ sessionId });
    }, session.id);

    const { jobId } = await page.evaluate(
      async ({ pid, mid }) =>
        window.tileborne.ship.start({ projectId: pid, startupMapId: mid, target: 'cloudflare' }),
      { pid: projectId, mid: mapId },
    );
    const job = await waitForJob(page, jobId, 90_000);
    expect(job.status, job.errorMessage).toBe('Completed');

    const artifact = await page.evaluate(async (completedJobId) => {
      const { jobs } = await window.tileborne.jobs.list({});
      const result = jobs.find((candidate) => candidate.id === completedJobId)?.result;
      if (
        typeof result !== 'object' ||
        result === null ||
        typeof (result as Record<string, unknown>).directory !== 'string' ||
        typeof (result as Record<string, unknown>).bundlePath !== 'string'
      ) {
        throw new Error('Completed Example Arena Ship job has no executable artifact.');
      }
      return result as { readonly directory: string; readonly bundlePath: string };
    }, jobId);

    // Standalone execution proof: copy only the completed artifact to an
    // isolated root, then boot that copied worker. No installed plugin path or
    // build staging directory participates in room creation.
    const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-example-ship-proof-'));
    const isolatedArtifact = path.join(isolatedRoot, 'artifact');
    await cp(artifact.directory, isolatedArtifact, { recursive: true });
    const manifest = JSON.parse(
      await readFile(path.join(isolatedArtifact, 'manifest.json'), 'utf8'),
    ) as {
      readonly plugin: { readonly id: string };
      readonly maps: readonly { readonly mapId: string }[];
    };
    expect(manifest.plugin.id).toBe(EXAMPLE_ARENA_PLUGIN_ID);
    expect(manifest.maps.map((entry) => entry.mapId)).toEqual([mapId]);
    const packageDirectory = path.join(isolatedArtifact, 'maps', mapId.replaceAll(':', '-'));
    const packageManifest = JSON.parse(
      await readFile(path.join(packageDirectory, 'manifest.json'), 'utf8'),
    ) as { readonly activeMode: string };
    const modeData = JSON.parse(
      await readFile(path.join(packageDirectory, 'mode-data.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(packageManifest.activeMode).toBe(EXAMPLE_ARENA_PLUGIN_ID);
    expect(modeData[EXAMPLE_ARENA_PLUGIN_ID]).toEqual({
      schemaVersion: 1,
      arenaRadius: 48,
      enemyCount: 10,
    });

    const host = await createLocalGameHost({
      port: 18096,
      workerPath: path.join(isolatedArtifact, 'worker.js'),
    });
    try {
      const created = await host.fetch(`${host.baseUrl}/rooms/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId,
          options: { idempotencyKey: 'example-arena-isolated-artifact-room' },
        }),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const room = (await created.json()) as { readonly roomId: string };
      const summaryResponse = await host.fetch(`${host.baseUrl}/playtest/${room.roomId}`);
      expect(summaryResponse.status, await summaryResponse.clone().text()).toBe(200);
      const summary = (await summaryResponse.json()) as {
        readonly playtestId: string;
        readonly mapId: string;
        readonly metrics: { readonly tick: number };
      };
      expect(summary).toMatchObject({
        playtestId: room.roomId,
        mapId,
        metrics: { tick: expect.any(Number) },
      });
    } finally {
      await host.stop();
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  }, 120_000);
});

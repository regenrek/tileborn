import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect } from '@playwright/test';
import { afterAll, describe, it } from 'vitest';

import {
  closeSmokeApp,
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  type SmokeContext,
} from './helpers.js';

type NativeTiming = Readonly<{
  name: string;
  durationMs: number;
}>;

const timed = async <T>(name: string, operation: () => Promise<T>) => {
  const startedAt = performance.now();
  const value = await operation();
  return { value, timing: { name, durationMs: performance.now() - startedAt } };
};

describe('creator native performance calibration (advisory)', () => {
  let context: SmokeContext | undefined;

  afterAll(async () => {
    await disposeSmokeContext(context);
    context = undefined;
  });

  it('records native startup, create, reopen, and route-ready timings with Playwright traces', async () => {
    const artifactRoot =
      process.env.TILEBORNE_PERFORMANCE_ARTIFACT_DIR ??
      path.join(os.tmpdir(), 'tileborne-performance-evidence');
    await mkdir(artifactRoot, { recursive: true });
    const home = await createTileborneHome();
    const timings: NativeTiming[] = [];

    const firstLaunch = await timed('fresh-profile-ready', () => launchElectron(home));
    context = firstLaunch.value;
    timings.push(firstLaunch.timing);
    await context.app.context().tracing.start({ screenshots: true, snapshots: true });

    const startup = await context.page.evaluate(() => window.tileborneStartup.getStatus());
    const nativeRuntime = await context.app.evaluate(({ app }) => ({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      appVersion: app.getVersion(),
    }));
    expect(startup.state).not.toBe('failed');
    for (const task of startup.tasks) {
      if (task.durationMs !== undefined) {
        timings.push({ name: `startup-task:${task.id}`, durationMs: task.durationMs });
      }
    }

    const created = await timed('battle-royale-project-create', () =>
      context!.page.evaluate(() =>
        window.tileborne.projects.createGame({
          name: 'Native Performance Calibration',
          gameType: 'battle-royale',
          idempotencyKey: 'creator-performance-native-v1',
        }),
      ),
    );
    timings.push(created.timing);
    await navigateToRoute(
      context.page,
      `/projects/${created.value.projectId}/maps/${created.value.mapId}`,
    );
    await expect(context.page.getByTestId('br-setting-maxPlayers')).toBeVisible();
    const createTracePath = path.join(artifactRoot, 'creator-performance-create-trace.zip');
    await context.app.context().tracing.stop({ path: createTracePath });
    await closeSmokeApp(context);
    context = undefined;

    const reopenLaunch = await timed('existing-profile-ready', () => launchElectron(home));
    context = reopenLaunch.value;
    timings.push(reopenLaunch.timing);
    await context.app.context().tracing.start({ screenshots: true, snapshots: true });
    const projectOpen = await timed('project-manifest-open', () =>
      context!.page.evaluate(
        (projectId) => window.tileborne.projects.get({ projectId }),
        created.value.projectId,
      ),
    );
    timings.push(projectOpen.timing);
    const routeReady = await timed('project-map-route-ready', async () => {
      await navigateToRoute(
        context!.page,
        `/projects/${created.value.projectId}/maps/${created.value.mapId}`,
      );
      await expect(context!.page.getByTestId('br-setting-maxPlayers')).toBeVisible();
    });
    timings.push(routeReady.timing);
    const reopenTracePath = path.join(artifactRoot, 'creator-performance-reopen-trace.zip');
    await context.app.context().tracing.stop({ path: reopenTracePath });

    expect(timings.length).toBeGreaterThan(4);
    expect(timings.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0)).toBe(
      true,
    );
    const traceReceipt = async (filePath: string) => ({
      file: path.basename(filePath),
      bytes: (await stat(filePath)).size,
      sha256: createHash('sha256')
        .update(await readFile(filePath))
        .digest('hex'),
    });
    const receipt = {
      schemaVersion: 1,
      fixtureId: 'creator-performance-v1',
      kind: 'native-advisory-calibration',
      policy: 'evidence-only-no-ci-threshold',
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        electron: nativeRuntime.electron,
        chrome: nativeRuntime.chrome,
        appVersion: nativeRuntime.appVersion,
        cpu: os.cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        ci: process.env.CI === 'true',
      },
      timings,
      traces: [await traceReceipt(createTracePath), await traceReceipt(reopenTracePath)],
    };
    const receiptPath = path.join(artifactRoot, 'creator-performance-native-receipt.json');
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    console.info(`creator-performance-native receipt=${receiptPath}`);
    console.info(JSON.stringify(receipt));
  }, 120_000);
});

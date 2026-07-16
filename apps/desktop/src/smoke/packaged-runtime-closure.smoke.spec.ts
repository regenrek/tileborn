import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, readdir, readlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalGameHost } from '@tileborne/game-host/local';

import { navigateToRoute, waitForAppPage, waitForJob } from './helpers.js';

const smokeDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(smokeDir, '../..');
const packagedDirectory = path.join(desktopRoot, 'out', `Tileborne-darwin-${process.arch}`);
const sourceApp = path.join(packagedDirectory, 'Tileborne.app');
const isContainedPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const findEscapingSymlinks = async (root: string): Promise<readonly string[]> => {
  const escaping: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        const target = await readlink(candidate);
        const resolvedTarget = await realpath(path.resolve(path.dirname(candidate), target));
        if (!isContainedPath(root, resolvedTarget)) {
          escaping.push(`${candidate} -> ${resolvedTarget}`);
        }
        continue;
      }
      if (stats.isDirectory()) {
        await visit(candidate);
      }
    }
  };
  await visit(root);
  return escaping;
};

describe.skipIf(process.platform !== 'darwin')('packaged desktop runtime closure', () => {
  let app: ElectronApplication | undefined;
  let isolatedRoot: string;
  let copiedApp: string;
  let packagedAppRoot: string;

  beforeAll(async () => {
    isolatedRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-packaged-smoke-'));
    copiedApp = path.join(isolatedRoot, 'Tileborne.app');
    await cp(sourceApp, copiedApp, { recursive: true, verbatimSymlinks: true });
    packagedAppRoot = path.join(copiedApp, 'Contents', 'Resources', 'app');

    const executableName = execFileSync(
      '/usr/bin/plutil',
      [
        '-extract',
        'CFBundleExecutable',
        'raw',
        '-o',
        '-',
        path.join(copiedApp, 'Contents', 'Info.plist'),
      ],
      { encoding: 'utf8' },
    ).trim();
    const executablePath = path.join(copiedApp, 'Contents', 'MacOS', executableName);
    const tileborneHome = path.join(isolatedRoot, 'tileborne-home');
    const userDataDirectory = path.join(isolatedRoot, 'electron-user-data');
    const env = {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      TILEBORNE_DISABLE_DEVTOOLS: 'true',
      TILEBORNE_E2E: '1',
      TILEBORNE_HOME: tileborneHome,
    };
    delete env.TILEBORNE_REMOTE_DEBUGGING_PORT;
    app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDirectory}`],
      env,
      cwd: isolatedRoot,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('contains only self-contained production externals and no workspace requires', async () => {
    const buildDirectory = path.join(packagedAppRoot, '.vite', 'build');
    const buildEntries = (await readdir(buildDirectory)).filter((entry) => entry.endsWith('.cjs'));
    const bundleSource = (
      await Promise.all(buildEntries.map((entry) => readFile(path.join(buildDirectory, entry), 'utf8')))
    ).join('\n');

    // CJS runtime edges are what Node resolves during packaged startup. A
    // literal `import('@tileborne/plugin-api')` also exists inside the plugin
    // scaffolder's generated source template, so it is intentionally not
    // treated as a live bundle edge here.
    expect(bundleSource).not.toMatch(/require\(["']@tileborne\//);
    expect(bundleSource).toMatch(/(?:require|import)\(["']esbuild["']\)/);
    expect(bundleSource).toMatch(/(?:require|import)\(["']miniflare["']\)/);

    const nodeModules = path.join(packagedAppRoot, 'node_modules');
    expect(await findEscapingSymlinks(nodeModules)).toEqual([]);

    const buildAssetsRoot = path.join(
      copiedApp,
      'Contents',
      'Resources',
      'game-host-build-assets',
    );
    await expect(Promise.all([
      readFile(path.join(buildAssetsRoot, 'worker-entry.js'), 'utf8'),
      readFile(path.join(buildAssetsRoot, 'behavior/workerd/service-worker.js'), 'utf8'),
      readFile(path.join(buildAssetsRoot, 'wrangler.template.toml'), 'utf8'),
    ])).resolves.toHaveLength(3);
  });

  it('boots the copied app to a visible renderer using only its Resources directory', async () => {
    const page = await waitForAppPage(app!, 60_000);
    await expect.poll(async () => page.title(), { timeout: 10_000 }).toMatch(/Tileborne/i);
    expect(await page.evaluate(() => typeof window.tileborne)).toBe('object');

    const mainState = await app!.evaluate(({ app: electronApp, BrowserWindow }) => ({
      appPath: electronApp.getAppPath(),
      isPackaged: electronApp.isPackaged,
      resourcesPath: process.resourcesPath,
      visibleWindows: BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length,
    }));
    expect(mainState.isPackaged).toBe(true);
    expect(mainState.visibleWindows).toBeGreaterThan(0);
    expect(isContainedPath(path.join(copiedApp, 'Contents', 'Resources'), mainState.appPath)).toBe(
      true,
    );
    expect(mainState.resourcesPath).toBe(path.join(copiedApp, 'Contents', 'Resources'));

    const resolutions = await app!.evaluate(({ app: electronApp }) => {
      const moduleApi = process.getBuiltinModule('node:module');
      const pathApi = process.getBuiltinModule('node:path');
      const appRequire = moduleApi.createRequire(
        pathApi.join(electronApp.getAppPath(), '.vite', 'build', 'main.cjs'),
      );
      return ['esbuild', 'miniflare'].map((packageName) => ({
        packageName,
        resolved: appRequire.resolve(packageName),
      }));
    });
    for (const resolution of resolutions) {
      expect(
        isContainedPath(path.join(copiedApp, 'Contents', 'Resources'), resolution.resolved),
        `${resolution.packageName} escaped the copied app: ${resolution.resolved}`,
      ).toBe(true);
    }
  });

  it('ships from the packaged app with an external cwd and boots a copied artifact', async () => {
    const page = await waitForAppPage(app!, 60_000);
    await expect.poll(async () => page.evaluate(async () => {
      try {
        await window.tileborne.projects.list({});
        return true;
      } catch {
        return false;
      }
    }), { timeout: 30_000 }).toBe(true);

    const created = await page.evaluate(async () => window.tileborne.projects.createGame({
      name: 'Packaged Ship Oracle',
      gameType: 'battle-royale',
      idempotencyKey: 'packaged-ship-oracle',
    }));
    await navigateToRoute(page, `/projects/${created.projectId}`);
    await page.getByTestId('overview-ship-game').click();
    await expect.poll(async () => page.getByTestId('ship-game-dialog').isVisible()).toBe(true);
    await page.getByTestId('ship-game-start').click();

    await expect.poll(async () => page.evaluate(async () => {
      const { jobs } = await window.tileborne.jobs.list({});
      return jobs.some(({ id }) => String(id).startsWith('job:'));
    }), { timeout: 30_000 }).toBe(true);
    const jobId = await page.evaluate(async () => {
      const { jobs } = await window.tileborne.jobs.list({});
      const job = jobs.find(({ id }) => String(id).startsWith('job:'));
      if (job === undefined) throw new Error('Packaged Ship Game job missing');
      return job.id;
    });
    const completed = await waitForJob(page, jobId, 120_000);
    expect(completed.status, completed.errorMessage).toBe('Completed');
    await expect.poll(async () => page.getByTestId('ship-logs').textContent()).toContain(
      'Artifact verified',
    );

    const artifact = await page.evaluate(async (startupMapId) => {
      const { jobs } = await window.tileborne.jobs.list({});
      const result = jobs
        .filter(({ status }) => status === 'Completed')
        .map(({ result }) => result)
        .find((value) => typeof value === 'object' && value !== null
          && 'startupMapId' in value && value.startupMapId === startupMapId);
      if (typeof result !== 'object' || result === null || !('directory' in result)) {
        throw new Error('Packaged Ship Game artifact missing');
      }
      return result as { readonly directory: string };
    }, created.mapId);
    const copiedArtifact = path.join(isolatedRoot, 'copied-ship-artifact');
    await cp(artifact.directory, copiedArtifact, { recursive: true });
    const workerPath = path.join(copiedArtifact, 'worker.js');
    const behaviorWorkerPath = path.join(copiedArtifact, 'behavior-worker.js');
    expect(await readFile(workerPath, 'utf8')).not.toContain(path.resolve(desktopRoot, '../..'));

    const host = await createLocalGameHost({
      port: 19_874,
      workerPath,
      behaviorWorkerPath,
    });
    try {
      expect((await host.fetch('/health')).status).toBe(200);
      const room = await host.fetch('/rooms/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: created.mapId,
          options: { idempotencyKey: 'packaged-ship-copy' },
        }),
      });
      expect(room.status, await room.clone().text()).toBe(201);
      const createdRoom = await room.json() as { readonly roomId: string };
      const summary = await host.fetch(`/playtest/${createdRoom.roomId}`);
      expect(summary.status, await summary.clone().text()).toBe(200);
      expect(await summary.json()).toMatchObject({ mapId: created.mapId });
    } finally {
      await host.stop();
    }
  }, 240_000);

});

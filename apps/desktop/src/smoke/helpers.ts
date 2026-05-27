import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale';

const smokeDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(smokeDir, '../..');

export const FIXTURE_PLUGIN_ID = '@tileborne-plugins/smoke-fixture';
export const FIXTURE_PACK_ID = 'pack:550e8400-e29b-41d4-a716-446655440001';
export const SAMPLE_ASSET_PACK_ID = 'pack:550e8400-e29b-41d4-a716-446655440099';
export const BATTLE_ROYALE_PLUGIN_ID = PLUGIN_ID;
export const SMOKE_PROJECT_NAME = 'Smoke Test Project';

export interface SmokeContext {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly tileborneHome: string;
}

const SMOKE_ELECTRON_ENV = {
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  TILEBORNE_DISABLE_DEVTOOLS: 'true',
  TILEBORNE_SMOKE: 'true',
  TILEBORNE_E2E: '1',
} as const;

export async function waitForAppPage(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const ready = await page
        .evaluate(() => typeof window.tileborne === 'object')
        .catch(() => false);
      if (ready) {
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for renderer with window.tileborne`);
}

export function fixturePath(...segments: string[]): string {
  return path.join(smokeDir, 'fixtures', ...segments);
}

export function referenceTilesetPackPath(): string {
  return path.resolve(desktopRoot, '../../packages/test-fixtures/fixtures/asset-packs/smoke-pack');
}

export function battleRoyalePluginPath(): string {
  return path.resolve(desktopRoot, '../../packages/plugin-battle-royale');
}

export function resolveBattleRoyaleInstallPath(): string {
  return battleRoyalePluginPath();
}

let smokeBundlesBuilt = false;

function buildSmokeBundles(): void {
  if (smokeBundlesBuilt) {
    return;
  }
  for (const config of ['vite.main.config.ts', 'vite.preload.config.ts', 'vite.renderer.config.ts']) {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--config', config], {
      cwd: desktopRoot,
      stdio: 'inherit',
    });
  }
  smokeBundlesBuilt = true;
}

export function resolveMainEntry(): string {
  buildSmokeBundles();
  const mainEntry = path.join(desktopRoot, '.vite/build/main.cjs');
  if (!existsSync(mainEntry)) {
    throw new Error(
      'Desktop main bundle missing at .vite/build/main.cjs. Run `pnpm --filter @tileborne/desktop build` first.',
    );
  }
  return mainEntry;
}

export async function createTileborneHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'tileborne-smoke-home-'));
}

export async function launchElectron(tileborneHome: string): Promise<SmokeContext> {
  const userDataDir = path.join(tileborneHome, 'electron-user-data');
  const env = {
    ...process.env,
    TILEBORNE_HOME: tileborneHome,
    ...SMOKE_ELECTRON_ENV,
  };
  delete env.TILEBORNE_REMOTE_DEBUGGING_PORT;

  const app = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`, resolveMainEntry()],
    cwd: desktopRoot,
    env,
  });

  const page = await waitForAppPage(app);
  await page.waitForLoadState('domcontentloaded');

  return { app, page, tileborneHome };
}

export async function disposeSmokeContext(context: SmokeContext | undefined): Promise<void> {
  if (!context) {
    return;
  }
  await context.app.close().catch(() => undefined);
  await rm(context.tileborneHome, { recursive: true, force: true }).catch(() => undefined);
}

export async function navigateToRoute(page: Page, routePath: string): Promise<void> {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  await page.evaluate((hashPath) => {
    window.location.hash = hashPath;
  }, normalized);
  await page.waitForLoadState('domcontentloaded');
}

export async function waitForJob(
  page: Page,
  jobId: string,
  timeoutMs = 60_000,
): Promise<{ status: string; errorMessage?: string }> {
  return page.evaluate(
    async ({ id, timeout }) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const { job } = await window.tileborne.jobs.get({ jobId: id });
        if (job.status === 'Completed' || job.status === 'Failed' || job.status === 'Cancelled') {
          return { status: job.status, errorMessage: job.errorMessage };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`job timed out: ${id}`);
    },
    { id: jobId, timeout: timeoutMs },
  );
}

export async function readProjectManifest(tileborneHome: string, projectId: string) {
  const filePath = path.join(tileborneHome, 'projects', projectId, 'project.json');
  return JSON.parse(await readFile(filePath, 'utf8')) as { name: string; id: string };
}

export async function readMapJson(tileborneHome: string, projectId: string, mapId: string) {
  const filePath = path.join(tileborneHome, 'projects', projectId, 'maps', `${mapId}.json`);
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
}

export function pluginInstallDirectory(tileborneHome: string): string {
  return path.join(
    tileborneHome,
    'plugins',
    `${encodeURIComponent(FIXTURE_PLUGIN_ID)}-0.1.0`,
  );
}

export function exportManifestPath(tileborneHome: string, exportId: string): string {
  return path.join(tileborneHome, 'cache', 'exports', exportId, 'manifest.json');
}

export async function tileIndexAt(
  page: Page,
  projectId: string,
  mapId: string,
  tileX: number,
  tileY: number,
): Promise<number | undefined> {
  return page.evaluate(
    async ({ projectId: pid, mapId: mid, x, y }) => {
      const { map } = await window.tileborne.maps.get({ projectId: pid, mapId: mid });
      const layer = map.layers.find((entry) => entry._tag === 'tile');
      if (!layer || layer._tag !== 'tile') {
        return undefined;
      }
      const chunkSize = 32;
      const chunkX = Math.floor(x / chunkSize) * chunkSize;
      const chunkY = Math.floor(y / chunkSize) * chunkSize;
      const chunk = layer.chunks.find((entry) => entry.x === chunkX && entry.y === chunkY);
      if (!chunk) {
        return 0;
      }
      const localX = x - chunkX;
      const localY = y - chunkY;
      return chunk.tiles[localY * chunk.width + localX];
    },
    { projectId, mapId, x: tileX, y: tileY },
  );
}

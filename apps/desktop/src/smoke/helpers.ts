import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { gameObjectTypeIdForKey } from '@tileborne/core';
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale';

const smokeDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(smokeDir, '../..');

export const FIXTURE_PLUGIN_ID = '@tileborne-plugins/smoke-fixture';
export const FIXTURE_PACK_ID = 'pack:550e8400-e29b-41d4-a716-446655440001';
export const SAMPLE_ASSET_PACK_ID = 'pack:550e8400-e29b-41d4-a716-446655440099';
export const BATTLE_ROYALE_PLUGIN_ID = PLUGIN_ID;
export const EXAMPLE_ARENA_PLUGIN_ID = '@tileborne-plugins/example-arena';
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

export async function waitForStartupCompletion(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    async () => {
      const snapshot = await window.tileborneStartup.getStatus();
      return snapshot.state !== 'starting';
    },
    undefined,
    { timeout: timeoutMs },
  );
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

export function resolveExampleArenaInstallPath(): string {
  return path.resolve(desktopRoot, '../../packages/plugin-example-arena');
}

let smokeBundlesBuilt = false;

function buildSmokeBundles(): void {
  if (smokeBundlesBuilt) {
    return;
  }
  for (const config of [
    'vite.main.config.ts',
    'vite.preload.config.ts',
    'vite.renderer.config.ts',
  ]) {
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

export async function launchElectron(
  tileborneHome: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<SmokeContext> {
  const userDataDir = path.join(tileborneHome, 'electron-user-data');
  const env = {
    ...process.env,
    TILEBORNE_HOME: tileborneHome,
    ...SMOKE_ELECTRON_ENV,
    ...extraEnv,
  };
  delete env.TILEBORNE_REMOTE_DEBUGGING_PORT;

  const app = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`, resolveMainEntry()],
    cwd: desktopRoot,
    env,
  });

  const page = await waitForAppPage(app);
  await page.waitForLoadState('domcontentloaded');
  // IPC becomes available before optional bundled-content seeding completes.
  // Smoke mutations must not race plugin installation and asset-pack import.
  await waitForStartupCompletion(page);

  return { app, page, tileborneHome };
}

export async function closeSmokeApp(context: SmokeContext): Promise<void> {
  const closed = context.app.waitForEvent('close', { timeout: 10_000 });
  await context.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await closed;
}

export async function disposeSmokeContext(context: SmokeContext | undefined): Promise<void> {
  if (!context) {
    return;
  }
  await closeSmokeApp(context);
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

export async function addBattleRoyaleSpawnAnchors(
  page: Page,
  projectId: string,
  mapId: string,
  count = 4,
): Promise<void> {
  const spawnKind = gameObjectTypeIdForKey('spawn-point');
  const shrinkKind = gameObjectTypeIdForKey('shrink-zone-anchor');
  const lootKind = gameObjectTypeIdForKey('loot-crate');
  // Drive the raw wire transport instead of the typed bridge: this helper
  // edits the map as plain wire JSON (the maps:update request's encoded
  // side), which is exactly what the renderer client puts on the channel.
  await page.evaluate(
    async ({ pid, mid, kind, shrinkAnchorKind, lootCrateKind, anchorCount }) => {
      type WireLayer = {
        readonly id: string;
        readonly kind: string;
        readonly objectIds?: readonly string[];
      };
      type WireMap = {
        readonly layers: readonly WireLayer[];
        readonly objects: readonly Record<string, unknown>[];
        readonly properties: Record<string, unknown>;
      };
      const failIfIpcError = (response: unknown, channel: string): void => {
        if (
          typeof response === 'object' &&
          response !== null &&
          '_tag' in response &&
          String((response as { _tag: unknown })._tag).endsWith('Error')
        ) {
          throw new Error(`${channel} failed: ${JSON.stringify(response)}`);
        }
      };
      try {
        const got = (await window.tileborneIpc.invoke('tileborne:maps:get', {
          projectId: pid,
          mapId: mid,
        })) as { readonly map?: WireMap };
        failIfIpcError(got, 'tileborne:maps:get');
        const persisted = got.map;
        if (!persisted) {
          throw new Error('tileborne:maps:get returned no map');
        }
        const objectLayer =
          persisted.layers.find((layer) => layer.kind === 'object') ?? persisted.layers[0];
        if (!objectLayer) {
          throw new Error('Map has no layer for BR spawn anchors');
        }
        const anchors = Array.from({ length: anchorCount }, (_, index) => {
          const uuid = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
          return {
            id: `object:${uuid}`,
            kind,
            x: 64 + index * 48,
            y: 80 + index * 32,
            layerId: objectLayer.id,
            properties: { team: 'solo', weight: 1 },
          };
        });
        const requiredModeObjects = [
          ...anchors,
          {
            id: 'object:00000000-0000-4000-8000-000000000900',
            kind: shrinkAnchorKind,
            x: 256,
            y: 256,
            layerId: objectLayer.id,
            properties: { initialRadiusTiles: 20, finalRadiusTiles: 4 },
          },
          {
            id: 'object:00000000-0000-4000-8000-000000000901',
            kind: lootCrateKind,
            x: 192,
            y: 192,
            layerId: objectLayer.id,
            properties: { itemKind: 'health-pack', tier: 'common', weight: 1 },
          },
        ];
        const anchorIds = new Set(requiredModeObjects.map((anchor) => anchor.id));
        const nextLayers = persisted.layers.map((layer) =>
          layer.id === objectLayer.id && Array.isArray(layer.objectIds)
            ? {
                ...layer,
                objectIds: [...layer.objectIds.filter((id) => !anchorIds.has(id)), ...anchorIds],
              }
            : layer,
        );
        const updated = await window.tileborneIpc.invoke('tileborne:maps:update', {
          projectId: pid,
          map: {
            ...persisted,
            layers: nextLayers,
            objects: [
              ...persisted.objects.filter((object) => !anchorIds.has(String(object.id))),
              ...requiredModeObjects,
            ],
            properties: { ...persisted.properties, maxPlayers: anchorCount },
          },
        });
        failIfIpcError(updated, 'tileborne:maps:update');
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        throw new Error(message, { cause: error });
      }
    },
    {
      pid: projectId,
      mid: mapId,
      kind: spawnKind,
      shrinkAnchorKind: shrinkKind,
      lootCrateKind: lootKind,
      anchorCount: count,
    },
  );
}

/**
 * Persist the project's active game mode (ADR-0023). The bundled seed installs
 * multiple game-mode plugins (battle royale + example arena), so playtest
 * acceptance flows must select one explicitly — exactly like a user would via
 * the active-game-mode picker.
 */
export async function setProjectActiveGameMode(
  page: Page,
  projectId: string,
  modeId: string,
): Promise<void> {
  await page.evaluate(
    async ({ pid, mode }) => {
      const got = (await window.tileborneIpc.invoke('tileborne:projects:get', {
        projectId: pid,
      })) as { readonly project?: Record<string, unknown> };
      if (!got.project) {
        throw new Error(`tileborne:projects:get returned no project: ${JSON.stringify(got)}`);
      }
      const settings = {
        ...(got.project.settings as Record<string, unknown> | undefined),
        activeGameMode: mode,
      };
      const updated = await window.tileborneIpc.invoke('tileborne:projects:update', {
        project: { ...got.project, settings },
      });
      if (
        typeof updated === 'object' &&
        updated !== null &&
        '_tag' in updated &&
        String((updated as { _tag: unknown })._tag).endsWith('Error')
      ) {
        throw new Error(`tileborne:projects:update failed: ${JSON.stringify(updated)}`);
      }
    },
    { pid: projectId, mode: modeId },
  );
}

export function pluginInstallDirectory(tileborneHome: string): string {
  return path.join(tileborneHome, 'plugins', `${encodeURIComponent(FIXTURE_PLUGIN_ID)}-0.1.0`);
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

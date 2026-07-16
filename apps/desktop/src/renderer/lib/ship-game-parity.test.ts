import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const rendererRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = path.resolve(rendererRoot, '..');

const source = (relativePath: string) => readFile(path.join(rendererRoot, relativePath), 'utf8');

describe('Ship Game entry-point parity', () => {
  it.each([
    'components/shell/top-bar.tsx',
    'components/shell/command-palette.tsx',
    'routes/project-overview-page.tsx',
  ])('%s opens the shared guided workflow without invoking a build directly', async (file) => {
    const text = await source(file);
    expect(text).toContain('setShipGameDialogOpen(true)');
    expect(text).not.toContain('window.tileborne.ship.start');
    expect(text).not.toContain('useStartBuild');
  });

  it('keeps package assembly in the canonical main/build service path', async () => {
    const dialog = await source('components/ship-game-dialog.tsx');
    const handlers = await readFile(path.join(desktopRoot, 'main/ipc/handlers.ts'), 'utf8');
    expect(dialog).toContain('window.tileborne.ship.start');
    expect(dialog).not.toContain('GameBuildOptions');
    expect(handlers).toContain('builds.buildGame(');
    expect(handlers).toContain('new GameBuildOptions(');
    expect(handlers).not.toContain('tileborne game build --target');
  });

  it('ships binary-backed build dependencies with the production desktop app', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(desktopRoot, '..', 'package.json'), 'utf8'),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };
    const runtimeClosurePackageJson = JSON.parse(
      await readFile(
        path.join(desktopRoot, '..', '..', 'desktop-runtime-closure', 'package.json'),
        'utf8',
      ),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };
    const viteMain = await readFile(path.join(desktopRoot, '..', 'vite.main.config.ts'), 'utf8');
    const forgeConfig = await readFile(
      path.join(desktopRoot, '..', 'electron-forge.config.cjs'),
      'utf8',
    );

    expect(packageJson.dependencies).toMatchObject({
      '@tileborne/game-host': 'workspace:*',
      esbuild: '0.28.1',
      miniflare: '4.20260603.0',
    });
    expect(runtimeClosurePackageJson.dependencies).toEqual({
      esbuild: '0.28.1',
      miniflare: '4.20260603.0',
    });
    expect(viteMain).not.toContain("'@tileborne/services-build'");
    expect(viteMain).not.toContain("'@tileborne/services-build/local-game-host'");
    expect(viteMain).not.toContain("'@tileborne/game-host/build'");
    expect(viteMain).toContain("'esbuild'");
    expect(viteMain).toContain("'miniflare'");
    expect(forgeConfig).toContain('"@tileborne/desktop-runtime-closure"');
    expect(forgeConfig).toContain('packageAfterPrune');
    expect(forgeConfig).toContain('deployPackagedRuntimeClosure(buildPath)');
    expect(forgeConfig).toContain('assertPackagedRuntimeClosure(buildPath)');
  });
});

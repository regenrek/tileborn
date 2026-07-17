import { describe, expect, it } from 'vitest';
import type { ConfigEnv, UserConfig } from 'vite';

import rendererConfig from '../../../vite.renderer.config';

const importModule = (specifier: string): Promise<Record<string, unknown>> =>
  import(specifier) as Promise<Record<string, unknown>>;

const browserSafeInternalPackages = [
  '@tileborne/core',
  '@tileborne/game-client',
  '@tileborne/sdk-tileset',
  '@tileborne/ui',
] as const;
const browserSafePluginSubpaths = [
  '@tileborne/plugin-battle-royale/authoring',
  '@tileborne/plugin-battle-royale/constants',
  '@tileborne/plugin-battle-royale/player-models',
  '@tileborne/plugin-battle-royale/renderer',
] as const;

const nodeGraphInternalPackages = [
  '@tileborne/runtime',
  '@tileborne/plugin-api',
  '@tileborne/ipc-contracts',
  '@tileborne/plugin-battle-royale',
  '@tileborne/services-app',
  '@tileborne/services-build',
  '@tileborne/services-foundation',
  '@tileborne/services-plugin',
  '@tileborne/asset-pipeline',
] as const;

type RendererConfigExport =
  | UserConfig
  | Promise<UserConfig>
  | ((env: ConfigEnv) => UserConfig | Promise<UserConfig>);

const resolveRendererConfig = async (): Promise<UserConfig> => {
  const configExport = rendererConfig as RendererConfigExport;
  const config =
    typeof configExport === 'function'
      ? configExport({
          command: 'serve',
          mode: 'development',
          isSsrBuild: false,
          isPreview: false,
        })
      : configExport;

  return Promise.resolve(config);
};

describe('Base UI renderer dependency boundary', () => {
  it('loads the Base UI entries and CJS shims used by the renderer graph', async () => {
    const [tileborneUi, baseUiDialog, syncExternalStoreShim, selectorShim] = await Promise.all([
      importModule('@tileborne/ui'),
      importModule('@base-ui/react/dialog'),
      importModule('use-sync-external-store/shim'),
      importModule('use-sync-external-store/shim/with-selector'),
    ]);

    const dialog = baseUiDialog.Dialog as { Root?: unknown } | undefined;

    expect(tileborneUi.Dialog).toBeTypeOf('function');
    expect(dialog?.Root).toBeTypeOf('function');
    expect(syncExternalStoreShim.useSyncExternalStore).toBeTypeOf('function');
    expect(selectorShim.useSyncExternalStoreWithSelector).toBeTypeOf('function');
  });

  it('keeps renderer dep optimization explicit for Base UI CJS interop', async () => {
    const config = await resolveRendererConfig();

    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(['react', 'react-dom']));
    expect(config.optimizeDeps?.exclude).toContain('@tileborne/ui');
    expect(config.optimizeDeps?.include).toEqual(
      expect.arrayContaining([
        '@base-ui/react',
        '@base-ui/react/dialog',
        '@base-ui/utils/store',
        'use-sync-external-store/shim',
        'use-sync-external-store/shim/with-selector',
      ]),
    );
  });

  it('only excludes browser-safe internal packages from renderer dep optimization', async () => {
    const config = await resolveRendererConfig();
    const exclude = config.optimizeDeps?.exclude ?? [];

    // Pure-browser packages can be served live; Node-graph packages must remain
    // pre-bundled so esbuild can tree-shake Node-only imports out of renderer code.
    expect(exclude).toEqual([...browserSafeInternalPackages, ...browserSafePluginSubpaths]);

    for (const packageName of nodeGraphInternalPackages) {
      expect(exclude).not.toContain(packageName);
    }
  });

  it('serves renderer-owned game-client UI from workspace source', async () => {
    const config = await resolveRendererConfig();
    const aliases = config.resolve?.alias;

    expect(aliases).toMatchObject({
      '@tileborne/game-client': expect.stringContaining('packages/game-client/src/index.ts'),
    });
  });
});

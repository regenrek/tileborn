import { describe, expect, it } from 'vitest';

import rendererConfig from '../../../vite.renderer.config';

const importModule = (specifier: string): Promise<Record<string, unknown>> =>
  import(specifier) as Promise<Record<string, unknown>>;

describe('Base UI renderer dependency boundary', () => {
  it('loads the Base UI entries and CJS shims used by the renderer graph', async () => {
    const [tileborneUi, baseUiDialog, syncExternalStoreShim, selectorShim] =
      await Promise.all([
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

  it('keeps renderer dep optimization explicit for Base UI CJS interop', () => {
    const config = rendererConfig as {
      optimizeDeps?: { exclude?: string[]; include?: string[] };
      resolve?: { dedupe?: string[] };
    };

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
});

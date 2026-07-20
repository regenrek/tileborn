import { describe, expect, it, vi } from 'vitest';

import { loadShippedShellProjection } from './shipped-shell.js';

describe('shipped shell bootstrap', () => {
  it('recovers from malformed shell.json with a diagnostic fallback projection', async () => {
    const loaded = await loadShippedShellProjection({
      mapId: 'map:fixture',
      fetchImpl: vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => {
              throw new Error('bad json');
            },
          }) as Response,
      ),
    });

    expect(loaded.projection.screens.some((screen) => screen.stableId === 'main-menu')).toBe(true);
    expect(loaded.projection.diagnostics.at(-1)).toMatchObject({
      path: 'maps/map-fixture/shell.json',
      message: 'Packaged shell.json is malformed; rendering the default shell.',
    });
  });
});

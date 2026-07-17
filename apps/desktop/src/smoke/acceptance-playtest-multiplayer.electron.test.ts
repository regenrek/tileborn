import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  resolveMainEntry,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: playtest multiplayer host', () => {
  let smokeContext: SmokeContext | undefined;

  beforeAll(async () => {
    resolveMainEntry();
    smokeContext = await launchElectron(await createTileborneHome());
  }, 60_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('exposes multiplayer host/join IPC on the renderer bridge', async () => {
    const { page } = smokeContext!;

    const capabilities = await page.evaluate(() => ({
      startLocalHost: typeof window.tileborne.runtime.startLocalHost,
      stopLocalHost: typeof window.tileborne.runtime.stopLocalHost,
      openPlaytestJoinWindow: typeof window.tileborne.system.openPlaytestJoinWindow,
    }));

    expect(capabilities).toEqual({
      startLocalHost: 'function',
      stopLocalHost: 'function',
      openPlaytestJoinWindow: 'function',
    });
  });
});

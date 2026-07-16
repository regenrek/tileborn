import { describe, expect, it } from 'vitest';

import { spawnCli } from './helpers/spawn-cli.js';
import { registerE2eHomeHooks } from './helpers/temp-home.js';

describe.sequential('game serve e2e', () => {
  registerE2eHomeHooks();

  it('boots local host, serves health, and exits 0 on SIGINT', async () => {
    const handle = spawnCli(['game', 'serve', '--port', '0', '--json'], {
      env: { TILEBORNE_LOG_LEVEL: 'silent' },
    });

    await handle.waitForOutput(/"baseUrl"\s*:\s*"([^"]+)"/);

    const payload = JSON.parse(handle.stdout.trim()) as {
      readonly ok: boolean;
      readonly data: { readonly baseUrl: string; readonly signingKeyFingerprint: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(payload.data.signingKeyFingerprint).toMatch(/^[0-9a-f]{12}$/);

    const health = await fetch(`${payload.data.baseUrl}/health`);
    expect(health.status).toBe(200);

    handle.kill('SIGINT');
    const exitCode = await Promise.race([
      handle.exited,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error('process did not exit within 3s')), 3_000),
      ),
    ]);
    expect(exitCode).toBe(0);
  }, 30_000);
});

import { describe, expect, it } from 'vitest';

import { initHomeProject } from './helpers/fixtures.js';
import { expectCliJsonData } from './helpers/run-cli.js';
import { spawnCli } from './helpers/spawn-cli.js';
import { registerE2eHomeHooks } from './helpers/temp-home.js';

describe.sequential('playtest multiplayer e2e', () => {
  registerE2eHomeHooks();

  it('boots local host, prints wsUrl, serves health, and exits 0 on SIGINT', async () => {
    const { projectSlug } = await initHomeProject('mp-proj');
    const generated = await expectCliJsonData<{ readonly mapId: string }>([
      'map',
      'generate',
      'mp-map',
      '--width',
      '8',
      '--height',
      '8',
      '--project',
      projectSlug,
    ]);

    const handle = spawnCli(
      [
        'playtest',
        generated.mapId,
        '--multiplayer',
        '--port',
        '0',
        '--project',
        projectSlug,
        '--json',
      ],
      { env: { TILEBORNE_LOG_LEVEL: 'silent' } },
    );

    const match = await handle.waitForOutput(/"wsUrl"\s*:\s*"([^"]+)"/);
    const wsUrl = match[1];
    expect(wsUrl).toMatch(/^ws:\/\//);

    const payload = JSON.parse(handle.stdout.trim()) as {
      readonly ok: boolean;
      readonly data: { readonly baseUrl: string; readonly wsUrl: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.wsUrl).toBe(wsUrl);

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

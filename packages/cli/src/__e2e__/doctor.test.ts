import { describe, expect, it } from 'vitest';

import { runCli } from './helpers/run-cli.js';
import { registerE2eHomeHooks } from './helpers/temp-home.js';

describe.sequential('doctor e2e', () => {
  registerE2eHomeHooks();

  it('doctor --json exits 0 with node, pnpm, home, and config checks', async () => {
    const result = await runCli(['doctor'], { json: true });
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly checks: readonly { readonly id: string }[];
    };
    expect(payload.ok).toBe(true);
    const ids = payload.checks.map((check) => check.id);
    expect(ids).toContain('node');
    expect(ids).toContain('pnpm');
    expect(ids).toContain('home');
    expect(ids).toContain('config');
  });
});

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('live CDP walkthrough multiplayer selectors', () => {
  it('uses the current HUD alive-count contract for multiplayer player assertions', async () => {
    const source = await readFile(new URL('./live-cdp-walkthrough.mjs', import.meta.url), 'utf8');

    expect(source).not.toContain('playtest-multiplayer-player-count');
    expect(source).toContain('playtest-hud-overlay');
    expect(source).toContain('playtest-hud-alive-count');
  });

  it('verifies a mounted Pixi canvas inside the multiplayer surface', async () => {
    const source = await readFile(new URL('./live-cdp-walkthrough.mjs', import.meta.url), 'utf8');

    expect(source).toContain('canvas[data-testid="playtest-multiplayer-canvas"]');
    expect(source).toContain('[data-testid="playtest-multiplayer-canvas"] canvas');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  resolveMainEntry,
  type SmokeContext,
} from './helpers.js';

/** Console noise that does not indicate a renderer boot failure. */
const ALLOWED_CONSOLE_PATTERNS = [/Electron Security Warning/i];

type ConsoleEntry = {
  readonly type: string;
  readonly text: string;
};

function isAllowedConsoleMessage(text: string): boolean {
  return ALLOWED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

describe('renderer boot health (Playwright Electron via vitest)', () => {
  let smokeContext: SmokeContext | undefined;
  const consoleMessages: ConsoleEntry[] = [];

  beforeAll(async () => {
    resolveMainEntry();
    const tileborneHome = await createTileborneHome();
    smokeContext = await launchElectron(tileborneHome);

    for (const page of smokeContext.app.windows()) {
      page.on('console', (message) => {
        const type = message.type();
        if (type === 'error' || type === 'warning') {
          consoleMessages.push({ type, text: message.text() });
        }
      });
    }
  }, 60_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('initializes window.tileborne bridge with no renderer console errors', async () => {
    const { page } = smokeContext!;

    await expect.poll(async () => page.title(), { timeout: 10_000 }).toMatch(/Tileborne/i);

    expect(await page.evaluate(() => typeof window.tileborne)).toBe('object');
    expect(await page.evaluate(() => typeof window.tileborne.events)).toBe('object');
    expect(await page.evaluate(() => typeof window.tileborne.events.onProjectsChanged)).toBe(
      'function',
    );

    const errors = consoleMessages.filter(
      (entry) => entry.type === 'error' && !isAllowedConsoleMessage(entry.text),
    );
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
  });
});

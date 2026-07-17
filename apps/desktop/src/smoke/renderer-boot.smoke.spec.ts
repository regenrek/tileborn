import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

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

describe('renderer boot health', () => {
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
  });

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('renderer initializes with window.tileborne bridge and no console errors', async () => {
    const { page } = smokeContext!;

    await expect(page).toHaveTitle(/Tileborne/i, { timeout: 10_000 });

    const tileborneType = await page.evaluate(() => typeof window.tileborne);
    expect(tileborneType, 'window.tileborne must be an object').toBe('object');

    const eventsType = await page.evaluate(() => typeof window.tileborne.events);
    expect(eventsType, 'window.tileborne.events must be an object').toBe('object');

    const onProjectsChangedType = await page.evaluate(
      () => typeof window.tileborne.events.onProjectsChanged,
    );
    expect(
      onProjectsChangedType,
      'window.tileborne.events.onProjectsChanged must be a function',
    ).toBe('function');

    const errors = consoleMessages.filter(
      (entry) => entry.type === 'error' && !isAllowedConsoleMessage(entry.text),
    );
    expect(
      errors,
      `Unexpected renderer console errors:\n${errors.map((e) => `[${e.type}] ${e.text}`).join('\n')}`,
    ).toEqual([]);
  });
});

import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const chromeExecutablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const configFile = fileURLToPath(new URL('../vitest.config.ts', import.meta.url));

const server = await createServer({
  configFile,
  root: appRoot,
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
  },
});

await server.listen();
const baseUrl = server.resolvedUrls?.local[0];
if (baseUrl === undefined) {
  await server.close();
  throw new Error('Vite did not expose a local URL');
}

const browser = await chromium.launch({
  ...(existsSync(chromeExecutablePath) ? { executablePath: chromeExecutablePath } : {}),
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => {
  consoleErrors.push(error.message);
});

try {
  await page.goto(`${baseUrl}src/test/accepted-fire-browser-smoke.html`);
  await page.getByTestId('br-quick-play').click();
  await page.getByTestId('create-lobby').click();
  await page.getByTestId('ready-toggle').click();
  await page.getByTestId('start-match').click();
  await page.waitForFunction(() => window.tileborneSmoke?.socketUrl() !== undefined);
  await page.evaluate(() => window.tileborneSmoke.emitAcceptedFireFlow());
  await page.waitForFunction(() => window.tileborneSmoke.sentCount() >= 1);
  await page.waitForFunction(
    () => JSON.stringify(window.tileborneSmoke.muzzleIds()) === '["br:muzzle:player-1","br:muzzle:player-2"]',
  );
  const acceptedMuzzles = await page.evaluate(() => window.tileborneSmoke.muzzleSnapshot());
  if (new Set(acceptedMuzzles.map((entry) => entry.spriteOrdinal)).size !== 2) {
    throw new Error(`expected distinct muzzle sprites, received ${JSON.stringify(acceptedMuzzles)}`);
  }
  const expected = [
    { id: 'br:muzzle:player-1', x: 17.64, y: 0, width: 48, height: 48 },
    { id: 'br:muzzle:player-2', x: 10, y: 27.64, width: 48, height: 48 },
  ];
  for (const [index, actual] of acceptedMuzzles.entries()) {
    const target = expected[index];
    if (
      actual.id !== target.id ||
      Math.abs(actual.x - target.x) > 0.01 ||
      Math.abs(actual.y - target.y) > 0.01 ||
      actual.width !== target.width ||
      actual.height !== target.height
    ) {
      throw new Error(`unexpected muzzle ${index}: ${JSON.stringify(actual)}`);
    }
  }
  await page.evaluate(() => window.tileborneSmoke.emitReplayFlow());
  await page.waitForFunction(() => JSON.stringify(window.tileborneSmoke.muzzleIds()) === '[]');
  if (consoleErrors.length > 0) {
    throw new Error(`browser console errors: ${consoleErrors.join('\\n')}`);
  }
  console.log('accepted fire browser render smoke passed: 2 muzzle sprites rendered, replay removed them');
} finally {
  await browser.close();
  await server.close();
}

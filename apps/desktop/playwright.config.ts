// Electron launch is implemented in src/smoke/helpers.ts → launchElectron (not Playwright's built-in browser).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

if (process.env.TILEBORNE_E2E !== '1') {
  process.env.TILEBORNE_E2E = '1';
}

// Never inherit the orchestrator dev CDP port — smoke Electron runs isolated.
delete process.env.TILEBORNE_REMOTE_DEBUGGING_PORT;

export default defineConfig({
  testDir: path.join(desktopRoot, 'src/smoke'),
  testMatch: '**/*.smoke.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});

// Smoke beforeAll Electron boot timeout: set TILEBORNE_SMOKE_LAUNCH_TIMEOUT_MS (ms) in the environment.

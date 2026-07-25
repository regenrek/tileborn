import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker.ts',
      miniflare: {
        compatibilityDate: '2024-12-01',
        bindings: {
          HANDOFF_SIGNING_KEY: 'smoke-handoff-signing-key-32-bytes-x',
          ROOM_IDLE_TIMEOUT_SECONDS: '1',
        },
        durableObjects: {
          PLAYTEST_ROOM: {
            className: 'PlaytestRoom',
            useSQLite: true,
          },
        },
      },
    }),
  ],
  define: {
    __WORKER_VERSION__: JSON.stringify('0.0.0-smoke'),
    __BUILD_ID__: JSON.stringify(
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    ),
    __SMOKE_CONTROL_ENABLED__: JSON.stringify(true),
  },
  test: {
    include: ['src/smoke/cloudflare-cold-wake.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    globalSetup: ['src/smoke/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

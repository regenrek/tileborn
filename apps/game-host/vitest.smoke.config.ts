import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/smoke/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/smoke/cloudflare-cold-wake.test.ts'],
    globalSetup: ['src/smoke/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

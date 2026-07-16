import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__e2e__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    globalSetup: ['./src/__e2e__/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // These tests launch real CLI/host processes. Unbounded file workers can
    // starve a cold multiplayer host before it emits its startup JSON.
    maxWorkers: 4,
    sequence: { concurrent: false },
  },
});

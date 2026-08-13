import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__e2e__/**/*.test.ts'],
    // The spec §12 sweep is owned by the regular CLI suite, which also keeps
    // its process-heavy tests serialized. Do not execute it again here.
    exclude: ['dist/**', 'node_modules/**', 'src/__e2e__/spec-section-12-sweep.test.ts'],
    globalSetup: ['./src/__e2e__/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // These tests launch real CLI/host processes. Unbounded file workers can
    // starve a cold multiplayer host before it emits its startup JSON.
    maxWorkers: 4,
    sequence: { concurrent: false },
  },
});

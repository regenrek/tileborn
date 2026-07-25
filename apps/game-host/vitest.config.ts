import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __WORKER_VERSION__: JSON.stringify('0.0.0-dev'),
    __BUILD_ID__: JSON.stringify(
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    ),
    __SMOKE_CONTROL_ENABLED__: JSON.stringify(false),
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/smoke/**'],
    // Several tests intentionally regenerate the shared bundled-module inputs
    // while others mock that same boundary. Keep files serial so those real
    // build fixtures cannot race each other or starve esbuild on CI runners.
    fileParallelism: false,
  },
});

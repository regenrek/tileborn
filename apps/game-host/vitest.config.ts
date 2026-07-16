import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __WORKER_VERSION__: JSON.stringify('0.0.0-dev'),
    __BUILD_ID__: JSON.stringify(
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    ),
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/smoke/**'],
  },
});

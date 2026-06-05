import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0'),
    __GIT_COMMIT__: JSON.stringify('test'),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/renderer'),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'src/main/**/*.test.ts',
      'src/preload/**/*.test.ts',
      'src/renderer/**/*.test.ts',
      'src/renderer/**/*.test.tsx',
      'src/smoke/**/*.test.ts',
    ],
    exclude: [
      'src/smoke/**/*.electron.test.ts',
      'src/smoke/**/*.smoke.spec.ts',
      'src/smoke/renderer-boot.test.ts',
    ],
  },
});

import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const resolveSrc = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@tileborne/core': resolveSrc('../core/src/index.ts'),
      '@tileborne/ipc-contracts': resolveSrc('../ipc-contracts/src/index.ts'),
      '@tileborne/plugin-api/project-content': resolveSrc('../plugin-api/src/project-content.ts'),
      '@tileborne/plugin-api': resolveSrc('../plugin-api/src/index.ts'),
      '@tileborne/ui': resolveSrc('../ui/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});

import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const resolveSrc = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    __SMOKE_CONTROL_ENABLED__: JSON.stringify(false),
  },
  resolve: {
    alias: {
      '@tileborne/game-client/styles/menu.css': resolveSrc(
        '../../packages/game-client/src/styles/menu.css',
      ),
      '@tileborne/game-client': resolveSrc('../../packages/game-client/src/index.ts'),
      '@tileborne/plugin-battle-royale/menu': resolveSrc(
        '../../packages/plugin-battle-royale/src/menu/index.tsx',
      ),
      '@tileborne/core': resolveSrc('../../packages/core/src/index.ts'),
      '@tileborne/ipc-contracts/protocols/battle-royale': resolveSrc(
        '../../packages/ipc-contracts/src/protocols/battle-royale.ts',
      ),
      '@tileborne/ipc-contracts': resolveSrc('../../packages/ipc-contracts/src/index.ts'),
      '@tileborne/plugin-api/project-content': resolveSrc(
        '../../packages/plugin-api/src/project-content.ts',
      ),
      '@tileborne/plugin-api': resolveSrc('../../packages/plugin-api/src/index.ts'),
      '@tileborne/runtime/net': resolveSrc('../../packages/runtime/src/net/index.ts'),
      '@tileborne/ui': resolveSrc('../../packages/ui/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});

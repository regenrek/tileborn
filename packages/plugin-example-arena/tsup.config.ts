import { defineConfig } from 'tsup';

// Minimal two-entry build mirroring plugin-battle-royale's runtime/index shape:
// `runtime` is the worker-safe simulation adapter (browser target, @tileborne/core
// + @tileborne/simulation bundled in), `index`/`constants` are the node-facing
// entry points consumers import. The editor/server/menu entries BR ships are
// intentionally omitted — this example proves discovery + contract decode only.
export default defineConfig([
  {
    entry: { runtime: 'src/runtime-bundle.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    dts: false,
    noExternal: ['@tileborne/core', '@tileborne/simulation', 'effect'],
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    dts: false,
    noExternal: ['@tileborne/core', '@tileborne/simulation'],
  },
  {
    entry: { constants: 'src/constants.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    dts: false,
  },
]);

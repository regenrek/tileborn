import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { server: 'src/server-entry.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    dts: false,
    // `@tileborne/plugin-api` (+ its pure dep `@tileborne/asset-pipeline`) must
    // be inlined: the installed plugin's dist/server.js is imported by the
    // desktop main process out-of-tree, where workspace packages don't resolve
    // (ADR-0030 mode-data exporter pulls ModeDataExportError at runtime).
    noExternal: [
      '@tileborne/asset-pipeline',
      '@tileborne/core',
      '@tileborne/ipc-contracts',
      '@tileborne/plugin-api',
      '@tileborne/simulation',
      'effect',
    ],
  },
  {
    entry: { runtime: 'src/runtime-bundle.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    dts: false,
    noExternal: ['@tileborne/core', '@tileborne/ipc-contracts', '@tileborne/simulation', 'effect'],
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
    // Executable React menu sections (ADR-0004), bundled for the shipped game
    // client. React + UI + game-client stay external (provided by the app).
    entry: { menu: 'src/menu/index.tsx' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    dts: false,
    external: [
      'react',
      'react-dom',
      '@tileborne/ui',
      '@tileborne/game-client',
      '@tileborne/plugin-api',
    ],
  },
  {
    // Editor-facing authoring contributions consumed by the desktop renderer
    // (player-model roster schema + selection policy + palette/object authoring
    // presentation). @tileborne/core + effect stay external so the renderer's
    // single core instance backs all schema classes (e.g. PlayerModelRef
    // instanceof checks); React/UI/icons are provided by the app.
    entry: { authoring: 'src/authoring/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    dts: false,
    external: ['react', 'react-dom', '@tileborne/ui', '@tileborne/core', 'effect', 'lucide-react'],
  },
  {
    // Browser-only playtest renderer bridge consumed by the desktop renderer.
    // Keep this separate from the package root so Vite never has to prebundle
    // the BR Node/server graph just to get projector/input/asset exports.
    entry: { renderer: 'src/renderer/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    dts: false,
    external: ['@tileborne/core', '@tileborne/ipc-contracts', '@tileborne/runtime', 'effect'],
  },
  {
    // Player-model concerns consumed by the desktop renderer (canonical model
    // identity + roster schema + selection policy + loadout). @tileborne/core +
    // effect stay external so the renderer's single core instance backs all
    // schema classes (PlayerModelRef instanceof across the bundle boundary).
    entry: { 'player-models': 'src/player-models/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    sourcemap: true,
    dts: false,
    external: ['@tileborne/core', 'effect'],
  },
  {
    // Dependency-free canonical constants (PLUGIN_ID, ZONE defaults, object
    // kinds). Lightweight entry so consumers can read the canonical ids/defaults
    // without pulling the runtime/renderer code in the main index.
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

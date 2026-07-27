import { builtinModules } from 'node:module';

import { defineConfig } from 'vite';

import { cjsImportMetaUrl } from './vite.cjs-import-meta-url.js';

const nodeBuiltins = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

// Runtime/provider packages that must stay real files for subprocesses,
// package resolution, or native binary closure. Pure workspace packages are
// bundled so a packaged app never resolves them by walking out of
// Contents/Resources and into a checkout. electron-forge.config.cjs deploys
// this exact external runtime closure after Packager pruning.
const externalPackages = ['alchemy', 'esbuild', 'miniflare'];
const configuredAppleTeamIdentifier =
  process.env.TILEBORNE_APPLE_TEAM_ID === undefined
    ? 'undefined'
    : JSON.stringify(process.env.TILEBORNE_APPLE_TEAM_ID);

export default defineConfig({
  plugins: [cjsImportMetaUrl()],
  define: {
    __TILEBORNE_APPLE_TEAM_ID__: configuredAppleTeamIdentifier,
  },
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    lib: {
      entry: 'src/main/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    rollupOptions: {
      external: [...nodeBuiltins, ...externalPackages],
      output: {
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name].cjs',
        format: 'cjs',
      },
    },
  },
});

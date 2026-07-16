import { builtinModules } from 'node:module';

import { defineConfig } from 'vite';

import { cjsImportMetaUrl } from './vite.cjs-import-meta-url.js';

const nodeBuiltins = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

// Only binary-backed runtimes stay external. Pure workspace/JavaScript
// packages are bundled so a packaged app never resolves them by walking out of
// Contents/Resources and into a checkout. electron-forge.config.cjs deploys
// this exact external runtime closure after Packager pruning.
const externalPackages = ['esbuild', 'miniflare'];

export default defineConfig({
  plugins: [cjsImportMetaUrl()],
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

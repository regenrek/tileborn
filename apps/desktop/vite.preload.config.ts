import { builtinModules } from 'node:module';

import { defineConfig } from 'vite';

import { cjsImportMetaUrl } from './vite.cjs-import-meta-url.js';

const nodeBuiltins = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  plugins: [cjsImportMetaUrl()],
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    lib: {
      entry: 'src/preload/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: nodeBuiltins,
      output: {
        format: 'cjs',
        inlineDynamicImports: true,
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name].cjs',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});

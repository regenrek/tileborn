import { builtinModules } from "node:module";

import { defineConfig } from "vite";

import { cjsImportMetaUrl } from "./vite.cjs-import-meta-url.js";

const nodeBuiltins = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

const externalPackages = ["miniflare"];
const workspacePackages = ["@tileborne/plugin-battle-royale"];

export default defineConfig({
  plugins: [cjsImportMetaUrl()],
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: "src/main/main.ts",
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    rollupOptions: {
      external: [...nodeBuiltins, ...externalPackages, ...workspacePackages],
      output: {
        entryFileNames: "[name].cjs",
        chunkFileNames: "[name].cjs",
        format: "cjs",
      },
    },
  },
});

import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { server: "src/server-entry.ts" },
    format: ["esm"],
    platform: "node",
    target: "node22",
    outDir: "dist",
    clean: true,
    sourcemap: true,
    dts: false,
    noExternal: ["@tileborne/core", "@tileborne/ipc-contracts", "effect"],
  },
  {
    entry: { runtime: "src/runtime-bundle.ts" },
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    outDir: "dist",
    clean: false,
    sourcemap: true,
    dts: false,
    noExternal: ["@tileborne/core", "@tileborne/ipc-contracts", "effect"],
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node22",
    outDir: "dist",
    clean: false,
    sourcemap: true,
    dts: false,
    noExternal: ["@tileborne/core"],
  },
]);

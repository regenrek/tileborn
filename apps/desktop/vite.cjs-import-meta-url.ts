import type { Plugin } from "vite";

/** CJS-safe runtime replacement for bundled `import.meta.url` in main/preload. */
const CJS_IMPORT_META_URL =
  'require("node:url").pathToFileURL(__filename).href';

/**
 * Electron main/preload bundles as CommonJS where Rollup/Vite may emit bare
 * `{}.url` (undefined) instead of resolving `import.meta.url`.
 */
export function cjsImportMetaUrl(): Plugin {
  return {
    name: "tileborne:cjs-import-meta-url",
    enforce: "pre",
    config() {
      return {
        define: {
          "import.meta.url": CJS_IMPORT_META_URL,
        },
      };
    },
    renderChunk(code, _chunk, options) {
      if (options.format !== "cjs") {
        return null;
      }

      let next = code;
      if (next.includes("import.meta.url")) {
        next = next.replaceAll("import.meta.url", CJS_IMPORT_META_URL);
      }
      if (next.includes("{}.url")) {
        next = next.replaceAll("{}.url", CJS_IMPORT_META_URL);
      }

      if (next === code) {
        return null;
      }
      return { code: next, map: null };
    },
  };
}

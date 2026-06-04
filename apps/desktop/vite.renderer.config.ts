import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const battleRoyalePluginPath = path.resolve(
  import.meta.dirname,
  "../../packages/plugin-battle-royale",
);

const packageJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"),
) as { version: string };

// Internal @tileborne/* packages change their export surface constantly during
// monorepo dev. Vite's dep optimizer snapshots a package's named exports into
// node_modules/.vite/deps and keys that cache off lockfile/config — not the
// workspace dist content — so a new export on e.g. @tileborne/core gets served
// stale ("does not provide an export named X") and blanks the renderer.
// Excluding a package keeps it out of the optimizer (served live), which is the
// correct monorepo dev boundary and the real fix for t-vups (replacing the
// blunt "clear .vite on every start" hack).
//
// IMPORTANT: only packages with a *pure browser* dependency graph may be
// excluded. Excluding a package serves its whole import graph live, so any
// transitive Node code reaches the browser and throws ("node:fs/promises has
// been externalized") => blank. The other internal packages (plugin-api,
// runtime, plugin-battle-royale, ipc-contracts, services-*) transitively pull
// @tileborne/asset-pipeline (Node/fs); they MUST stay pre-bundled so esbuild
// tree-shakes that Node-only code out. If a new renderer-used export on a
// pre-bundled package serves stale, run:
// pnpm --filter @tileborne/desktop clean:vite-deps
const browserSafeInternalPackages = [
  "@tileborne/core",
  "@tileborne/sdk-tileset",
  "@tileborne/ui",
] as const;

function resolveGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: path.resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

// Code-based router in src/renderer/router.tsx — @tanstack/router-plugin omitted until file-based routes land.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    __BATTLE_ROYALE_PLUGIN_PATH__: JSON.stringify(battleRoyalePluginPath),
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __GIT_COMMIT__: JSON.stringify(resolveGitCommit()),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/renderer"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // Browser-safe internal packages served live (never pre-bundled) so their
    // changing dev export surfaces are always current; Base UI's CJS shims below
    // and Node-graph internal packages must still be prebundled. See
    // browserSafeInternalPackages above (t-vups).
    exclude: [...browserSafeInternalPackages],
    include: [
      "@base-ui/react",
      "@base-ui/react/dialog",
      "@base-ui/utils/store",
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
  },
  root: path.resolve(import.meta.dirname, "src/renderer"),
  server: {
    // fsevents-based watching is unreliable in this electron-forge + Vite dev
    // setup (edits/HMR were intermittently missed, forcing full restarts).
    // Polling detects renderer source changes deterministically. Dev-only; the
    // watched root is `src/renderer` (node_modules is ignored by default), so
    // the polling cost is small.
    watch: {
      usePolling: true,
      interval: 120,
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, ".vite/renderer/main_window"),
    emptyOutDir: true,
  },
});

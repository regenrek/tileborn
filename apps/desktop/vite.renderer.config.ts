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
    // @tileborne/ui stays excluded for workspace CSS/HMR; Base UI's CJS shims must be prebundled.
    exclude: ["@tileborne/ui"],
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

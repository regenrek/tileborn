import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const resolveSrc = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

// Workspace source aliases so `vite dev`/`build` resolve the menu framework and
// plugin menu sections from source (no prior package build needed).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tileborne/game-client/styles/menu.css": resolveSrc(
        "../../packages/game-client/src/styles/menu.css",
      ),
      "@tileborne/game-client": resolveSrc("../../packages/game-client/src/index.ts"),
      "@tileborne/plugin-battle-royale/menu": resolveSrc(
        "../../packages/plugin-battle-royale/src/menu/index.tsx",
      ),
      "@tileborne/core": resolveSrc("../../packages/core/src/index.ts"),
      "@tileborne/plugin-api": resolveSrc("../../packages/plugin-api/src/index.ts"),
      "@tileborne/ui": resolveSrc("../../packages/ui/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

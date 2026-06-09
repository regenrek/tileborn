import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const resolveSrc = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

// Workspace source aliases so `vite dev`/`build` resolve the menu framework and
// plugin menu sections from source (no prior package build needed). Subpath
// aliases (css files) MUST precede the bare package aliases, otherwise the
// prefix rewrite produces broken paths like ".../src/index.ts/styles/...".
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@tileborne/game-client/styles/menu.css": resolveSrc(
        "../../packages/game-client/src/styles/menu.css",
      ),
      "@tileborne/game-client": resolveSrc("../../packages/game-client/src/index.ts"),
      "@tileborne/ui/styles/index.css": resolveSrc("../../packages/ui/src/styles/index.css"),
      "@tileborne/plugin-battle-royale/menu": resolveSrc(
        "../../packages/plugin-battle-royale/src/menu/index.tsx",
      ),
      "@tileborne/core": resolveSrc("../../packages/core/src/index.ts"),
      "@tileborne/ipc-contracts/protocols/battle-royale": resolveSrc(
        "../../packages/ipc-contracts/src/protocols/battle-royale.ts",
      ),
      "@tileborne/ipc-contracts": resolveSrc("../../packages/ipc-contracts/src/index.ts"),
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

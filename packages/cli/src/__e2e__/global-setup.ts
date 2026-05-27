import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repoRoot = path.resolve(packageRoot, "../..");
const gameHostRoot = path.join(repoRoot, "apps/game-host");

export default function globalSetup(): void {
  execSync("pnpm --filter @tileborne/cli build", {
    cwd: repoRoot,
    stdio: "inherit",
  });
  // CLI build pulls game-host through TS project references and overwrites dist/worker.js
  // with unbundled tsc output; rebundle for miniflare.
  execSync("node scripts/bundle-worker.mjs", {
    cwd: gameHostRoot,
    stdio: "inherit",
  });
}

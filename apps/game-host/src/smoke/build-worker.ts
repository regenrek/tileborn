import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build as esbuildBuild } from "esbuild";

import { smokeBundledManifest } from "./fixtures/smoke-manifest.js";

const gameHostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerEntry = path.join(gameHostRoot, "src/worker.ts");

export const smokeDistDir = path.join(gameHostRoot, "dist-smoke");

export const buildSmokeWorkerBundle = async (outDir: string = smokeDistDir): Promise<string> => {
  const manifest = smokeBundledManifest();
  const stagingDir = path.join(outDir, ".staging");
  await mkdir(stagingDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const stagingManifestPath = path.join(stagingDir, "runtime-manifest.ts");
  await writeFile(
    stagingManifestPath,
    `import type { BundledManifest } from "./types.js";

export const runtimeManifest: BundledManifest = ${JSON.stringify(manifest, null, 2)} as BundledManifest;
`,
    "utf8",
  );

  const workerPath = path.join(outDir, "worker.js");
  await esbuildBuild({
    entryPoints: [workerEntry],
    outfile: workerPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    external: ["cloudflare:*", "node:crypto", "node:fs", "node:fs/promises", "node:path", "node:url", "node:os"],
    define: {
      __WORKER_VERSION__: JSON.stringify(manifest.runtimeVersion),
      __BUILD_ID__: JSON.stringify(manifest.buildId),
    },
    plugins: [
      {
        name: "smoke-runtime-manifest-stub",
        setup(buildApi) {
          buildApi.onResolve({ filter: /runtime-manifest\.js$/ }, (args) => {
            if (args.importer.includes("game-host")) {
              return { path: stagingManifestPath };
            }
            return undefined;
          });
        },
      },
    ],
  });

  return workerPath;
};

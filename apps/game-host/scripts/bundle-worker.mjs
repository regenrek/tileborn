import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { generateBundledModules } from "./generate-bundled-modules.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gameHostRoot = path.resolve(scriptDir, "..");
const workerEntry = path.join(gameHostRoot, "src/worker.ts");
const outDir = path.join(gameHostRoot, "dist");
const workerPath = path.join(outDir, "worker.js");
const runtimePackagePath = path.join(gameHostRoot, "../../packages/runtime/package.json");
const manifestModulePath = path.join(gameHostRoot, "dist/build/manifest.js");

const readRuntimeVersion = async () => {
  const raw = await readFile(runtimePackagePath, "utf8");
  return JSON.parse(raw).version;
};

const hashFile = async (filePath) => {
  const { hashFileSha256 } = await import(manifestModulePath);
  return hashFileSha256(filePath);
};

const bundleWorker = async (manifest, runtimeVersion) => {
  const stagingManifestPath = path.join(gameHostRoot, "src/.generated/runtime-manifest.ts");
  const stagingMapPackagesPath = path.join(gameHostRoot, "src/.generated/bundled-map-packages.ts");
  const moduleShimPath = path.join(gameHostRoot, "src/.generated/module-shim.js");
  await writeFile(
    moduleShimPath,
    "export const createRequire = () => { throw new Error('createRequire is unavailable in the game-host worker'); };\n",
    "utf8",
  );
  await build({
    entryPoints: [workerEntry],
    outfile: workerPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    external: ["cloudflare:*", "node:crypto", "crypto", "node:fs", "node:fs/promises", "node:path", "node:url", "node:os"],
    define: {
      __WORKER_VERSION__: JSON.stringify(runtimeVersion),
      __BUILD_ID__: JSON.stringify(manifest.buildId),
    },
    plugins: [
      {
        name: "node-module-shim",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^module$/ }, () => ({ path: moduleShimPath }));
        },
      },
      {
        name: "runtime-manifest-alias",
        setup(buildApi) {
          buildApi.onResolve({ filter: /runtime-manifest\.js$/ }, (args) => {
            if (args.importer.includes("game-host")) {
              return { path: stagingManifestPath };
            }
            return undefined;
          });
        },
      },
      {
        name: "bundled-map-packages-alias",
        setup(buildApi) {
          buildApi.onResolve({ filter: /bundled-map-packages\.js$/ }, (args) => {
            if (args.importer.includes("game-host")) {
              return { path: stagingMapPackagesPath };
            }
            return undefined;
          });
        },
      },
    ],
  });
};

const runtimeVersion = await readRuntimeVersion();
const createdAt = "1970-01-01T00:00:00.000Z";
const { buildBundledManifest } = await import(manifestModulePath);

const initial = await generateBundledModules({
  workerVersion: runtimeVersion,
  createdAt,
  workerFiles: [],
});

await bundleWorker(initial.manifest, runtimeVersion);

const workerFiles = [
  {
    path: "worker.js",
    hash: await hashFile(workerPath),
    size: (await stat(workerPath)).size,
  },
  {
    path: "worker.js.map",
    hash: await hashFile(`${workerPath}.map`),
    size: (await stat(`${workerPath}.map`)).size,
  },
];

const finalManifest = buildBundledManifest({
  plugin: initial.pluginSummary,
  assetPacks: [initial.assetPackSummary],
  maps: initial.mapSummaries,
  runtimeVersion,
  workerFiles,
  createdAt,
});

await generateBundledModules({
  workerVersion: runtimeVersion,
  createdAt,
  workerFiles,
  buildId: finalManifest.buildId,
});

await bundleWorker(finalManifest, runtimeVersion);

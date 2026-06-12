import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type ContentHash, type JsonObject } from "@tileborne/core";
import { build as esbuildBuild } from "esbuild";

import {
  buildBundledManifest,
  fileEntryFromPath,
  hashFileSha256,
  type BuildManifestInput,
} from "./manifest.js";
import type {
  BundledAssetPackSummary,
  BundledManifest,
  BundledManifestFileEntry,
  BundledMapPackage,
  BundledMapPackageSummary,
  BundledPluginSummary,
} from "../types.js";

const gameHostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerEntry = path.join(gameHostRoot, "src/worker.ts");
const wranglerTemplatePath = path.join(gameHostRoot, "wrangler.template.toml");

/**
 * One assembled `RuntimeMapPackage` to bake into the artifact (ADR-0030 / M5
 * S1): `sourceDir` holds the canonical on-disk package layout written by
 * `assembleRuntimeMapPackage`, `mapPackage` is the same package as encoded
 * wire JSON (what rooms boot from).
 */
export interface CloudflareGameHostMapPackageInput {
  readonly mapId: string;
  readonly packageId: string;
  readonly sourceDir: string;
  readonly mapPackage: JsonObject;
}

export interface CloudflareGameHostBuildInput {
  readonly outDir: string;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly pluginRoot: string;
  readonly pluginRuntimeRelativePath?: string;
  readonly assetPacks: readonly {
    readonly id: string;
    readonly version: string;
    readonly root: string;
    readonly files: readonly { readonly relativePath: string }[];
  }[];
  readonly mapPackages: readonly CloudflareGameHostMapPackageInput[];
  readonly runtimeVersion: string;
  readonly siteName: string;
  readonly createdAt: string;
}

export interface CloudflareGameHostBuildResult {
  readonly outDir: string;
  readonly files: readonly string[];
  readonly manifest: BundledManifest;
  readonly manifestHash: ContentHash;
  readonly bundlePath: string;
}

const walkRelativeFiles = async (root: string, prefix = ""): Promise<readonly string[]> => {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkRelativeFiles(root, relative)));
    } else if (entry.isFile()) {
      files.push(relative.replace(/\\/g, "/"));
    }
  }
  return files;
};

const copyTree = async (sourceRoot: string, targetRoot: string, relativePaths: readonly string[]): Promise<void> => {
  await mkdir(targetRoot, { recursive: true });
  for (const relativePath of relativePaths) {
    const source = path.join(sourceRoot, relativePath);
    const target = path.join(targetRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
  }
};

// The signing key is deliberately NOT emitted as a live `[vars]` entry: a
// baked plaintext key would deploy as a publicly-known signing key (forgeable
// handoff tokens). The template carries a commented `wrangler secret put`
// instruction instead, and the worker rejects the known placeholder value.
const renderWranglerToml = async (siteName: string): Promise<string> => {
  const template = await readFile(wranglerTemplatePath, "utf8");
  return template.replaceAll("{{SITE_NAME}}", siteName);
};

const writeRuntimeManifestModule = async (stagingDir: string, manifest: BundledManifest): Promise<void> => {
  const source = `import type { BundledManifest } from "./types.js";

export const runtimeManifest: BundledManifest = ${JSON.stringify(manifest, null, 2)} as BundledManifest;
`;
  await writeFile(path.join(stagingDir, "runtime-manifest.ts"), source, "utf8");
};

const writeBundledMapPackagesModule = async (
  stagingDir: string,
  mapPackages: readonly BundledMapPackage[],
): Promise<void> => {
  const source = `import type { BundledMapPackage } from "./types.js";

export const bundledMapPackages: readonly BundledMapPackage[] = ${JSON.stringify(mapPackages, null, 2)} as readonly BundledMapPackage[];
`;
  await writeFile(path.join(stagingDir, "bundled-map-packages.ts"), source, "utf8");
};

/** Artifact directory name for one bundled map (`map:<uuid>` → `map-<uuid>`). */
const mapPackageDirName = (mapId: string): string => mapId.replaceAll(":", "-");

const bundleWorker = async (
  outDir: string,
  stagingDir: string,
  manifest: BundledManifest,
  runtimeVersion: string,
): Promise<void> => {
  const stagingManifestPath = path.join(stagingDir, "runtime-manifest.ts");
  const stagingMapPackagesPath = path.join(stagingDir, "bundled-map-packages.ts");
  const moduleShimPath = path.join(stagingDir, "module-shim.js");
  await writeFile(
    moduleShimPath,
    "export const createRequire = () => { throw new Error('createRequire is unavailable in the game-host worker'); };\n",
    "utf8",
  );
  await esbuildBuild({
    entryPoints: [workerEntry],
    outfile: path.join(outDir, "worker.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    external: ["cloudflare:*", "node:crypto", "node:fs", "node:fs/promises", "node:path", "node:url", "node:os"],
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
        name: "runtime-manifest-stub",
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
        name: "bundled-map-packages-stub",
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

export const buildCloudflareGameHost = async (
  input: CloudflareGameHostBuildInput,
): Promise<CloudflareGameHostBuildResult> => {
  const outDir = path.resolve(input.outDir);
  const pluginDir = path.join(outDir, "plugin");
  const assetsDir = path.join(outDir, "assets");
  const stagingDir = path.join(outDir, ".staging");
  await mkdir(outDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });

  const runtimeRelativePath = input.pluginRuntimeRelativePath ?? "dist/runtime.js";
  const runtimeSource = path.join(input.pluginRoot, runtimeRelativePath);
  await mkdir(pluginDir, { recursive: true });
  const runtimeTarget = path.join(pluginDir, "runtime.js");
  await stat(runtimeSource);
  await cp(runtimeSource, runtimeTarget);

  const pluginFiles = await walkRelativeFiles(pluginDir);
  const pluginEntries = await Promise.all(
    pluginFiles.map((relativePath) => fileEntryFromPath(outDir, path.join("plugin", relativePath))),
  );
  const pluginSummary: BundledPluginSummary = {
    id: input.pluginId,
    version: input.pluginVersion,
    files: pluginEntries,
  };

  const assetPackSummaries: BundledAssetPackSummary[] = [];
  for (const pack of input.assetPacks) {
    const packOut = path.join(assetsDir, pack.id);
    await copyTree(pack.root, packOut, pack.files.map((file) => file.relativePath));
    const copiedFiles = await walkRelativeFiles(packOut);
    const entries = await Promise.all(
      copiedFiles.map((relativePath) => fileEntryFromPath(outDir, path.join("assets", pack.id, relativePath))),
    );
    assetPackSummaries.push({ id: pack.id, version: pack.version, files: entries });
  }

  const mapsDir = path.join(outDir, "maps");
  const mapPackageSummaries: BundledMapPackageSummary[] = [];
  const bundledMapPackages: BundledMapPackage[] = [];
  for (const mapPackage of input.mapPackages) {
    const mapOut = path.join(mapsDir, mapPackageDirName(mapPackage.mapId));
    await cp(mapPackage.sourceDir, mapOut, { recursive: true });
    const copiedFiles = await walkRelativeFiles(mapOut);
    const entries = await Promise.all(
      copiedFiles.map((relativePath) =>
        fileEntryFromPath(outDir, path.join("maps", mapPackageDirName(mapPackage.mapId), relativePath))
      ),
    );
    mapPackageSummaries.push({ mapId: mapPackage.mapId, packageId: mapPackage.packageId, files: entries });
    bundledMapPackages.push({
      mapId: mapPackage.mapId,
      packageId: mapPackage.packageId,
      mapPackage: mapPackage.mapPackage,
    });
  }

  const manifestBase: BuildManifestInput = {
    plugin: pluginSummary,
    assetPacks: assetPackSummaries,
    maps: mapPackageSummaries,
    runtimeVersion: input.runtimeVersion,
    workerFiles: [],
    createdAt: input.createdAt,
  };

  // Two-pass fixed-point build (see the `workerFiles` convention in
  // types.ts): the manifest is embedded INTO worker.js, so pass 1 bundles
  // with empty workerFiles, those output bytes are hashed as the recorded
  // `workerFiles` entries, and pass 2 re-bundles embedding the final
  // manifest. The shipped worker.js intentionally does not hash to the
  // recorded entries; `buildId` covers the pre-embed worker.
  let manifest = buildBundledManifest(manifestBase);
  await writeRuntimeManifestModule(stagingDir, manifest);
  await writeBundledMapPackagesModule(stagingDir, bundledMapPackages);
  await bundleWorker(outDir, stagingDir, manifest, input.runtimeVersion);

  const workerFiles: BundledManifestFileEntry[] = [
    await fileEntryFromPath(outDir, "worker.js"),
    await fileEntryFromPath(outDir, "worker.js.map"),
  ];

  manifest = buildBundledManifest({ ...manifestBase, workerFiles });
  await writeRuntimeManifestModule(stagingDir, manifest);
  await bundleWorker(outDir, stagingDir, manifest, input.runtimeVersion);

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "wrangler.toml"), await renderWranglerToml(input.siteName), "utf8");

  // The artifact directory IS the deployable: drop the build-time staging
  // tree (generated worker modules + the map-package staging the services
  // build placed under the same `.staging/`) so no unhashed duplicates ship.
  await rm(stagingDir, { recursive: true, force: true });

  const files = [
    "worker.js",
    "worker.js.map",
    "manifest.json",
    "wrangler.toml",
    ...pluginEntries.map((entry) => entry.path),
    ...assetPackSummaries.flatMap((pack) => pack.files.map((entry) => entry.path)),
    ...mapPackageSummaries.flatMap((map) => map.files.map((entry) => entry.path)),
  ];

  return {
    outDir,
    files,
    manifest,
    manifestHash: manifest.buildId,
    bundlePath: path.join(outDir, "worker.js"),
  };
};

export const hashBundleFile = hashFileSha256;

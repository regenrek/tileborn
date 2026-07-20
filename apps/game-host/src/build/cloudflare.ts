import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { type ContentHash, type JsonObject } from "@tileborne/core";
import { build as esbuildBuild, transform as esbuildTransform } from "esbuild";

import {
  buildBundledManifest,
  digestHex,
  fileEntryFromPath,
  hashFileSha256,
  type BuildManifestInput,
} from "./manifest.js";
import { buildDeploymentManifest } from "./deployment-manifest.js";
import type {
  BundledAssetPackSummary,
  BundledManifest,
  BundledManifestFileEntry,
  BundledMapPackage,
  BundledMapPackageSummary,
  BundledPluginSummary,
} from "../types.js";

export interface GameHostBuildAssets {
  readonly root: string;
  readonly workerEntry: string;
  readonly behaviorWorkerEntry: string;
  readonly wranglerTemplatePath: string;
}

export const resolveGameHostBuildAssets = (runtimeRoot = process.cwd()): GameHostBuildAssets => {
  let directory = path.resolve(runtimeRoot);
  for (;;) {
    for (const root of [
      directory,
      path.join(directory, "apps/game-host/dist/build-assets"),
      path.join(directory, "apps/game-host"),
      path.join(directory, "game-host"),
    ]) {
      for (const entries of [
        ["worker-entry.js", "behavior/workerd/service-worker.js", "wrangler.template.toml"],
        ["dist/build-assets/worker-entry.js", "dist/build-assets/behavior/workerd/service-worker.js", "dist/build-assets/wrangler.template.toml"],
        ["dist/worker-entry.js", "dist/behavior/workerd/service-worker.js", "wrangler.template.toml"],
        ["src/worker.ts", "src/behavior/workerd/service-worker.ts", "wrangler.template.toml"],
      ] as const) {
        const workerEntry = path.join(root, entries[0]);
        const behaviorWorkerEntry = path.join(root, entries[1]);
        const wranglerTemplatePath = path.join(root, entries[2]);
        if (
          existsSync(wranglerTemplatePath)
          && existsSync(workerEntry)
          && existsSync(behaviorWorkerEntry)
        ) {
          return { root, workerEntry, behaviorWorkerEntry, wranglerTemplatePath };
        }
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not locate Tileborne game-host build assets from ${runtimeRoot}`);
};

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
  /** Explicit portable assembly-asset root supplied by packaged desktop hosts. */
  readonly buildAssetsRoot?: string;
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
  /** Cooperative cancellation owned by the caller's job/runtime boundary. */
  readonly signal?: AbortSignal;
}

export interface CloudflareGameHostBuildResult {
  readonly outDir: string;
  readonly files: readonly string[];
  readonly manifest: BundledManifest;
  readonly manifestHash: ContentHash;
  readonly bundlePath: string;
  /** Hashes of the final shipped bytes (unlike manifest.workerFiles' fixed-point convention). */
  readonly fileHashes: Readonly<Record<string, ContentHash>>;
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

const copyTree = async (
  sourceRoot: string,
  targetRoot: string,
  relativePaths: readonly string[],
): Promise<void> => {
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
const CLOUDFLARE_SITE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Stable, injection-safe Cloudflare Worker name derived from a display name. */
export const canonicalCloudflareSiteSlug = (displayName: string): string => {
  const normalized = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const fallback = normalized.length > 0 ? normalized : "tileborne-game-host";
  const shortened =
    fallback.length <= 63
      ? fallback
      : `${fallback.slice(0, 54).replace(/-+$/g, "")}-${digestHex(displayName).slice(0, 8)}`;
  if (!CLOUDFLARE_SITE_SLUG.test(shortened)) {
    throw new Error(`invalid canonical Cloudflare site slug: ${shortened}`);
  }
  return shortened;
};

const renderWranglerToml = async (
  siteName: string,
  wranglerTemplatePath: string,
): Promise<string> => {
  const template = await readFile(wranglerTemplatePath, "utf8");
  const slug = canonicalCloudflareSiteSlug(siteName);
  return template.replaceAll("{{SITE_NAME}}", slug);
};

const renderBehaviorWranglerToml = (siteName: string): string => {
  const slug = canonicalCloudflareSiteSlug(siteName);
  return `name = "${slug}-behaviors"
main = "behavior-worker.js"
compatibility_date = "2024-12-01"

[limits]
cpu_ms = 50
`;
};

/** Artifact directory name for one bundled map (`map:<uuid>` → `map-<uuid>`). */
const mapPackageDirName = (mapId: string): string => mapId.replaceAll(":", "-");

const bundleWorker = async (
  outDir: string,
  manifest: BundledManifest,
  mapPackages: readonly BundledMapPackage[],
  runtimeVersion: string,
  workerEntry: string,
): Promise<void> => {
  const runtimeManifestSource = `export const runtimeManifest = ${JSON.stringify(manifest)};\n`;
  const mapPackagesSource = `export const bundledMapPackages = ${JSON.stringify(mapPackages)};\n`;
  const moduleShimSource =
    "export const createRequire = () => { throw new Error('createRequire is unavailable in the game-host worker'); };\n";
  await esbuildBuild({
    entryPoints: [workerEntry],
    outfile: path.join(outDir, "worker.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    external: [
      "cloudflare:*",
      "node:crypto",
      "node:fs",
      "node:fs/promises",
      "node:path",
      "node:url",
      "node:os",
    ],
    define: {
      __WORKER_VERSION__: JSON.stringify(runtimeVersion),
      __BUILD_ID__: JSON.stringify(manifest.buildId),
    },
    plugins: [
      {
        name: "node-module-shim",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^module$/ }, () => ({
            path: "module-shim",
            namespace: "tileborne-generated",
          }));
        },
      },
      {
        name: "runtime-manifest-stub",
        setup(buildApi) {
          buildApi.onResolve({ filter: /runtime-manifest\.js$/ }, (args) => {
            if (args.importer.includes("game-host")) {
              return { path: "runtime-manifest", namespace: "tileborne-generated" };
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
              return { path: "bundled-map-packages", namespace: "tileborne-generated" };
            }
            return undefined;
          });
        },
      },
      {
        name: "generated-module-content",
        setup(buildApi) {
          buildApi.onLoad({ filter: /.*/, namespace: "tileborne-generated" }, (args) => ({
            contents:
              args.path === "runtime-manifest"
                ? runtimeManifestSource
                : args.path === "bundled-map-packages"
                  ? mapPackagesSource
                  : moduleShimSource,
            loader: "js",
          }));
        },
      },
    ],
  });
};

const bundleBehaviorWorker = async (
  outDir: string,
  bundledBehaviorsSource: string,
  behaviorWorkerEntry: string,
): Promise<void> => {
  await esbuildBuild({
    entryPoints: [behaviorWorkerEntry],
    outfile: path.join(outDir, "behavior-worker.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    plugins: [
      {
        name: "bundled-behaviors-stub",
        setup(buildApi) {
          buildApi.onResolve({ filter: /bundled-behaviors\.js$/ }, () => ({
            path: "bundled-behaviors",
            namespace: "tileborne-generated",
          }));
          buildApi.onLoad(
            { filter: /^bundled-behaviors$/, namespace: "tileborne-generated" },
            () => ({
              contents: bundledBehaviorsSource,
              loader: "ts",
              resolveDir: path.parse(outDir).root,
            }),
          );
        },
      },
    ],
  });
};

export const buildBundledBehaviorsSource = async (
  mapPackages: readonly CloudflareGameHostMapPackageInput[],
): Promise<string> => {
  const entries: string[] = [];
  for (const mapPackage of mapPackages) {
    const behaviors = (mapPackage.mapPackage as { behaviors?: { modules?: unknown } }).behaviors;
    const modules = Array.isArray(behaviors?.modules) ? behaviors.modules : [];
    for (const candidate of modules) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        typeof (candidate as { modulePath?: unknown }).modulePath !== "string"
      ) {
        throw new Error(`invalid behavior module metadata for ${mapPackage.packageId}`);
      }
      const artifact = candidate as {
        readonly behaviorId: string;
        readonly sourceKind: string;
        readonly modulePath: string;
        readonly hash: string;
      };
      const modulePath = path.resolve(mapPackage.sourceDir, artifact.modulePath);
      const relative = path.relative(mapPackage.sourceDir, modulePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`behavior module escapes package root: ${artifact.modulePath}`);
      }
      const code = await readFile(modulePath, "utf8");
      const transformed = await esbuildTransform(code, {
        format: "iife",
        globalName: "__tileborneBehaviorModule",
        platform: "browser",
        target: "es2022",
        sourcemap: false,
        sourcefile: artifact.modulePath,
      });
      entries.push(
        `{ packageId: ${JSON.stringify(mapPackage.packageId)}, artifact: ${JSON.stringify(artifact)}, code: ${JSON.stringify(code)}, createNamespace: () => { ${transformed.code}\nreturn __tileborneBehaviorModule; } }`,
      );
    }
  }
  return `export const bundledBehaviorModules = [${entries.join(",\n")}];\n`;
};

const buildCloudflareGameHostInto = async (
  input: CloudflareGameHostBuildInput,
): Promise<CloudflareGameHostBuildResult> => {
  const buildAssets = resolveGameHostBuildAssets(input.buildAssetsRoot ?? process.cwd());
  const checkpoint = (): void => input.signal?.throwIfAborted();
  checkpoint();
  const outDir = path.resolve(input.outDir);
  const pluginDir = path.join(outDir, "plugin");
  const assetsDir = path.join(outDir, "assets");
  const stagingDir = path.join(outDir, ".staging");
  await mkdir(outDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });
  checkpoint();

  const runtimeRelativePath = input.pluginRuntimeRelativePath ?? "dist/runtime.js";
  const runtimeSource = path.join(input.pluginRoot, runtimeRelativePath);
  await mkdir(pluginDir, { recursive: true });
  const runtimeTarget = path.join(pluginDir, "runtime.js");
  await stat(runtimeSource);
  await cp(runtimeSource, runtimeTarget);
  checkpoint();

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
    checkpoint();
    const packOut = path.join(assetsDir, pack.id);
    await copyTree(
      pack.root,
      packOut,
      pack.files.map((file) => file.relativePath),
    );
    const copiedFiles = await walkRelativeFiles(packOut);
    const entries = await Promise.all(
      copiedFiles.map((relativePath) =>
        fileEntryFromPath(outDir, path.join("assets", pack.id, relativePath)),
      ),
    );
    assetPackSummaries.push({ id: pack.id, version: pack.version, files: entries });
  }

  const mapsDir = path.join(outDir, "maps");
  const mapPackageSummaries: BundledMapPackageSummary[] = [];
  const bundledMapPackages: BundledMapPackage[] = [];
  for (const mapPackage of input.mapPackages) {
    checkpoint();
    const mapOut = path.join(mapsDir, mapPackageDirName(mapPackage.mapId));
    await cp(mapPackage.sourceDir, mapOut, { recursive: true });
    const copiedFiles = await walkRelativeFiles(mapOut);
    const entries = await Promise.all(
      copiedFiles.map((relativePath) =>
        fileEntryFromPath(
          outDir,
          path.join("maps", mapPackageDirName(mapPackage.mapId), relativePath),
        ),
      ),
    );
    mapPackageSummaries.push({
      mapId: mapPackage.mapId,
      packageId: mapPackage.packageId,
      files: entries,
    });
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
  const bundledBehaviorsSource = await buildBundledBehaviorsSource(input.mapPackages);
  await bundleBehaviorWorker(outDir, bundledBehaviorsSource, buildAssets.behaviorWorkerEntry);

  // Two-pass fixed-point build (see the `workerFiles` convention in
  // types.ts): the manifest is embedded INTO worker.js, so pass 1 bundles
  // with empty workerFiles, those output bytes are hashed as the recorded
  // `workerFiles` entries, and pass 2 re-bundles embedding the final
  // manifest. The shipped worker.js intentionally does not hash to the
  // recorded entries; `buildId` covers the pre-embed worker.
  let manifest = buildBundledManifest(manifestBase);
  await bundleWorker(outDir, manifest, bundledMapPackages, input.runtimeVersion, buildAssets.workerEntry);
  checkpoint();

  const workerFiles: BundledManifestFileEntry[] = [
    await fileEntryFromPath(outDir, "worker.js"),
    await fileEntryFromPath(outDir, "worker.js.map"),
    await fileEntryFromPath(outDir, "behavior-worker.js"),
    await fileEntryFromPath(outDir, "behavior-worker.js.map"),
  ];

  manifest = buildBundledManifest({ ...manifestBase, workerFiles });
  await bundleWorker(outDir, manifest, bundledMapPackages, input.runtimeVersion, buildAssets.workerEntry);
  checkpoint();

  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outDir, "deployment.json"),
    `${JSON.stringify(buildDeploymentManifest({ runtimeBuildId: manifest.buildId }), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outDir, "wrangler.toml"),
    await renderWranglerToml(input.siteName, buildAssets.wranglerTemplatePath),
    "utf8",
  );
  await writeFile(
    path.join(outDir, "wrangler.behavior.toml"),
    renderBehaviorWranglerToml(input.siteName),
    "utf8",
  );
  checkpoint();

  // The artifact directory IS the deployable: drop the build-time staging
  // tree (generated worker modules + the map-package staging the services
  // build placed under the same `.staging/`) so no unhashed duplicates ship.
  await rm(stagingDir, { recursive: true, force: true });

  const files = [
    "worker.js",
    "worker.js.map",
    "behavior-worker.js",
    "behavior-worker.js.map",
    "manifest.json",
    "deployment.json",
    "wrangler.toml",
    "wrangler.behavior.toml",
    ...pluginEntries.map((entry) => entry.path),
    ...assetPackSummaries.flatMap((pack) => pack.files.map((entry) => entry.path)),
    ...mapPackageSummaries.flatMap((map) => map.files.map((entry) => entry.path)),
  ];
  const fileHashes = Object.fromEntries(
    await Promise.all(
      files.map(
        async (relativePath) =>
          [relativePath, await hashFileSha256(path.join(outDir, relativePath))] as const,
      ),
    ),
  );

  return {
    outDir,
    files,
    manifest,
    manifestHash: manifest.buildId,
    bundlePath: path.join(outDir, "worker.js"),
    fileHashes,
  };
};

/**
 * Cancellation-safe build boundary. Callers pass a fresh staging output; if a
 * job aborts, that incomplete tree is removed so it can never be previewed as
 * an artifact. The services layer promotes it to the durable destination only
 * after this promise completes successfully.
 */
export const buildCloudflareGameHost = async (
  input: CloudflareGameHostBuildInput,
): Promise<CloudflareGameHostBuildResult> => {
  try {
    return await buildCloudflareGameHostInto(input);
  } catch (error) {
    await rm(path.resolve(input.outDir), { recursive: true, force: true });
    throw error;
  }
};

export const hashBundleFile = hashFileSha256;

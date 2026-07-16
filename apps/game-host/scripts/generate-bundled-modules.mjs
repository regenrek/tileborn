import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import process from "node:process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateBundledMapPackages } from "./generate-bundled-map-packages.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gameHostRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(gameHostRoot, "../..");
const generatedDir = path.join(gameHostRoot, "src/.generated");

const PLUGIN_PACKAGE_ROOT = path.join(repoRoot, "packages/plugin-battle-royale");
const PLUGIN_MANIFEST_PATH = path.join(PLUGIN_PACKAGE_ROOT, "tileborne-plugin.json");
const PLUGIN_RUNTIME_PATH = path.join(PLUGIN_PACKAGE_ROOT, "dist/runtime.js");
const SAMPLE_PACK_ROOT = path.join(repoRoot, "packages/test-fixtures/fixtures/asset-packs/smoke-pack");
const SAMPLE_PACK_ID = "pack:550e8400-e29b-41d4-a716-446655440099";

const SAMPLE_PACK_FILES = [
  "tileborne-asset-pack.json",
];

const FORBIDDEN_BROWSER_RUNTIME_MARKERS = [
  "process.env",
  "detect-libc",
  "node-gyp-build",
  "msgpackr-extract",
  "Dynamic require",
  "__require(\"fs\")",
  "__require(\"child_process\")",
  "from \"module\"",
  "from 'module'",
  "from \"node:",
  "from 'node:",
];

const DEV_BUILD_ID = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const DEV_WORKER_VERSION = "0.0.0-dev";

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");
const hashBytes = (bytes) => `sha256:${sha256Hex(bytes)}`;
const requirePath = async (absolutePath, label) => {
  try {
    await stat(absolutePath);
  } catch {
    throw new Error(`bundled ${label} not found at ${absolutePath}; build the source package first`);
  }
};

const readRequiredFile = async (absolutePath, label) => {
  await requirePath(absolutePath, label);
  return readFile(absolutePath);
};

const fileEntry = (relativePath, bytes) => ({
  path: relativePath.replace(/\\/g, "/"),
  hash: hashBytes(bytes),
  size: bytes.byteLength,
});

const encodeBase64 = (bytes) => Buffer.from(bytes).toString("base64");

const assertBrowserSafeRuntimeSource = (source) => {
  const violations = FORBIDDEN_BROWSER_RUNTIME_MARKERS.filter((marker) => source.includes(marker));
  if (violations.length > 0) {
    throw new Error(
      `bundled plugin runtime contains browser-forbidden Node/native markers:\n${violations
        .map((marker) => `- ${marker}`)
        .join("\n")}`,
    );
  }
};

const tileIdsReferencedByAnimations = (manifest, referencedTileIds) => {
  const animationIds = new Set(
    (manifest.tiles ?? [])
      .filter((tile) => referencedTileIds.has(String(tile.id)) && typeof tile.animationId === "string")
      .map((tile) => tile.animationId),
  );
  return new Set(
    (manifest.animations ?? [])
      .filter((animation) => animationIds.has(String(animation.id)))
      .flatMap((animation) => (animation.frames ?? []).map((frame) => String(frame.tileId))),
  );
};

export const buildReferencedTilesetManifest = (manifest, referencedTileIdsInput) => {
  const referencedTileIds = new Set([...referencedTileIdsInput].map(String));
  for (const tileId of tileIdsReferencedByAnimations(manifest, referencedTileIds)) {
    referencedTileIds.add(tileId);
  }

  const referencedTiles = (manifest.tiles ?? []).filter((tile) => referencedTileIds.has(String(tile.id)));
  const referencedTilesetIds = new Set(referencedTiles.map((tile) => String(tile.tilesetId)));
  const referencedTilesets = (manifest.tilesets ?? []).filter((tileset) => referencedTilesetIds.has(String(tileset.id)));
  const referencedAssetIds = new Set(referencedTilesets.map((tileset) => String(tileset.atlasAssetId)));
  const referencedAnimationIds = new Set(
    referencedTiles.flatMap((tile) => (typeof tile.animationId === "string" ? [String(tile.animationId)] : [])),
  );

  return {
    ...manifest,
    assets: (manifest.assets ?? []).filter((asset) => referencedAssetIds.has(String(asset.id))),
    tilesets: referencedTilesets,
    tiles: referencedTiles,
    animations: (manifest.animations ?? []).filter((animation) => referencedAnimationIds.has(String(animation.id))),
    collisionMasks: (manifest.collisionMasks ?? []).filter((entry) => referencedTileIds.has(String(entry.tileId))),
    autotileRules: (manifest.autotileRules ?? []).filter((rule) => referencedTilesetIds.has(String(rule.tilesetId))),
    variantFilters: (manifest.variantFilters ?? []).filter((filter) =>
      (filter.tileIds ?? []).some((tileId) => referencedTileIds.has(String(tileId))),
    ),
    terrainTransitions: (manifest.terrainTransitions ?? []).filter((transition) =>
      referencedTilesetIds.has(String(transition.tilesetId)),
    ),
  };
};

const decodeBundledAssetBlobImpl = `
const decodeBase64 = (encoded: string): Uint8Array => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const decodeBundledAssetBlob = (relativePath: string): Uint8Array => {
  const encoded = bundledAssetPackBlobs[relativePath];
  if (encoded === undefined) {
    throw new Error(\`missing bundled asset blob: \${relativePath}\`);
  }
  return decodeBase64(encoded);
};
`;

export const generateBundledModules = async (options = {}) => {
  const workerVersion = options.workerVersion ?? DEV_WORKER_VERSION;
  const buildId = options.buildId ?? DEV_BUILD_ID;
  const createdAt = options.createdAt ?? "1970-01-01T00:00:00.000Z";
  const workerFiles = options.workerFiles ?? [];

  await requirePath(PLUGIN_RUNTIME_PATH, "plugin runtime (run pnpm --filter @tileborne/plugin-battle-royale build)");
  await requirePath(PLUGIN_MANIFEST_PATH, "plugin manifest");
  await requirePath(SAMPLE_PACK_ROOT, "sample asset pack fixture");

  const pluginManifestRaw = await readFile(PLUGIN_MANIFEST_PATH, "utf8");
  const pluginManifest = JSON.parse(pluginManifestRaw);
  const pluginRuntimeBytes = await readRequiredFile(PLUGIN_RUNTIME_PATH, "plugin runtime");

  const sampleManifestBytes = await readRequiredFile(
    path.join(SAMPLE_PACK_ROOT, "tileborne-asset-pack.json"),
    "sample pack manifest",
  );
  const sampleManifest = JSON.parse(sampleManifestBytes.toString("utf8"));
  if (sampleManifest.id !== SAMPLE_PACK_ID) {
    throw new Error(`sample pack fixture id mismatch: expected ${SAMPLE_PACK_ID}, got ${sampleManifest.id}`);
  }
  const referencedTileIds = new Set(options.referencedTileIds ?? []);
  const bundledSampleManifestBytes = Buffer.from(
    `${JSON.stringify(buildReferencedTilesetManifest(sampleManifest, referencedTileIds), null, 2)}\n`,
    "utf8",
  );

  const sampleEntries = [];
  const sampleBlobs = {};
  for (const relativePath of SAMPLE_PACK_FILES) {
    const bytes = relativePath === "tileborne-asset-pack.json"
      ? bundledSampleManifestBytes
      : await readRequiredFile(path.join(SAMPLE_PACK_ROOT, relativePath), `sample pack file ${relativePath}`);
    sampleEntries.push(fileEntry(relativePath, bytes));
    sampleBlobs[relativePath] = encodeBase64(bytes);
  }

  const pluginSummary = {
    id: pluginManifest.id,
    version: pluginManifest.version,
    files: [fileEntry("plugin/runtime.js", pluginRuntimeBytes)],
  };

  const assetPackSummary = {
    id: sampleManifest.id,
    version: sampleManifest.version,
    files: sampleEntries,
  };

  await mkdir(generatedDir, { recursive: true });
  const bundledMapPackages = await generateBundledMapPackages();

  const mapSummaries = bundledMapPackages.map((entry) => ({
    mapId: entry.mapId,
    packageId: entry.packageId,
    files: [
      fileEntry(
        `maps/${entry.mapId.replaceAll(":", "-")}/package.json`,
        Buffer.from(`${JSON.stringify(entry.mapPackage, null, 2)}\n`, "utf8"),
      ),
    ],
  }));

  const manifestWithoutBuildId = {
    schemaVersion: 1,
    plugin: pluginSummary,
    assetPacks: [assetPackSummary],
    maps: mapSummaries,
    runtimeVersion: workerVersion,
    protocolVersion: 1,
    workerFiles,
    createdAt,
  };

  const runtimeManifest = {
    ...manifestWithoutBuildId,
    buildId,
  };

  const pluginRuntimeSource = (await readFile(PLUGIN_RUNTIME_PATH, "utf8"))
    .replace(/\n\/\/# sourceMappingURL=.*$/u, "\n");
  assertBrowserSafeRuntimeSource(pluginRuntimeSource);
  await writeFile(path.join(generatedDir, "plugin-runtime.js"), pluginRuntimeSource, "utf8");

  await writeFile(
    path.join(generatedDir, "plugin-runtime.d.ts"),
    `export interface RuntimeClientInputFrame {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly shoot: boolean;
  readonly reload: boolean;
  readonly interact: boolean;
  readonly drop: boolean;
  readonly abilities: readonly ("dash" | "shield-burst" | "scan-pulse" | "trap" | "decoy")[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}

export type RuntimeClientFrameView =
  | { readonly kind: "heartbeat"; readonly tick: number }
  | {
      readonly kind: "input";
      readonly input: RuntimeClientInputFrame;
      readonly sortKey: {
        readonly tick: number;
        readonly seq: number;
      };
    };

export type RuntimeClientFrameDecodeResult =
  | { readonly kind: "accepted"; readonly frame: RuntimeClientFrameView }
  | {
      readonly kind: "rejected";
      readonly frame: Uint8Array;
      readonly closeCode: number;
      readonly closeReason: string;
    };

export type RuntimeServerLifecycleFrameView = {
  readonly kind: "game-over";
  readonly winnerPlayerId: string;
};

export declare function decodeClientFrame(bytes: Uint8Array): RuntimeClientFrameDecodeResult;
export declare function decodeClientFrameView(bytes: Uint8Array): RuntimeClientFrameView | undefined;
export declare function decodeServerLifecycleFrame(bytes: Uint8Array): RuntimeServerLifecycleFrameView | undefined;
export declare function encodeInvalidClientFrame(): Uint8Array;
export declare function isWelcomeFrame(bytes: Uint8Array): boolean;

export declare function createRuntimeAdapter(host: {
  readonly getMapPackage: () => unknown;
  readonly getPlayerModelSelections?: () => readonly {
    readonly playerId: string;
    readonly modelId: string;
  }[];
  readonly getPlayerInput?: (playerId: string) => {
    readonly tick: number;
    readonly seq: number;
    readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    readonly shoot: boolean;
    readonly reload: boolean;
    readonly interact: boolean;
    readonly drop: boolean;
    readonly abilities: readonly ("dash" | "shield-burst" | "scan-pulse" | "trap" | "decoy")[];
    readonly aimDeg?: number;
    readonly swapSlot?: number;
  } | undefined;
  readonly msgOut?: { readonly push: (frame: Uint8Array) => void };
  readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  readonly seed?: string | number;
}): {
  readonly id: string;
  readonly onInit?: (ctx: { readonly pluginId: string }, world: unknown) => void;
  readonly onTick?: (world: unknown, dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
};
`,
    "utf8",
  );

  await writeFile(
    path.join(generatedDir, "bundled-plugin.ts"),
    `import type { BundledPluginSummary } from "../types.js";

export const bundledPlugin: BundledPluginSummary = ${JSON.stringify(pluginSummary, null, 2)} as unknown as BundledPluginSummary;
`,
    "utf8",
  );

  await writeFile(
    path.join(generatedDir, "bundled-assets.ts"),
    `import type { BundledAssetPackSummary } from "../types.js";

export const bundledSamplePackId = ${JSON.stringify(SAMPLE_PACK_ID)} as const;

export const bundledAssetPacks: readonly BundledAssetPackSummary[] = ${JSON.stringify([assetPackSummary], null, 2)} as unknown as readonly BundledAssetPackSummary[];

export const bundledAssetPackBlobs: Readonly<Record<string, string>> = ${JSON.stringify(sampleBlobs, null, 2)};

${decodeBundledAssetBlobImpl}
`,
    "utf8",
  );

  await writeFile(
    path.join(generatedDir, "runtime-manifest.ts"),
    `import type { BundledManifest } from "../types.js";

export const runtimeManifest: BundledManifest = ${JSON.stringify(runtimeManifest, null, 2)} as unknown as BundledManifest;
`,
    "utf8",
  );

  await writeFile(
    path.join(generatedDir, "bundled-behaviors.ts"),
    `import type { BundledBehaviorModule } from "../types.js";\n\nexport const bundledBehaviorModules: readonly BundledBehaviorModule[] = [];\n`,
    "utf8",
  );

  return {
    generatedDir,
    manifest: runtimeManifest,
    pluginSummary,
    assetPackSummary,
    mapSummaries,
    pluginRuntimeBytes,
  };
};

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await generateBundledModules();
}

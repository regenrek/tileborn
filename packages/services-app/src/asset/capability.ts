import { readFile } from "node:fs/promises";

import {
  ContentHash,
  PackCapability,
  PackDuplicateIdDiagnostic,
  PackMissingAssetDiagnostic,
  PackNoTilesetsDiagnostic,
  PackUnsupportedSchemaDiagnostic,
  hashBytes,
  type PackCapabilityDiagnostic,
  type PackSourceInventorySummary,
  type PackCapabilitySource,
  type PackId,
} from "@tileborne/core";
import { parseTilesetManifest } from "@tileborne/sdk-tileset/manifest";
import { Effect, Option, Schema } from "effect";

import { errorMessage } from "../internal/files.js";

export class PackCapabilityProbeError extends Schema.TaggedErrorClass<PackCapabilityProbeError>()(
  "PackCapabilityProbeError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

interface ProbeInput {
  readonly packId: PackId;
  readonly manifestPath: string;
}

const CAPABILITY_CACHE_VERSION = 6;
const textEncoder = new TextEncoder();

const capabilityIntegrityHash = (rawManifest: string): ContentHash =>
  hashBytes(textEncoder.encode(`pack-capability-v${CAPABILITY_CACHE_VERSION}\n${rawManifest}`));

interface ManifestLike {
  readonly schemaVersion?: unknown;
  readonly tilesets?: readonly unknown[];
  readonly tiles?: readonly unknown[];
  readonly autotileRules?: readonly unknown[];
  readonly placeables?: readonly unknown[];
  readonly terrainClasses?: readonly unknown[];
  readonly animations?: readonly unknown[];
  readonly collisionMasks?: readonly unknown[];
  readonly tiledSourceInventory?: {
    readonly summary?: Partial<PackSourceInventorySummary>;
  };
}

const asManifestLike = (json: unknown): ManifestLike =>
  typeof json === "object" && json !== null ? (json as ManifestLike) : {};

const arrayLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const rawTileCount = (manifest: ManifestLike): number => {
  if (Array.isArray(manifest.tiles)) {
    return manifest.tiles.length;
  }
  if (!Array.isArray(manifest.tilesets)) {
    return 0;
  }
  return manifest.tilesets.reduce((sum, tileset) => {
    if (typeof tileset !== "object" || tileset === null || !("tiles" in tileset)) {
      return sum;
    }
    return sum + arrayLength((tileset as { readonly tiles?: unknown }).tiles);
  }, 0);
};

const numberField = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

const sourceInventorySummary = (manifest: ManifestLike): PackSourceInventorySummary | undefined => {
  const summary = manifest.tiledSourceInventory?.summary;
  if (summary === undefined) return undefined;
  return {
    tilesetCount: numberField(summary.tilesetCount),
    tileCount: numberField(summary.tileCount),
    frameCount: numberField(summary.frameCount),
    imageCollectionTileCount: numberField(summary.imageCollectionTileCount),
    wangSetCount: numberField(summary.wangSetCount),
    animationCount: numberField(summary.animationCount),
    animationFrameCount: numberField(summary.animationFrameCount),
    tileProbabilityCount: numberField(summary.tileProbabilityCount),
    wangColorProbabilityCount: numberField(summary.wangColorProbabilityCount),
    collisionObjectCount: numberField(summary.collisionObjectCount),
    ruleMapCount: numberField(summary.ruleMapCount),
    rulesIndexCount: numberField(summary.rulesIndexCount),
    exampleMapCount: numberField(summary.exampleMapCount),
  };
};

const schemaVersionOption = (schemaVersion: unknown): Option.Option<number> =>
  typeof schemaVersion === "number" ? Option.some(schemaVersion) : Option.none();

const unsupportedSchemaDiagnostic = (schemaVersion: unknown): PackCapabilityDiagnostic | undefined => {
  if (schemaVersion === undefined || schemaVersion === 1) {
    return undefined;
  }
  return new PackUnsupportedSchemaDiagnostic({
    schemaVersion: schemaVersionOption(schemaVersion),
    message: `Unsupported tileset manifest schema version: ${String(schemaVersion)}`,
  });
};

const parseDiagnostics = (
  packId: PackId,
  diagnostics: ReturnType<typeof parseTilesetManifest>["diagnostics"],
): readonly PackCapabilityDiagnostic[] =>
  diagnostics.flatMap((diagnostic): readonly PackCapabilityDiagnostic[] => {
    switch (diagnostic._tag) {
      case "MissingAtlas":
        return [
          new PackMissingAssetDiagnostic({
            assetId: diagnostic.atlasAssetId,
            path: diagnostic.path,
            message: diagnostic.message,
          }),
        ];
      case "DuplicateTileId":
        return [
          new PackDuplicateIdDiagnostic({
            packId,
            message: diagnostic.message,
          }),
        ];
      case "DuplicateAutotileRuleId":
        return [
          new PackDuplicateIdDiagnostic({
            packId,
            message: diagnostic.message,
          }),
        ];
      default:
        return [];
    }
  });

const missingImageAssetDiagnostics = (
  pack: NonNullable<ReturnType<typeof parseTilesetManifest>["value"]>,
): readonly PackCapabilityDiagnostic[] => {
  const assetsById = new Map(pack.assets.map((asset) => [String(asset.id), asset] as const));
  return pack.tilesets.flatMap((tileset, index) => {
    const assetId = String(tileset.atlasAssetId);
    const asset = assetsById.get(assetId);
    if (asset?.mime.startsWith("image/") === true) {
      return [];
    }
    return [
      new PackMissingAssetDiagnostic({
        assetId,
        path: `/tilesets/${index}/atlasAssetId`,
        message: `Tileset atlas asset is missing or not an image: ${assetId}`,
      }),
    ];
  });
};

const objectOnlyTileIds = (
  pack: NonNullable<ReturnType<typeof parseTilesetManifest>["value"]>,
): ReadonlySet<string> =>
  new Set(
    (pack.placeables ?? [])
      .filter((placeable) => placeable.placementMode === 'object')
      .flatMap((placeable) => placeable.frames.map((frame) => String(frame.tileId))),
  );

const paintableTileCount = (
  pack: NonNullable<ReturnType<typeof parseTilesetManifest>["value"]>,
): number => {
  const objectOnly = objectOnlyTileIds(pack);
  return pack.tilesets.reduce(
    (sum, tileset) => sum + tileset.tiles.filter((tile) => !objectOnly.has(String(tile.id))).length,
    0,
  );
};

const paintableTilesetCount = (
  pack: NonNullable<ReturnType<typeof parseTilesetManifest>["value"]>,
): number => {
  const objectOnly = objectOnlyTileIds(pack);
  return pack.tilesets.filter((tileset) =>
    tileset.tiles.some((tile) => !objectOnly.has(String(tile.id))),
  ).length;
};

export const detectPackCapability = (packId: PackId, json: unknown): PackCapability => {
  const manifest = asManifestLike(json);
  const parsed = parseTilesetManifest(json);
  const schemaVersion = schemaVersionOption(manifest.schemaVersion);
  const unsupported = unsupportedSchemaDiagnostic(manifest.schemaVersion);
  const sourceInventory = sourceInventorySummary(manifest);

  if (parsed.value !== undefined) {
    const missingAssets = missingImageAssetDiagnostics(parsed.value);
    const tilesetCount = paintableTilesetCount(parsed.value);
    const tileCount = paintableTileCount(parsed.value);
    const placeableCount = parsed.value.placeables?.length ?? 0;
    const diagnostics: PackCapabilityDiagnostic[] = [
      ...missingAssets,
      ...parsed.diagnostics.map((diagnostic) =>
        new PackUnsupportedSchemaDiagnostic({
          schemaVersion,
          message: diagnostic.message,
        }),
      ),
    ];
    if (tilesetCount === 0 || tileCount === 0) {
      diagnostics.push(
        new PackNoTilesetsDiagnostic({
          message: "Pack does not contain paintable tilesets.",
        }),
      );
    }
    if (unsupported !== undefined) {
      diagnostics.push(unsupported);
    }

    return new PackCapability({
      packId,
      paintable: tilesetCount > 0 && tileCount > 0 && missingAssets.length === 0 && unsupported === undefined,
      tilesetCount,
      tileCount,
      placeableCount,
      autotileRuleCount: parsed.value.tilesets.reduce((sum, tileset) => sum + tileset.autotileRules.length, 0),
      terrainClassCount: arrayLength(manifest.terrainClasses),
      hasAnimations: arrayLength(manifest.animations) > 0,
      hasCollisionMasks: arrayLength(manifest.collisionMasks) > 0,
      schemaVersion,
      source: "tileborne",
      diagnostics,
      ...(sourceInventory === undefined ? {} : { sourceInventory }),
    });
  }

  const tilesetCount = arrayLength(manifest.tilesets);
  const tileCount = rawTileCount(manifest);
  const placeableCount = arrayLength(manifest.placeables);
  const source: PackCapabilitySource = "asset-only";
  const diagnostics: PackCapabilityDiagnostic[] = [
    ...parseDiagnostics(packId, parsed.diagnostics),
  ];
  if (tilesetCount === 0 || tileCount === 0) {
    diagnostics.push(
      new PackNoTilesetsDiagnostic({
        message: "Pack does not contain paintable tilesets.",
      }),
    );
  }
  if (unsupported !== undefined) {
    diagnostics.push(unsupported);
  }

  return new PackCapability({
    packId,
    paintable: false,
    tilesetCount,
    tileCount,
    placeableCount,
    autotileRuleCount: arrayLength(manifest.autotileRules),
    terrainClassCount: arrayLength(manifest.terrainClasses),
    hasAnimations: arrayLength(manifest.animations) > 0,
    hasCollisionMasks: arrayLength(manifest.collisionMasks) > 0,
    schemaVersion,
    source,
    diagnostics,
    ...(sourceInventory === undefined ? {} : { sourceInventory }),
  });
};

export const probePackCapabilityWithIntegrity = Effect.fn("AssetCapability.probePackCapabilityWithIntegrity")(function* ({
  packId,
  manifestPath,
}: ProbeInput) {
  const raw = yield* Effect.tryPromise({
    try: () => readFile(manifestPath, "utf8"),
    catch: (cause) => new PackCapabilityProbeError({ path: manifestPath, message: errorMessage(cause) }),
  });
  const json = yield* Effect.try({
    try: (): unknown => JSON.parse(raw),
    catch: (cause) => new PackCapabilityProbeError({ path: manifestPath, message: errorMessage(cause) }),
  });
  return {
    capability: detectPackCapability(packId, json),
    integrityHash: capabilityIntegrityHash(raw),
  };
});

export const readPackCapabilityIntegrityHash = Effect.fn("AssetCapability.readPackCapabilityIntegrityHash")(function* ({
  manifestPath,
}: Pick<ProbeInput, "manifestPath">) {
  const raw = yield* Effect.tryPromise({
    try: () => readFile(manifestPath, "utf8"),
    catch: (cause) => new PackCapabilityProbeError({ path: manifestPath, message: errorMessage(cause) }),
  });
  return capabilityIntegrityHash(raw);
});

export const probePackCapability = Effect.fn("AssetCapability.probePackCapability")(function* (
  input: ProbeInput,
) {
  const probe = yield* probePackCapabilityWithIntegrity(input);
  return probe.capability;
});

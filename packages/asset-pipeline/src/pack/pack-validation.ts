import { hashBytes } from "@tileborne/core";
import { Result } from "effect";

import { AssetTooLargeError, PackManifestIntegrityError } from "../errors.js";
import { validateAssetCandidate } from "../security/security.js";
import { MAX_PACK_BYTES } from "../security/size-limits.js";
import type { AssetPackManifest } from "./pack-manifest.js";

export interface AssetPackFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mime?: string;
  readonly filename?: string;
}

export const validatePackManifest = (
  manifest: AssetPackManifest,
  files: readonly AssetPackFile[],
): Result.Result<AssetPackManifest, PackManifestIntegrityError | AssetTooLargeError> => {
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const asset of manifest.assets) {
    if (seenIds.has(asset.id)) {
      return Result.fail(
        new PackManifestIntegrityError({
          path: asset.path,
          message: `Duplicate asset id: ${asset.id}`,
        }),
      );
    }
    seenIds.add(asset.id);

    if (seenPaths.has(asset.path)) {
      return Result.fail(
        new PackManifestIntegrityError({
          path: asset.path,
          message: `Duplicate asset path: ${asset.path}`,
        }),
      );
    }
    seenPaths.add(asset.path);
  }

  const filesByPath = new Map(files.map((file) => [file.path, file] as const));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (totalBytes > MAX_PACK_BYTES) {
    return Result.fail(
      new AssetTooLargeError({
        size: totalBytes,
        maxSize: MAX_PACK_BYTES,
        scope: "pack",
        message: `Pack exceeds ${MAX_PACK_BYTES} bytes`,
      }),
    );
  }

  for (const asset of manifest.assets) {
    const file = filesByPath.get(asset.path);
    if (file === undefined) {
      return Result.fail(
        new PackManifestIntegrityError({
          path: asset.path,
          message: "Manifest references a missing asset file",
        }),
      );
    }

    if (file.bytes.byteLength !== asset.size) {
      return Result.fail(
        new PackManifestIntegrityError({
          path: asset.path,
          message: `Size mismatch: manifest=${asset.size} actual=${file.bytes.byteLength}`,
        }),
      );
    }

    const actualHash = hashBytes(file.bytes);
    if (actualHash !== asset.hash) {
      return Result.fail(
        new PackManifestIntegrityError({
          path: asset.path,
          message: `Hash mismatch: manifest=${asset.hash} actual=${actualHash}`,
        }),
      );
    }

    const securityResult = validateAssetCandidate({
      mime: file.mime ?? asset.mime,
      bytes: file.bytes,
      filename: file.filename ?? asset.path,
    });
    if (Result.isFailure(securityResult)) {
      return Result.fail(
        new PackManifestIntegrityError({
          path: asset.path,
          message: "Asset failed security validation",
        }),
      );
    }
  }

  for (const file of files) {
    if (!manifest.assets.some((asset) => asset.path === file.path)) {
      return Result.fail(
        new PackManifestIntegrityError({
          path: file.path,
          message: "Pack contains a file not listed in the manifest",
        }),
      );
    }
  }

  return Result.succeed(manifest);
};

import { hashBytes, makeAssetId, makePackId } from "@tileborne/core";
import { Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import { PackManifestIntegrityError } from "../errors.js";
import { License } from "../license/license.js";
import {
  AssetPackManifest,
  AssetPackManifestAsset,
  hashAssetPackManifest,
} from "./pack-manifest.js";
import { validatePackManifest } from "./pack-validation.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const changedPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a]);
const license = new License({
  spdxId: "CC0-1.0",
  attribution: Option.none(),
  sourceUrl: Option.some("https://example.invalid/assets"),
  notes: Option.none(),
});

const asset = (path = "tiles/terrain.png", id = makeAssetId("550e8400-e29b-41d4-a716-446655440000")) =>
  new AssetPackManifestAsset({
    id,
    path,
    mime: "image/png",
    size: png.byteLength,
    hash: hashBytes(png),
    license: Option.none(),
  });

const manifest = (assets: readonly AssetPackManifestAsset[] = [asset()]) =>
  new AssetPackManifest({
    id: makePackId("550e8400-e29b-41d4-a716-446655440001"),
    name: "Tiny Dungeon",
    version: "1.0.0",
    license,
    assets: [...assets],
  });

describe("asset pack manifest", () => {
  it("hashes manifests through core canonical JSON hashing", () => {
    const left = manifest();
    const right = manifest();
    expect(hashAssetPackManifest(left)).toBe(hashAssetPackManifest(right));
    expect(hashAssetPackManifest(left)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("validates matching path, hash, size, and security metadata", () => {
    const result = validatePackManifest(manifest(), [
      {
        path: "tiles/terrain.png",
        mime: "image/png",
        filename: "terrain.png",
        bytes: png,
      },
    ]);
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("detects hash drift", () => {
    const result = validatePackManifest(manifest(), [
      {
        path: "tiles/terrain.png",
        mime: "image/png",
        filename: "terrain.png",
        bytes: changedPng,
      },
    ]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(PackManifestIntegrityError);
      expect(result.failure.message).toContain("Hash mismatch");
    }
  });

  it("detects duplicate asset ids", () => {
    const duplicated = asset("tiles/copy.png");
    const result = validatePackManifest(manifest([asset(), duplicated]), [
      {
        path: "tiles/terrain.png",
        mime: "image/png",
        filename: "terrain.png",
        bytes: png,
      },
      {
        path: "tiles/copy.png",
        mime: "image/png",
        filename: "copy.png",
        bytes: png,
      },
    ]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("Duplicate asset id");
    }
  });

  it("detects missing manifest assets", () => {
    const result = validatePackManifest(manifest(), []);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("missing asset file");
    }
  });

  it("detects unlisted files", () => {
    const result = validatePackManifest(manifest(), [
      {
        path: "tiles/terrain.png",
        mime: "image/png",
        filename: "terrain.png",
        bytes: png,
      },
      {
        path: "tiles/extra.png",
        mime: "image/png",
        filename: "extra.png",
        bytes: png,
      },
    ]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("not listed");
    }
  });
});

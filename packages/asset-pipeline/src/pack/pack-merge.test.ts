import { AssetId, ContentHash, PackId } from "@tileborne/core";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { PackAssetIdCollisionError } from "../errors.js";
import { License } from "../license/license.js";
import { indexPack } from "./pack-index.js";
import { mergePacks, PreferFirst, PreferLast, resolveConflicts, StrictFail } from "./pack-merge.js";
import { AssetPackManifest, AssetPackManifestAsset, assetsFromManifest } from "./pack-manifest.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}` as ContentHash;
const packId = (n: number): PackId =>
  `pack:550e8400-e29b-4${n.toString(16).padStart(3, "0")}-a716-446655440000` as PackId;
const assetId = (n: number): AssetId =>
  `asset:550e8400-e29b-4${n.toString(16).padStart(3, "0")}-a716-446655440000` as AssetId;

const license = new License({
  spdxId: "CC0-1.0",
  attribution: Option.none(),
  sourceUrl: Option.none(),
  notes: Option.none(),
});

const asset = (id: AssetId, path: string, n: number) =>
  new AssetPackManifestAsset({
    id,
    path,
    mime: "image/png",
    size: n * 10,
    hash: hash(n),
    license: Option.none(),
  });

const manifest = (id: PackId, assets: readonly AssetPackManifestAsset[]) =>
  new AssetPackManifest({
    id,
    name: id,
    version: "1.0.0",
    license,
    assets: [...assets],
  });

describe("pack merge", () => {
  it("merges packs in deterministic pack id order", () => {
    const later = manifest(packId(2), [asset(assetId(2), "b.png", 2)]);
    const earlier = manifest(packId(1), [asset(assetId(1), "a.png", 1)]);

    expect(
      mergePacks([
        indexPack(later, assetsFromManifest(later)),
        indexPack(earlier, assetsFromManifest(earlier)),
      ]).packs.map((pack) => pack.packId),
    ).toEqual([packId(1), packId(2)]);
  });

  it("includes assets from every pack", () => {
    const first = manifest(packId(1), [asset(assetId(1), "a.png", 1)]);
    const second = manifest(packId(2), [asset(assetId(2), "b.png", 2)]);

    expect(
      mergePacks([
        indexPack(first, assetsFromManifest(first)),
        indexPack(second, assetsFromManifest(second)),
      ]).assets.map((entry) => entry.path),
    ).toEqual(["a.png", "b.png"]);
  });

  it("surfaces asset id collisions without overriding", () => {
    const shared = assetId(7);
    const first = manifest(packId(1), [asset(shared, "first.png", 1)]);
    const second = manifest(packId(2), [asset(shared, "second.png", 2)]);
    const merged = mergePacks([
      indexPack(first, assetsFromManifest(first)),
      indexPack(second, assetsFromManifest(second)),
    ]);

    expect(merged.conflicts).toHaveLength(1);
    expect(merged.assetsById.get(shared)?.map((entry) => entry.path)).toEqual(["first.png", "second.png"]);
  });

  it("resolves collisions by preferring first deterministic pack", () => {
    const shared = assetId(7);
    const first = manifest(packId(1), [asset(shared, "first.png", 1)]);
    const second = manifest(packId(2), [asset(shared, "second.png", 2)]);
    const merged = mergePacks([
      indexPack(second, assetsFromManifest(second)),
      indexPack(first, assetsFromManifest(first)),
    ]);

    expect(resolveConflicts(merged, new PreferFirst({})).assets.map((entry) => entry.path)).toEqual(["first.png"]);
  });

  it("resolves collisions by preferring last deterministic pack", () => {
    const shared = assetId(7);
    const first = manifest(packId(1), [asset(shared, "first.png", 1)]);
    const second = manifest(packId(2), [asset(shared, "second.png", 2)]);
    const merged = mergePacks([
      indexPack(first, assetsFromManifest(first)),
      indexPack(second, assetsFromManifest(second)),
    ]);

    expect(resolveConflicts(merged, new PreferLast({})).assets.map((entry) => entry.path)).toEqual(["second.png"]);
  });

  it("strict-fail throws on collisions", () => {
    const shared = assetId(7);
    const first = manifest(packId(1), [asset(shared, "first.png", 1)]);
    const second = manifest(packId(2), [asset(shared, "second.png", 2)]);
    const merged = mergePacks([
      indexPack(first, assetsFromManifest(first)),
      indexPack(second, assetsFromManifest(second)),
    ]);

    expect(() => resolveConflicts(merged, new StrictFail({}))).toThrow(PackAssetIdCollisionError);
  });
});

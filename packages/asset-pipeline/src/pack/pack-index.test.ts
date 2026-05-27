import { AssetId, ContentHash, PackId } from "@tileborne/core";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { License } from "../license/license.js";
import { countByLicense, groupByFolder, indexPack, searchPackIndex } from "./pack-index.js";
import { AssetPackManifest, AssetPackManifestAsset, assetsFromManifest } from "./pack-manifest.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}` as ContentHash;
const packId = (n: number): PackId =>
  `pack:550e8400-e29b-4${n.toString(16).padStart(3, "0")}-a716-446655440000` as PackId;
const assetId = (n: number): AssetId =>
  `asset:550e8400-e29b-4${n.toString(16).padStart(3, "0")}-a716-446655440000` as AssetId;

const cc0 = new License({
  spdxId: "CC0-1.0",
  attribution: Option.none(),
  sourceUrl: Option.some("https://example.invalid/cc0"),
  notes: Option.none(),
});

const mit = new License({
  spdxId: "MIT",
  attribution: Option.some("Example Artist"),
  sourceUrl: Option.some("https://example.invalid/mit"),
  notes: Option.none(),
});

const asset = (n: number, path: string, mime: string, license = Option.none<License>()) =>
  new AssetPackManifestAsset({
    id: assetId(n),
    path,
    mime,
    size: n * 10,
    hash: hash(n),
    license,
  });

const manifest = new AssetPackManifest({
  id: packId(1),
  name: "Tiny Dungeon",
  version: "1.0.0",
  license: cc0,
  assets: [
    asset(1, "tiles/terrain/grass.png", "image/png"),
    asset(2, "tiles/terrain/water.png", "image/png"),
    asset(3, "tiles/walls/stone.png", "image/png"),
    asset(4, "decor/trees/oak.png", "image/png", Option.some(mit)),
    asset(5, "decor/rocks/round.png", "image/png", Option.some(mit)),
    asset(6, "metadata/palette.json", "application/json"),
  ],
});

const index = indexPack(manifest, assetsFromManifest(manifest));

describe("pack index", () => {
  it("builds folder groups from leading path segments", () => {
    expect(groupByFolder(index).get("tiles/terrain")?.map((entry) => entry.path)).toEqual([
      "tiles/terrain/grass.png",
      "tiles/terrain/water.png",
    ]);
  });

  it("counts assets by resolved license", () => {
    expect([...countByLicense(index).entries()]).toEqual([
      ["CC0-1.0", 4],
      ["MIT", 2],
    ]);
  });

  it("filters by case-insensitive path text", () => {
    expect(searchPackIndex(index, { text: "STONE" }).map((entry) => entry.path)).toEqual([
      "tiles/walls/stone.png",
    ]);
  });

  it("filters by mime type", () => {
    expect(searchPackIndex(index, { mime: "application/json" }).map((entry) => entry.path)).toEqual([
      "metadata/palette.json",
    ]);
  });

  it("filters by folder", () => {
    expect(searchPackIndex(index, { folder: "decor/rocks" }).map((entry) => entry.path)).toEqual([
      "decor/rocks/round.png",
    ]);
  });

  it("filters by license", () => {
    expect(searchPackIndex(index, { license: "MIT" }).map((entry) => entry.path)).toEqual([
      "decor/rocks/round.png",
      "decor/trees/oak.png",
    ]);
  });

  it("combines search filters", () => {
    expect(
      searchPackIndex(index, {
        text: "terrain",
        mime: "image/png",
        folder: "tiles/terrain",
        license: "CC0-1.0",
      }).map((entry) => entry.path),
    ).toEqual(["tiles/terrain/grass.png", "tiles/terrain/water.png"]);
  });
});

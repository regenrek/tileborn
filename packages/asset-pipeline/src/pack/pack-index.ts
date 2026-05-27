import { AssetId, PackId } from "@tileborne/core";
import { Option, Schema } from "effect";

import { License } from "../license/license.js";
import { AssetPackManifest, AssetPackManifestAsset, type Asset } from "./pack-manifest.js";

export class PackIndex extends Schema.Class<PackIndex>("PackIndex")({
  manifest: AssetPackManifest,
  packId: PackId,
  assets: Schema.Array(AssetPackManifestAsset),
  assetsById: Schema.ReadonlyMap(AssetId, AssetPackManifestAsset),
  folders: Schema.ReadonlyMap(Schema.String, Schema.Array(AssetPackManifestAsset)),
  licenseCounts: Schema.ReadonlyMap(Schema.String, Schema.Number),
  licensesByAssetId: Schema.ReadonlyMap(AssetId, License),
}) {}

export interface PackSearchQuery {
  readonly text?: string;
  readonly mime?: string;
  readonly folder?: string;
  readonly license?: string;
}

const folderForPath = (path: string): string => {
  const normalized = path.split("/").filter((segment) => segment.length > 0);
  if (normalized.length <= 1) {
    return "";
  }
  return normalized.slice(0, -1).join("/");
};

const freezeAssetGroups = (groups: Map<string, Asset[]>): ReadonlyMap<string, readonly Asset[]> =>
  new Map([...groups.entries()].map(([folder, assets]) => [folder, Object.freeze([...assets])]));

export const licenseForAsset = (index: PackIndex, asset: Asset): License =>
  Option.match(asset.license, {
    onNone: () => index.manifest.license,
    onSome: (license) => license,
  });

export const indexPack = (manifest: AssetPackManifest, assets: readonly Asset[]): PackIndex => {
  const sortedAssets = [...assets].sort((left, right) => left.path.localeCompare(right.path));
  const assetsById = new Map<AssetId, Asset>();
  const folders = new Map<string, Asset[]>();
  const licenseCounts = new Map<string, number>();
  const licensesByAssetId = new Map<AssetId, License>();

  for (const asset of sortedAssets) {
    assetsById.set(asset.id, asset);
    const license = Option.match(asset.license, {
      onNone: () => manifest.license,
      onSome: (value) => value,
    });
    licensesByAssetId.set(asset.id, license);

    const folder = folderForPath(asset.path);
    const folderAssets = folders.get(folder) ?? [];
    folderAssets.push(asset);
    folders.set(folder, folderAssets);

    const spdxId = license.spdxId;
    licenseCounts.set(spdxId, (licenseCounts.get(spdxId) ?? 0) + 1);
  }

  return new PackIndex({
    manifest,
    packId: manifest.id,
    assets: Object.freeze(sortedAssets),
    assetsById: new Map(assetsById),
    folders: freezeAssetGroups(folders),
    licenseCounts: new Map(licenseCounts),
    licensesByAssetId: new Map(licensesByAssetId),
  });
};

export const groupByFolder = (index: PackIndex): Map<string, Asset[]> =>
  new Map([...index.folders.entries()].map(([folder, assets]) => [folder, [...assets]]));

export const countByLicense = (index: PackIndex): Map<string, number> =>
  new Map([...index.licenseCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));

export const searchPackIndex = (index: PackIndex, query: PackSearchQuery): readonly Asset[] => {
  const text = query.text?.trim().toLowerCase();
  const folder = query.folder === "" ? undefined : query.folder;

  return index.assets.filter((asset) => {
    if (text !== undefined && text.length > 0) {
      const haystack = asset.path.toLowerCase();
      if (!haystack.includes(text)) {
        return false;
      }
    }

    if (query.mime !== undefined && asset.mime !== query.mime) {
      return false;
    }

    if (folder !== undefined && folderForPath(asset.path) !== folder) {
      return false;
    }

    if (query.license !== undefined && licenseForAsset(index, asset).spdxId !== query.license) {
      return false;
    }

    return true;
  });
};

export const folderFromAssetPath = folderForPath;

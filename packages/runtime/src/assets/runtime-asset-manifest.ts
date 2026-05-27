import { AssetPackManifest, AssetPackManifestAsset, License } from "@tileborne/asset-pipeline";
import type { AssetId, ContentHash, PackId } from "@tileborne/core";
import { Option } from "effect";

import type { RuntimeAssetManifest } from "./runtime-asset-loader.js";

export interface RuntimeAssetLicenseInput {
  readonly spdxId: string;
  readonly attribution?: Option.Option<string>;
  readonly sourceUrl?: Option.Option<string>;
  readonly notes?: Option.Option<string>;
}

export interface RuntimeAssetEntryInput {
  readonly id: AssetId;
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  readonly hash: ContentHash;
  readonly license?: Option.Option<License>;
}

export interface RuntimeAssetManifestInput {
  readonly id: PackId;
  readonly name: string;
  readonly version: string;
  readonly license: RuntimeAssetLicenseInput;
  readonly assets: readonly RuntimeAssetEntryInput[];
}

export const createRuntimeAssetPackLicense = (input: RuntimeAssetLicenseInput): License =>
  new License({
    spdxId: input.spdxId,
    attribution: input.attribution ?? Option.none(),
    sourceUrl: input.sourceUrl ?? Option.none(),
    notes: input.notes ?? Option.none(),
  });

export const createRuntimeAssetEntry = (input: RuntimeAssetEntryInput): AssetPackManifestAsset =>
  new AssetPackManifestAsset({
    id: input.id,
    path: input.path,
    mime: input.mime,
    size: input.size,
    hash: input.hash,
    license: input.license ?? Option.none(),
  });

export const createRuntimeAssetManifest = (input: RuntimeAssetManifestInput): RuntimeAssetManifest =>
  new AssetPackManifest({
    id: input.id,
    name: input.name,
    version: input.version,
    license: createRuntimeAssetPackLicense(input.license),
    assets: input.assets.map(createRuntimeAssetEntry),
  });

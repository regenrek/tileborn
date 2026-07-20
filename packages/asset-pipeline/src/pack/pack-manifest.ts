import { AssetId, ContentHash, PackId, hashJsonStable } from '@tileborne/core';
import { Option, Schema } from 'effect';

import { License } from '../license/license.js';

export class AssetPackManifestAsset extends Schema.Class<AssetPackManifestAsset>(
  'AssetPackManifestAsset',
)({
  id: AssetId,
  path: Schema.String,
  mime: Schema.String,
  size: Schema.Number,
  hash: ContentHash,
  license: Schema.OptionFromOptional(License),
}) {}

export type Asset = AssetPackManifestAsset;

export class AssetPackManifest extends Schema.Class<AssetPackManifest>('AssetPackManifest')({
  id: PackId,
  name: Schema.String,
  version: Schema.String,
  license: License,
  assets: Schema.Array(AssetPackManifestAsset),
}) {}

export interface AssetPackManifestJson {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license: {
    readonly spdxId: string;
    readonly attribution?: string;
    readonly sourceUrl?: string;
    readonly sourcePath?: string;
    readonly modifications?: string;
    readonly notes?: string;
    readonly redistributable: boolean;
  };
  readonly assets: readonly {
    readonly id: string;
    readonly path: string;
    readonly mime: string;
    readonly size: number;
    readonly hash: string;
    readonly license?: AssetPackManifestJson['license'];
  }[];
}

const optionProperty = <K extends string>(
  key: K,
  value: Option.Option<string>,
): Partial<Record<K, string>> =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (inner) => ({ [key]: inner }) as Record<K, string>,
  });

const optionalStringProperty = <K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> => (value === undefined ? {} : { [key]: value }) as Record<K, string>;

const licenseToJson = (license: License): AssetPackManifestJson['license'] => ({
  spdxId: license.spdxId,
  ...optionProperty('attribution', license.attribution),
  ...optionProperty('sourceUrl', license.sourceUrl),
  ...optionalStringProperty('sourcePath', license.sourcePath),
  ...optionalStringProperty('modifications', license.modifications),
  ...optionProperty('notes', license.notes),
  redistributable: license.redistributable ?? false,
});

export const assetPackManifestToJson = (manifest: AssetPackManifest): AssetPackManifestJson => ({
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  license: licenseToJson(manifest.license),
  assets: manifest.assets.map((asset) => ({
    id: asset.id,
    path: asset.path,
    mime: asset.mime,
    size: asset.size,
    hash: asset.hash,
    ...Option.match(asset.license, {
      onNone: () => ({}),
      onSome: (license) => ({ license: licenseToJson(license) }),
    }),
  })),
});

export const hashAssetPackManifest = (manifest: AssetPackManifest): ContentHash =>
  hashJsonStable(assetPackManifestToJson(manifest));

export const assetsFromManifest = (manifest: AssetPackManifest): readonly Asset[] =>
  manifest.assets;

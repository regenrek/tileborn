import { AssetId, PackId } from '@tileborne/core';
import { Schema } from 'effect';

export class AssetMimeRejectedError extends Schema.TaggedErrorClass<AssetMimeRejectedError>()(
  'AssetMimeRejectedError',
  {
    mime: Schema.String,
    message: Schema.String,
  },
) {}

export class AssetExtensionMismatchError extends Schema.TaggedErrorClass<AssetExtensionMismatchError>()(
  'AssetExtensionMismatchError',
  {
    filename: Schema.String,
    mime: Schema.String,
    extension: Schema.String,
    message: Schema.String,
  },
) {}

export class AssetMagicByteMismatchError extends Schema.TaggedErrorClass<AssetMagicByteMismatchError>()(
  'AssetMagicByteMismatchError',
  {
    mime: Schema.String,
    message: Schema.String,
  },
) {}

export class AssetTooLargeError extends Schema.TaggedErrorClass<AssetTooLargeError>()(
  'AssetTooLargeError',
  {
    size: Schema.Number,
    maxSize: Schema.Number,
    scope: Schema.String,
    message: Schema.String,
  },
) {}

export class TilesetGridMismatchError extends Schema.TaggedErrorClass<TilesetGridMismatchError>()(
  'TilesetGridMismatchError',
  {
    imageWidth: Schema.Number,
    imageHeight: Schema.Number,
    tileWidth: Schema.Number,
    tileHeight: Schema.Number,
    columns: Schema.Number,
    rows: Schema.Number,
    message: Schema.String,
  },
) {}

export class LicenseNotAllowlistedError extends Schema.TaggedErrorClass<LicenseNotAllowlistedError>()(
  'LicenseNotAllowlistedError',
  {
    spdxId: Schema.String,
    message: Schema.String,
  },
) {}

export class UnsupportedImporterInputError extends Schema.TaggedErrorClass<UnsupportedImporterInputError>()(
  'UnsupportedImporterInputError',
  {
    importerId: Schema.String,
    mime: Schema.String,
    message: Schema.String,
  },
) {}

export class PackManifestIntegrityError extends Schema.TaggedErrorClass<PackManifestIntegrityError>()(
  'PackManifestIntegrityError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

/** Raised when multiple packs expose the same asset id. */
export class PackAssetIdCollisionError extends Schema.TaggedErrorClass<PackAssetIdCollisionError>()(
  'PackAssetIdCollisionError',
  {
    id: AssetId,
    packs: Schema.Array(PackId),
    message: Schema.String,
  },
) {}

/** Raised when a pack delta cannot be applied to a catalog. */
export class PackDeltaApplyError extends Schema.TaggedErrorClass<PackDeltaApplyError>()(
  'PackDeltaApplyError',
  {
    packId: PackId,
    message: Schema.String,
  },
) {}

/** Raised when license reporting cannot summarize the supplied catalog. */
export class LicenseReportError extends Schema.TaggedErrorClass<LicenseReportError>()(
  'LicenseReportError',
  {
    message: Schema.String,
  },
) {}

export type AssetSecurityError =
  | AssetMimeRejectedError
  | AssetExtensionMismatchError
  | AssetMagicByteMismatchError
  | AssetTooLargeError;

export type AssetImportError =
  | AssetSecurityError
  | TilesetGridMismatchError
  | LicenseNotAllowlistedError
  | UnsupportedImporterInputError
  | PackManifestIntegrityError;

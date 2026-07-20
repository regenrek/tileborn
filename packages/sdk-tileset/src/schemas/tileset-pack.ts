import {
  AssetId,
  AssetLicense,
  assetLicenseUndefinedOptionRequiredRedistributableFields,
  PERSISTED_SCHEMA_VERSIONS,
  PackId,
} from '@tileborne/core';
import { Schema } from 'effect';

import { Placeable } from './placeable.js';
import { AssetSemanticRole } from './semantic-role.js';
import { Tileset } from './tileset.js';

/** License metadata attached to a tileset pack. */
export class TilesetPackLicense extends Schema.Class<TilesetPackLicense>('TilesetPackLicense')({
  ...assetLicenseUndefinedOptionRequiredRedistributableFields,
}) {}

/** Image or data asset referenced by a tileset pack. */
export class TilesetPackAsset extends Schema.Class<TilesetPackAsset>('TilesetPackAsset')({
  id: AssetId,
  path: Schema.String,
  mime: Schema.String,
  license: Schema.optional(AssetLicense),
}) {}

/** Top-level durable tileset pack container. */
export class TilesetPack extends Schema.Class<TilesetPack>('TilesetPack')({
  schemaVersion: Schema.Literal(PERSISTED_SCHEMA_VERSIONS.tilesetManifest),
  id: PackId,
  name: Schema.String,
  version: Schema.String,
  license: TilesetPackLicense,
  tilesets: Schema.Array(Tileset),
  assets: Schema.Array(TilesetPackAsset),
  placeables: Schema.optional(Schema.Array(Placeable)),
  semanticRoles: Schema.optional(Schema.Array(AssetSemanticRole)),
}) {}

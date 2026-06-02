import { Schema } from 'effect';

import {
  AssetLibraryCacheStatus,
  AssetLibraryGroup,
  AssetLibraryGroupKind,
  AssetLibraryReference,
  ContentHash,
  PackId,
} from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { IpcContractErrors } from './common.js';

export const AssetLibraryGetPackLibraryRequest = Schema.Struct({
  packId: PackId,
  query: Schema.optional(Schema.String),
  groupKind: Schema.optional(AssetLibraryGroupKind),
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
});

export const AssetLibraryGetPackLibraryResponse = Schema.Struct({
  packId: PackId,
  integrityHash: ContentHash,
  indexSchemaVersion: Schema.Number,
  previewRefLimit: Schema.Number,
  total: Schema.Number,
  offset: Schema.Number,
  limit: Schema.Number,
  groups: Schema.Array(AssetLibraryGroup),
});

export const AssetLibraryGetPackCacheStatusRequest = Schema.Struct({
  packId: PackId,
});

export const AssetLibraryGetPackCacheStatusResponse = Schema.Struct({
  status: AssetLibraryCacheStatus,
});

export const AssetLibraryReloadPackCacheRequest = Schema.Struct({
  packId: PackId,
});

export const AssetLibraryReloadPackCacheResponse = Schema.Struct({
  status: AssetLibraryCacheStatus,
});

export const AssetLibraryPreviewRect = Schema.Struct({
  assetPath: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

export const AssetLibraryResolvePreviewsRequest = Schema.Struct({
  packId: PackId,
  refs: Schema.Array(AssetLibraryReference),
});

export const AssetLibraryPreviewEntry = Schema.Struct({
  key: Schema.String,
  preview: Schema.optional(AssetLibraryPreviewRect),
});

export const AssetLibraryResolvePreviewsResponse = Schema.Struct({
  previews: Schema.Array(AssetLibraryPreviewEntry),
});

export const AssetLibraryGetEditorIndexRequest = Schema.Struct({
  packId: PackId,
});

export const AssetLibraryGetEditorIndexResponse = Schema.Struct({
  packId: PackId,
  integrityHash: ContentHash,
  schemaVersion: Schema.Number,
  // Serialized editor index JSON. Kept as an opaque string so the IPC boundary
  // does not re-validate the ~30k-entry structure; the renderer `JSON.parse`s it.
  indexJson: Schema.String,
});

export const AssetLibraryGetPackLibraryContract = defineContract({
  channel: 'tileborne:asset-library:getPackLibrary',
  request: AssetLibraryGetPackLibraryRequest,
  response: AssetLibraryGetPackLibraryResponse,
  errors: IpcContractErrors,
});

export const AssetLibraryGetPackCacheStatusContract = defineContract({
  channel: 'tileborne:asset-library:getPackCacheStatus',
  request: AssetLibraryGetPackCacheStatusRequest,
  response: AssetLibraryGetPackCacheStatusResponse,
  errors: IpcContractErrors,
});

export const AssetLibraryReloadPackCacheContract = defineContract({
  channel: 'tileborne:asset-library:reloadPackCache',
  request: AssetLibraryReloadPackCacheRequest,
  response: AssetLibraryReloadPackCacheResponse,
  errors: IpcContractErrors,
});

export const AssetLibraryResolvePreviewsContract = defineContract({
  channel: 'tileborne:asset-library:resolvePreviews',
  request: AssetLibraryResolvePreviewsRequest,
  response: AssetLibraryResolvePreviewsResponse,
  errors: IpcContractErrors,
});

export const AssetLibraryGetEditorIndexContract = defineContract({
  channel: 'tileborne:asset-library:getEditorIndex',
  request: AssetLibraryGetEditorIndexRequest,
  response: AssetLibraryGetEditorIndexResponse,
  errors: IpcContractErrors,
});

export const AssetLibraryContracts = [
  AssetLibraryGetPackLibraryContract,
  AssetLibraryGetPackCacheStatusContract,
  AssetLibraryReloadPackCacheContract,
  AssetLibraryResolvePreviewsContract,
  AssetLibraryGetEditorIndexContract,
] as const;

export const AssetLibraryIpcRegistry = createRegistry(AssetLibraryContracts);

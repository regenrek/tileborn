import { Schema } from 'effect';

import {
  AssetLibraryCacheStatus,
  AssetLibraryGroup,
  AssetLibraryGroupKind,
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

export const AssetLibraryContracts = [
  AssetLibraryGetPackLibraryContract,
  AssetLibraryGetPackCacheStatusContract,
  AssetLibraryReloadPackCacheContract,
] as const;

export const AssetLibraryIpcRegistry = createRegistry(AssetLibraryContracts);

import { Schema } from 'effect';

import { ContentHash } from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { EmptyResponse, IpcContractErrors } from './common.js';
import { JobId } from './assets.js';

export const SupportBundleId = Schema.String.check(
  Schema.isPattern(/^support:[0-9a-f-]{36}$/),
).pipe(Schema.brand('SupportBundleId'));

export const SupportBundleSummary = Schema.Struct({
  id: SupportBundleId,
  createdAt: Schema.String,
  integrityHash: ContentHash,
});

export const SupportCreateBundleRequest = Schema.Struct({});
export const SupportCreateBundleResponse = Schema.Struct({
  jobId: JobId,
});

export const SupportGetBundleRequest = Schema.Struct({
  bundleId: SupportBundleId,
});
export const SupportGetBundleResponse = Schema.Struct({
  bundle: SupportBundleSummary,
});

export const SupportListBundlesRequest = Schema.Struct({});
export const SupportListBundlesResponse = Schema.Struct({
  bundles: Schema.Array(SupportBundleSummary),
});

export const SupportDeleteBundleRequest = Schema.Struct({
  bundleId: SupportBundleId,
});

export const SupportCreateBundleContract = defineContract({
  channel: 'tileborne:support:createBundle',
  request: SupportCreateBundleRequest,
  response: SupportCreateBundleResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000 },
});

export const SupportGetBundleContract = defineContract({
  channel: 'tileborne:support:getBundle',
  request: SupportGetBundleRequest,
  response: SupportGetBundleResponse,
  errors: IpcContractErrors,
});

export const SupportListBundlesContract = defineContract({
  channel: 'tileborne:support:listBundles',
  request: SupportListBundlesRequest,
  response: SupportListBundlesResponse,
  errors: IpcContractErrors,
});

export const SupportDeleteBundleContract = defineContract({
  channel: 'tileborne:support:deleteBundle',
  request: SupportDeleteBundleRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
});

export const SupportContracts = [
  SupportCreateBundleContract,
  SupportGetBundleContract,
  SupportListBundlesContract,
  SupportDeleteBundleContract,
] as const;

export const SupportIpcRegistry = createRegistry(SupportContracts);

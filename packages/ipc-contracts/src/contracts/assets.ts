import { Schema } from "effect";

import {
  ContentHash,
  PackCapability,
  PackCapabilityDiagnostic,
  PackId,
  ProjectId,
  WorkingPaletteId,
} from "@tileborne/core";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { IpcContractErrors } from "./common.js";

export const JobId = Schema.String.check(Schema.isPattern(/^job:[0-9a-f-]{36}$/)).pipe(
  Schema.brand("JobId"),
);

export const AssetPackSummary = Schema.Struct({
  id: PackId,
  name: Schema.String,
  version: Schema.String,
  licenseSpdxId: Schema.String,
  integrityHash: ContentHash,
  assetCount: Schema.Number,
  capability: PackCapability,
});

export const AssetPackSourceKind = Schema.Literals(["directory"]);

export const AssetsListPacksRequest = Schema.Struct({});
export const AssetsListPacksResponse = Schema.Struct({
  packs: Schema.Array(AssetPackSummary),
});

export const AssetsGetPackRequest = Schema.Struct({
  packId: PackId,
});
export const AssetsGetPackResponse = Schema.Struct({
  pack: AssetPackSummary,
});

export const AssetsDescribePackRequest = Schema.Struct({
  packId: PackId,
});
export const AssetsDescribePackResponse = Schema.Struct({
  pack: AssetPackSummary,
  capability: PackCapability,
  diagnostics: Schema.Array(PackCapabilityDiagnostic),
});

export const AssetsImportPackRequest = Schema.Struct({
  sourceKind: AssetPackSourceKind,
  path: Schema.String,
});
export const AssetsImportPackResponse = Schema.Struct({
  jobId: JobId,
});

export const AssetImportDetectedKind = Schema.Literals([
  "tileborne-pack",
  "tiled-source",
  "ambiguous",
  "zip",
  "unsupported",
]);
export const AssetImportPreferredKind = Schema.Literals([
  "tileborne-pack",
  "tiled-source",
]);
export const AssetsDetectImportSourceRequest = Schema.Struct({
  path: Schema.String,
});
export const AssetImportSourceDetection = Schema.Struct({
  kind: AssetImportDetectedKind,
  path: Schema.String,
  detectedTypes: Schema.Array(Schema.String),
  hasTileborneManifest: Schema.Boolean,
  tiledMapCount: Schema.Number,
  tiledTilesetCount: Schema.Number,
  message: Schema.String,
  preferredKind: Schema.optional(AssetImportPreferredKind),
});
export const AssetsDetectImportSourceResponse = Schema.Struct({
  detection: AssetImportSourceDetection,
});

export const AssetsRemovePackRequest = Schema.Struct({
  packId: PackId,
});
export const AssetsRemovePackResponse = Schema.Struct({
  removedPackId: PackId,
  invalidatedAssetLibraryCacheEntries: Schema.Number,
  prunedWorkingPaletteItemCount: Schema.Number,
  affectedProjectIds: Schema.Array(ProjectId),
  affectedPaletteIds: Schema.Array(WorkingPaletteId),
});

export const AssetPackAssetView = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  mime: Schema.String,
});

export const AssetsListPackAssetsRequest = Schema.Struct({
  packId: PackId,
});
export const AssetsListPackAssetsResponse = Schema.Struct({
  assets: Schema.Array(AssetPackAssetView),
});

export const AssetsGetAssetDataUrlRequest = Schema.Struct({
  packId: PackId,
  assetPath: Schema.String,
});
export const AssetsGetAssetDataUrlResponse = Schema.Struct({
  dataUrl: Schema.String,
});

export const AssetsCapabilityRefreshedEventPayload = Schema.Struct({
  packId: PackId,
  capability: PackCapability,
});

export const AssetsListPacksContract = defineContract({
  channel: "tileborne:assets:listPacks",
  request: AssetsListPacksRequest,
  response: AssetsListPacksResponse,
  errors: IpcContractErrors,
});

export const AssetsGetPackContract = defineContract({
  channel: "tileborne:assets:getPack",
  request: AssetsGetPackRequest,
  response: AssetsGetPackResponse,
  errors: IpcContractErrors,
});

export const AssetsDescribePackContract = defineContract({
  channel: "tileborne:assets:describePack",
  request: AssetsDescribePackRequest,
  response: AssetsDescribePackResponse,
  errors: IpcContractErrors,
});

export const AssetsImportPackContract = defineContract({
  channel: "tileborne:assets:importPack",
  request: AssetsImportPackRequest,
  response: AssetsImportPackResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000, requiresApproval: true },
});

export const AssetsDetectImportSourceContract = defineContract({
  channel: "tileborne:assets:detectImportSource",
  request: AssetsDetectImportSourceRequest,
  response: AssetsDetectImportSourceResponse,
  errors: IpcContractErrors,
});

export const AssetsRemovePackContract = defineContract({
  channel: "tileborne:assets:removePack",
  request: AssetsRemovePackRequest,
  response: AssetsRemovePackResponse,
  errors: IpcContractErrors,
  meta: { requiresApproval: true },
});

export const AssetsListPackAssetsContract = defineContract({
  channel: "tileborne:assets:listPackAssets",
  request: AssetsListPackAssetsRequest,
  response: AssetsListPackAssetsResponse,
  errors: IpcContractErrors,
});

export const AssetsGetAssetDataUrlContract = defineContract({
  channel: "tileborne:assets:getAssetDataUrl",
  request: AssetsGetAssetDataUrlRequest,
  response: AssetsGetAssetDataUrlResponse,
  errors: IpcContractErrors,
});

export const AssetsContracts = [
  AssetsListPacksContract,
  AssetsGetPackContract,
  AssetsDescribePackContract,
  AssetsDetectImportSourceContract,
  AssetsImportPackContract,
  AssetsRemovePackContract,
  AssetsListPackAssetsContract,
  AssetsGetAssetDataUrlContract,
] as const;

export const AssetsIpcRegistry = createRegistry(AssetsContracts);

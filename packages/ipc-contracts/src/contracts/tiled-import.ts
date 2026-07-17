import { MapId, PackId, ProjectId } from '@tileborne/core';
import { Schema } from 'effect';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { EmptyResponse, IpcContractErrors } from './common.js';
import {
  ImportCenterApplyReport,
  ImportCenterDiagnostic,
  ImportCenterSourceKind,
  TiledImportInventoryPreview,
  TiledImportPlan,
  TiledImportScan,
} from './import-center.js';

const SafePath = Schema.String.check(Schema.isPattern(/^[^\0]+$/));

export const TiledImportLicense = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  attribution: Schema.optional(Schema.String),
  redistributable: Schema.Boolean,
});
export type TiledImportLicense = typeof TiledImportLicense.Type;

export const TiledImportHints = Schema.Struct({
  acceptedSuggestionIds: Schema.optional(Schema.Array(Schema.String)),
});
export type TiledImportHints = typeof TiledImportHints.Type;

const TiledImportPluginId = Schema.String.check(
  Schema.isLengthBetween(1, 64),
  Schema.isPattern(/^[^\s/\\]+$/),
);

const TiledImportWizardProfile = Schema.Union([
  Schema.Literal('standard'),
  Schema.Literal('standard-plus-hints'),
  Schema.Literal('assistive-infer'),
  Schema.Struct({
    kind: Schema.Literal('plugin'),
    id: TiledImportPluginId,
  }),
]);

export const TiledImportScanRequest = Schema.Struct({
  projectId: ProjectId,
  sourcePath: SafePath,
});
export const TiledImportScanResponse = Schema.Struct({
  sourceKind: ImportCenterSourceKind,
  scan: TiledImportScan,
  diagnostics: Schema.Array(ImportCenterDiagnostic),
  inventoryPreview: TiledImportInventoryPreview,
});

export const TiledImportPlanRequest = Schema.Struct({
  projectId: ProjectId,
  sourcePath: SafePath,
  profile: TiledImportWizardProfile,
  hints: Schema.optional(TiledImportHints),
});
export const TiledImportPlanResponse = Schema.Struct({
  sourceKind: ImportCenterSourceKind,
  plan: TiledImportPlan,
  diagnostics: Schema.Array(ImportCenterDiagnostic),
  inventoryPreview: TiledImportInventoryPreview,
});

export const TiledImportApplyRequest = Schema.Struct({
  projectId: ProjectId,
  sourcePath: SafePath,
  profile: TiledImportWizardProfile,
  hints: Schema.optional(TiledImportHints),
  license: TiledImportLicense,
});
export const TiledImportMapApplyResponse = Schema.Struct({
  kind: Schema.Literal('map'),
  mapId: MapId,
  layerCount: Schema.Number,
  objectCount: Schema.Number,
  packId: Schema.optional(PackId),
  report: ImportCenterApplyReport,
});
export const TiledImportAssetPackApplyResponse = Schema.Struct({
  kind: Schema.Literal('asset-pack'),
  packId: PackId,
  report: ImportCenterApplyReport,
});
export const TiledImportApplyResponse = Schema.Union([
  TiledImportMapApplyResponse,
  TiledImportAssetPackApplyResponse,
]);

export const TiledImportCancelRequest = Schema.Struct({
  projectId: ProjectId,
  sourcePath: SafePath,
});

export const TiledImportScanContract = defineContract({
  channel: 'tileborne:tiled-import:scan',
  request: TiledImportScanRequest,
  response: TiledImportScanResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const TiledImportPlanContract = defineContract({
  channel: 'tileborne:tiled-import:plan',
  request: TiledImportPlanRequest,
  response: TiledImportPlanResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const TiledImportApplyContract = defineContract({
  channel: 'tileborne:tiled-import:apply',
  request: TiledImportApplyRequest,
  response: TiledImportApplyResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000 },
});

export const TiledImportCancelContract = defineContract({
  channel: 'tileborne:tiled-import:cancel',
  request: TiledImportCancelRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
});

export const TiledImportContracts = [
  TiledImportScanContract,
  TiledImportPlanContract,
  TiledImportApplyContract,
  TiledImportCancelContract,
] as const;

export const TiledImportIpcRegistry = createRegistry(TiledImportContracts);

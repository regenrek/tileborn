import { Schema } from 'effect';

import { BuildId, ContentHash } from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { EmptyResponse, IpcContractErrors } from './common.js';
import { JobId } from './assets.js';

export const ExportId = Schema.String.check(Schema.isPattern(/^export:[0-9a-f-]{36}$/)).pipe(
  Schema.brand('ExportId'),
);

export const ExportTargetView = Schema.Unknown;

export const ExportSummary = Schema.Struct({
  id: ExportId,
  buildId: BuildId,
  target: ExportTargetView,
  createdAt: Schema.String,
  integrityHash: ContentHash,
});

export const ExportsExportBuildRequest = Schema.Struct({
  buildId: BuildId,
  target: ExportTargetView,
});
export const ExportsExportBuildResponse = Schema.Struct({
  jobId: JobId,
});

export const ExportsGetExportRequest = Schema.Struct({
  exportId: ExportId,
});
export const ExportsGetExportResponse = Schema.Struct({
  export: ExportSummary,
});

export const ExportsListExportsRequest = Schema.Struct({
  buildId: BuildId,
});
export const ExportsListExportsResponse = Schema.Struct({
  exports: Schema.Array(ExportSummary),
});

export const ExportsDeleteExportRequest = Schema.Struct({
  exportId: ExportId,
});

export const ExportsExportBuildContract = defineContract({
  channel: 'tileborne:exports:exportBuild',
  request: ExportsExportBuildRequest,
  response: ExportsExportBuildResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 120_000 },
});

export const ExportsGetExportContract = defineContract({
  channel: 'tileborne:exports:getExport',
  request: ExportsGetExportRequest,
  response: ExportsGetExportResponse,
  errors: IpcContractErrors,
});

export const ExportsListExportsContract = defineContract({
  channel: 'tileborne:exports:listExports',
  request: ExportsListExportsRequest,
  response: ExportsListExportsResponse,
  errors: IpcContractErrors,
});

export const ExportsDeleteExportContract = defineContract({
  channel: 'tileborne:exports:deleteExport',
  request: ExportsDeleteExportRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
});

export const ExportsContracts = [
  ExportsExportBuildContract,
  ExportsGetExportContract,
  ExportsListExportsContract,
  ExportsDeleteExportContract,
] as const;

export const ExportsIpcRegistry = createRegistry(ExportsContracts);

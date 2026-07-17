import { Schema } from 'effect';

import { ContentHash, MapId, ProjectId } from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { JobId } from './assets.js';
import { BuildTarget } from './builds.js';
import { IpcContractErrors } from './common.js';

export const ShipGameArtifact = Schema.Struct({
  projectId: ProjectId,
  startupMapId: MapId,
  pluginId: Schema.String,
  target: BuildTarget,
  directory: Schema.String,
  manifestPath: Schema.String,
  bundlePath: Schema.String,
  buildId: ContentHash,
  runtimeBuildId: ContentHash,
  integrityHash: ContentHash,
  createdAt: Schema.String,
  files: Schema.Array(Schema.String),
  fileHashes: Schema.Record(Schema.String, ContentHash),
  previewCommand: Schema.String,
});

export const ShipStartRequest = Schema.Struct({
  projectId: ProjectId,
  startupMapId: MapId,
  target: BuildTarget,
});

export const ShipStartResponse = Schema.Struct({ jobId: JobId });

export const ShipLaunchPreviewRequest = Schema.Struct({ artifact: ShipGameArtifact });
export const ShipLaunchPreviewResponse = Schema.Struct({
  baseUrl: Schema.String,
  roomId: Schema.String,
});

export const ShipOpenArtifactRequest = Schema.Struct({ directory: Schema.String });
export const ShipOpenArtifactResponse = Schema.Struct({ opened: Schema.Boolean });

export const ShipStartContract = defineContract({
  channel: 'tileborne:ship:start',
  request: ShipStartRequest,
  response: ShipStartResponse,
  errors: IpcContractErrors,
});

export const ShipLaunchPreviewContract = defineContract({
  channel: 'tileborne:ship:launchPreview',
  request: ShipLaunchPreviewRequest,
  response: ShipLaunchPreviewResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const ShipOpenArtifactContract = defineContract({
  channel: 'tileborne:ship:openArtifact',
  request: ShipOpenArtifactRequest,
  response: ShipOpenArtifactResponse,
  errors: IpcContractErrors,
});

export const ShipContracts = [
  ShipStartContract,
  ShipLaunchPreviewContract,
  ShipOpenArtifactContract,
] as const;

export const ShipIpcRegistry = createRegistry(ShipContracts);

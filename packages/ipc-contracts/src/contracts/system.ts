import { Schema } from 'effect';

import { MapId, ProjectId } from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { EmptyRequest, IpcContractErrors } from './common.js';

export const SystemPingResponse = Schema.Struct({
  pong: Schema.Boolean,
  ts: Schema.Number,
});

export const SystemGetVersionResponse = Schema.Struct({
  appVersion: Schema.String,
  electronVersion: Schema.String,
  chromeVersion: Schema.String,
  nodeVersion: Schema.String,
});

export const TileborneHomePathsView = Schema.Struct({
  root: Schema.String,
  config: Schema.String,
  plugins: Schema.String,
  assets: Schema.String,
  projects: Schema.String,
  cache: Schema.String,
  logs: Schema.String,
});

export const SystemGetHomePathsResponse = Schema.Struct({
  paths: TileborneHomePathsView,
});

export const SystemPingContract = defineContract({
  channel: 'tileborne:system:ping',
  request: EmptyRequest,
  response: SystemPingResponse,
  errors: IpcContractErrors,
});

export const SystemGetVersionContract = defineContract({
  channel: 'tileborne:system:getVersion',
  request: EmptyRequest,
  response: SystemGetVersionResponse,
  errors: IpcContractErrors,
});

export const SystemGetHomePathsContract = defineContract({
  channel: 'tileborne:system:getHomePaths',
  request: EmptyRequest,
  response: SystemGetHomePathsResponse,
  errors: IpcContractErrors,
});

export const SystemPickDirectoryRequest = EmptyRequest;
export const SystemPickDirectoryResponse = Schema.Struct({
  path: Schema.optional(Schema.String),
});
export const SystemPickImportSourceRequest = EmptyRequest;
export const SystemPickImportSourceResponse = Schema.Struct({
  path: Schema.optional(Schema.String),
});

export const SystemPickDirectoryContract = defineContract({
  channel: 'tileborne:system:pickDirectory',
  request: SystemPickDirectoryRequest,
  response: SystemPickDirectoryResponse,
  errors: IpcContractErrors,
});

export const SystemPickImportSourceContract = defineContract({
  channel: 'tileborne:system:pickImportSource',
  request: SystemPickImportSourceRequest,
  response: SystemPickImportSourceResponse,
  errors: IpcContractErrors,
});

export const SystemOpenPlaytestJoinWindowRequest = Schema.Struct({
  projectId: ProjectId,
  mapId: MapId,
  baseUrl: Schema.String,
  roomId: Schema.String,
});

export const SystemOpenPlaytestJoinWindowResponse = Schema.Struct({
  opened: Schema.Boolean,
});

export const SystemOpenPlaytestJoinWindowContract = defineContract({
  channel: 'tileborne:system:openPlaytestJoinWindow',
  request: SystemOpenPlaytestJoinWindowRequest,
  response: SystemOpenPlaytestJoinWindowResponse,
  errors: IpcContractErrors,
});

export const SystemContracts = [
  SystemPingContract,
  SystemGetVersionContract,
  SystemGetHomePathsContract,
  SystemPickDirectoryContract,
  SystemPickImportSourceContract,
  SystemOpenPlaytestJoinWindowContract,
] as const;

export const SystemIpcRegistry = createRegistry(SystemContracts);

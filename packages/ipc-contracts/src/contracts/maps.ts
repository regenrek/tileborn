import { Schema } from 'effect';

import { MapId, PackId, ProjectId, TileborneMap } from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { EmptyResponse, IpcContractErrors } from './common.js';

export const MapSummary = Schema.Struct({
  id: MapId,
  label: Schema.optional(Schema.String),
  path: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  layerCount: Schema.Number,
  objectCount: Schema.Number,
});

export const MapsListRequest = Schema.Struct({
  projectId: ProjectId,
});
export const MapsListResponse = Schema.Struct({
  maps: Schema.Array(MapSummary),
});

export const MapsGetRequest = Schema.Struct({
  projectId: ProjectId,
  mapId: MapId,
});
export const MapsGetResponse = Schema.Struct({
  map: TileborneMap,
});

export const MapsCreateRequest = Schema.Struct({
  projectId: ProjectId,
  width: Schema.Number,
  height: Schema.Number,
  tileWidth: Schema.optional(Schema.Number),
  tileHeight: Schema.optional(Schema.Number),
});
export const MapsCreateResponse = Schema.Struct({
  mapId: MapId,
});

export const MapsUpdateRequest = Schema.Struct({
  projectId: ProjectId,
  map: TileborneMap,
});

export const MapsSetMapTilesetPackRequest = Schema.Struct({
  projectId: ProjectId,
  mapId: MapId,
  packId: PackId,
});
export const MapsSetMapTilesetPackResponse = Schema.Struct({
  map: MapSummary,
});

export const TiledImportPluginId = Schema.String.check(
  Schema.isLengthBetween(1, 64),
  Schema.isPattern(/^[^\s/\\]+$/),
).pipe(Schema.brand('TiledImportPluginId'));

export const TiledImportProfile = Schema.Union([
  Schema.Literal('standard'),
  Schema.Literal('standard-plus-hints'),
  Schema.Literal('assistive-infer'),
  Schema.Struct({
    kind: Schema.Literal('plugin'),
    id: TiledImportPluginId,
  }),
]);
export type TiledImportProfile = typeof TiledImportProfile.Type;

export const MapsScanTiledRequest = Schema.Struct({
  projectId: ProjectId,
  file: Schema.String,
});
export const MapsScanTiledResponse = Schema.Struct({
  scan: Schema.Unknown,
});

export const MapsImportTiledRequest = Schema.Struct({
  projectId: ProjectId,
  file: Schema.String,
  profile: Schema.optional(TiledImportProfile),
});
export const MapsImportTiledResponse = Schema.Struct({
  mapId: MapId,
  layerCount: Schema.Number,
  objectCount: Schema.Number,
  packId: Schema.optional(PackId),
});

export const MapsDeleteRequest = Schema.Struct({
  projectId: ProjectId,
  mapId: MapId,
});

export const MapGeneratePreset = Schema.Literals(['open', 'dungeon', 'arena']);

export const MapsGenerateRequest = Schema.Struct({
  projectId: ProjectId,
  width: Schema.Number,
  height: Schema.Number,
  seed: Schema.Number,
  preset: MapGeneratePreset,
  tilesetPackId: Schema.optional(PackId),
});
export const MapsGenerateResponse = Schema.Struct({
  map: TileborneMap,
});

export const MapsListContract = defineContract({
  channel: 'tileborne:maps:list',
  request: MapsListRequest,
  response: MapsListResponse,
  errors: IpcContractErrors,
});

export const MapsGetContract = defineContract({
  channel: 'tileborne:maps:get',
  request: MapsGetRequest,
  response: MapsGetResponse,
  errors: IpcContractErrors,
});

export const MapsCreateContract = defineContract({
  channel: 'tileborne:maps:create',
  request: MapsCreateRequest,
  response: MapsCreateResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const MapsUpdateContract = defineContract({
  channel: 'tileborne:maps:update',
  request: MapsUpdateRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const MapsSetMapTilesetPackContract = defineContract({
  channel: 'tileborne:maps:setMapTilesetPack',
  request: MapsSetMapTilesetPackRequest,
  response: MapsSetMapTilesetPackResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const MapsScanTiledContract = defineContract({
  channel: 'tileborne:maps:scanTiled',
  request: MapsScanTiledRequest,
  response: MapsScanTiledResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const MapsImportTiledContract = defineContract({
  channel: 'tileborne:maps:importTiled',
  request: MapsImportTiledRequest,
  response: MapsImportTiledResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const MapsDeleteContract = defineContract({
  channel: 'tileborne:maps:delete',
  request: MapsDeleteRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
});

export const MapsGenerateContract = defineContract({
  channel: 'tileborne:maps:generate',
  request: MapsGenerateRequest,
  response: MapsGenerateResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const MapsContracts = [
  MapsListContract,
  MapsGetContract,
  MapsCreateContract,
  MapsUpdateContract,
  MapsSetMapTilesetPackContract,
  MapsScanTiledContract,
  MapsImportTiledContract,
  MapsDeleteContract,
  MapsGenerateContract,
] as const;

export const MapsIpcRegistry = createRegistry(MapsContracts);

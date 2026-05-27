import type { Schema } from 'effect';

import {
  AssetLibraryGetPackCacheStatusResponse,
  AssetLibraryGetPackLibraryResponse,
  AssetLibraryReloadPackCacheResponse,
  AssetsDetectImportSourceResponse,
  AssetsGetAssetDataUrlResponse,
  AssetsGetPackResponse,
  AssetsListPacksResponse,
  AssetsRemovePackResponse,
  JobsListResponse,
  LogsListRecentResponse,
  MapsGetResponse,
  MapsGenerateResponse,
  MapsImportTiledResponse,
  MapsListResponse,
  MapsScanTiledResponse,
  MapsSetMapTilesetPackResponse,
  PlaytestListResponse,
  PlaytestStartResponse,
  PluginsGetManifestResponse,
  PluginsInstallBundledBattleRoyaleResponse,
  PluginsInstallResponse,
  PluginsListContributionsResponse,
  PluginsListResponse,
  ProjectsCreateResponse,
  ProjectsGetResponse,
  ProjectsListResponse,
  SystemGetHomePathsResponse,
  SystemGetVersionResponse,
  TiledImportApplyResponse,
  TiledImportPlanResponse,
  TiledImportScanResponse,
  WorkingPalettesGetActiveResponse,
  WorkingPalettesListResponse,
  WorkingPalettesPaletteResponse,
} from '@tileborne/ipc-contracts';

export type ProjectsListResponse = Schema.Schema.Type<typeof ProjectsListResponse>;
export type ProjectGetResponse = Schema.Schema.Type<typeof ProjectsGetResponse>;
export type ProjectsCreateResponse = Schema.Schema.Type<typeof ProjectsCreateResponse>;

export type MapsListResponse = Schema.Schema.Type<typeof MapsListResponse>;
export type MapGetResponse = Schema.Schema.Type<typeof MapsGetResponse>;
export type MapsGenerateResponse = Schema.Schema.Type<typeof MapsGenerateResponse>;
export type MapsScanTiledResponse = Schema.Schema.Type<typeof MapsScanTiledResponse>;
export type MapsImportTiledResponse = Schema.Schema.Type<typeof MapsImportTiledResponse>;
export type MapsSetMapTilesetPackResponse = Schema.Schema.Type<
  typeof MapsSetMapTilesetPackResponse
>;
export type TiledImportScanResponse = Schema.Schema.Type<typeof TiledImportScanResponse>;
export type TiledImportPlanResponse = Schema.Schema.Type<typeof TiledImportPlanResponse>;
export type TiledImportApplyResponse = Schema.Schema.Type<typeof TiledImportApplyResponse>;

export type AssetPacksListResponse = Schema.Schema.Type<typeof AssetsListPacksResponse>;
export type AssetPackGetResponse = Schema.Schema.Type<typeof AssetsGetPackResponse>;
export type AssetPackRemoveResponse = Schema.Schema.Type<typeof AssetsRemovePackResponse>;
export type AssetImportDetectSourceResponse = Schema.Schema.Type<typeof AssetsDetectImportSourceResponse>;
export type AssetDataUrlResponse = Schema.Schema.Type<typeof AssetsGetAssetDataUrlResponse>;
export type AssetLibraryGetPackLibraryResponse = Schema.Schema.Type<
  typeof AssetLibraryGetPackLibraryResponse
>;
export type AssetLibraryGetPackCacheStatusResponse = Schema.Schema.Type<
  typeof AssetLibraryGetPackCacheStatusResponse
>;
export type AssetLibraryReloadPackCacheResponse = Schema.Schema.Type<
  typeof AssetLibraryReloadPackCacheResponse
>;
export type WorkingPalettesListResponse = Schema.Schema.Type<typeof WorkingPalettesListResponse>;
export type WorkingPalettesGetActiveResponse = Schema.Schema.Type<
  typeof WorkingPalettesGetActiveResponse
>;
export type WorkingPalettesPaletteResponse = Schema.Schema.Type<
  typeof WorkingPalettesPaletteResponse
>;

export type PluginsListResponse = Schema.Schema.Type<typeof PluginsListResponse>;
export type PluginsInstallResponse = Schema.Schema.Type<typeof PluginsInstallResponse>;
export type PluginsInstallBundledBattleRoyaleResponse = Schema.Schema.Type<
  typeof PluginsInstallBundledBattleRoyaleResponse
>;
export type PluginManifestResponse = Schema.Schema.Type<typeof PluginsGetManifestResponse>;
export type PluginContributionsResponse = Schema.Schema.Type<typeof PluginsListContributionsResponse>;

export type JobsListResponse = Schema.Schema.Type<typeof JobsListResponse>;
export type LogsListRecentResponse = Schema.Schema.Type<typeof LogsListRecentResponse>;

export type PlaytestListResponse = Schema.Schema.Type<typeof PlaytestListResponse>;
export type PlaytestStartResponse = Schema.Schema.Type<typeof PlaytestStartResponse>;

export type HomePathsResponse = Schema.Schema.Type<typeof SystemGetHomePathsResponse>;
export type SystemVersionResponse = Schema.Schema.Type<typeof SystemGetVersionResponse>;

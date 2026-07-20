import type { Schema } from 'effect';

import {
  AssetLibraryGetPackCacheStatusResponse,
  AssetLibraryGetPackLibraryResponse,
  AssetLibraryGetPackUseSitesResponse,
  AssetLibraryReloadPackCacheResponse,
  AssetLibraryResolvePreviewsResponse,
  AudioApplyResponse,
  AudioOpenResponse,
  AudioPreviewResponse,
  AudioSaveResponse,
  GameShellApplyResponse,
  GameShellOpenResponse,
  GameShellPreviewResponse,
  GameShellSaveResponse,
  BehaviorsOpenResponse,
  BehaviorsReferencesResponse,
  BehaviorsResolveReferencesResponse,
  BehaviorsRegistryResponse,
  AssetsDetectImportSourceResponse,
  AssetsGetAssetDataUrlResponse,
  AssetsGetPackResponse,
  AssetsListPackAssetsResponse,
  AssetsListPacksResponse,
  AssetsRemovePackResponse,
  CatalogExportResponse,
  CatalogDuplicateDefinitionResponse,
  CatalogImportResponse,
  CatalogRemoveDefinitionResponse,
  CatalogRemoveTypeResponse,
  CatalogResolveResponse,
  CatalogUpsertTypeResponse,
  CatalogUpsertDefinitionResponse,
  CatalogValidateResponse,
  JobsListResponse,
  JobsGetResponse,
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
  ProjectsCreateGameResponse,
  ProjectsGetResponse,
  ProjectsListResponse,
  ReadinessCheckResponse,
  ShipGameArtifact,
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
export type BehaviorsOpenResponse = Schema.Schema.Type<typeof BehaviorsOpenResponse>;
export type BehaviorsRegistryResponse = Schema.Schema.Type<typeof BehaviorsRegistryResponse>;
export type BehaviorsReferencesResponse = Schema.Schema.Type<typeof BehaviorsReferencesResponse>;
export type BehaviorsResolveReferencesResponse = Schema.Schema.Type<
  typeof BehaviorsResolveReferencesResponse
>;
export type ProjectGetResponse = Schema.Schema.Type<typeof ProjectsGetResponse>;
export type ProjectsCreateResponse = Schema.Schema.Type<typeof ProjectsCreateResponse>;
export type ProjectsCreateGameResponse = Schema.Schema.Type<typeof ProjectsCreateGameResponse>;

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
export type AssetPackAssetsResponse = Schema.Schema.Type<typeof AssetsListPackAssetsResponse>;
export type AssetPackRemoveResponse = Schema.Schema.Type<typeof AssetsRemovePackResponse>;
export type AssetImportDetectSourceResponse = Schema.Schema.Type<
  typeof AssetsDetectImportSourceResponse
>;
export type AssetDataUrlResponse = Schema.Schema.Type<typeof AssetsGetAssetDataUrlResponse>;
export type AssetLibraryGetPackLibraryResponse = Schema.Schema.Type<
  typeof AssetLibraryGetPackLibraryResponse
>;
export type AssetLibraryGetPackCacheStatusResponse = Schema.Schema.Type<
  typeof AssetLibraryGetPackCacheStatusResponse
>;
export type AssetLibraryGetPackUseSitesResponse = Schema.Schema.Type<
  typeof AssetLibraryGetPackUseSitesResponse
>;
export type AssetLibraryReloadPackCacheResponse = Schema.Schema.Type<
  typeof AssetLibraryReloadPackCacheResponse
>;
export type AssetLibraryResolvePreviewsResponse = Schema.Schema.Type<
  typeof AssetLibraryResolvePreviewsResponse
>;
export type AudioOpenResponse = Schema.Schema.Type<typeof AudioOpenResponse>;
export type AudioSaveResponse = Schema.Schema.Type<typeof AudioSaveResponse>;
export type AudioApplyResponse = Schema.Schema.Type<typeof AudioApplyResponse>;
export type AudioPreviewResponse = Schema.Schema.Type<typeof AudioPreviewResponse>;
export type GameShellOpenResponse = Schema.Schema.Type<typeof GameShellOpenResponse>;
export type GameShellSaveResponse = Schema.Schema.Type<typeof GameShellSaveResponse>;
export type GameShellApplyResponse = Schema.Schema.Type<typeof GameShellApplyResponse>;
export type GameShellPreviewResponse = Schema.Schema.Type<typeof GameShellPreviewResponse>;
export type WorkingPalettesListResponse = Schema.Schema.Type<typeof WorkingPalettesListResponse>;
export type WorkingPalettesGetActiveResponse = Schema.Schema.Type<
  typeof WorkingPalettesGetActiveResponse
>;
export type WorkingPalettesPaletteResponse = Schema.Schema.Type<
  typeof WorkingPalettesPaletteResponse
>;

export type CatalogResolveResponse = Schema.Schema.Type<typeof CatalogResolveResponse>;
export type CatalogValidateResponse = Schema.Schema.Type<typeof CatalogValidateResponse>;
export type CatalogImportResponse = Schema.Schema.Type<typeof CatalogImportResponse>;
export type CatalogExportResponse = Schema.Schema.Type<typeof CatalogExportResponse>;
export type CatalogUpsertTypeResponse = Schema.Schema.Type<typeof CatalogUpsertTypeResponse>;
export type CatalogRemoveTypeResponse = Schema.Schema.Type<typeof CatalogRemoveTypeResponse>;
export type CatalogUpsertDefinitionResponse = Schema.Schema.Type<
  typeof CatalogUpsertDefinitionResponse
>;
export type CatalogDuplicateDefinitionResponse = Schema.Schema.Type<
  typeof CatalogDuplicateDefinitionResponse
>;
export type CatalogRemoveDefinitionResponse = Schema.Schema.Type<
  typeof CatalogRemoveDefinitionResponse
>;

export type PluginsListResponse = Schema.Schema.Type<typeof PluginsListResponse>;
export type PluginsInstallResponse = Schema.Schema.Type<typeof PluginsInstallResponse>;
export type PluginsInstallBundledBattleRoyaleResponse = Schema.Schema.Type<
  typeof PluginsInstallBundledBattleRoyaleResponse
>;
export type PluginManifestResponse = Schema.Schema.Type<typeof PluginsGetManifestResponse>;
export type PluginContributionsResponse = Schema.Schema.Type<
  typeof PluginsListContributionsResponse
>;

export type JobsListResponse = Schema.Schema.Type<typeof JobsListResponse>;
export type JobsGetResponse = Schema.Schema.Type<typeof JobsGetResponse>;
export type ShipGameArtifact = Schema.Schema.Type<typeof ShipGameArtifact>;
export type LogsListRecentResponse = Schema.Schema.Type<typeof LogsListRecentResponse>;

export type PlaytestListResponse = Schema.Schema.Type<typeof PlaytestListResponse>;
export type PlaytestStartResponse = Schema.Schema.Type<typeof PlaytestStartResponse>;
export type ReadinessCheckResponse = Schema.Schema.Type<typeof ReadinessCheckResponse>;

export type HomePathsResponse = Schema.Schema.Type<typeof SystemGetHomePathsResponse>;
export type SystemVersionResponse = Schema.Schema.Type<typeof SystemGetVersionResponse>;

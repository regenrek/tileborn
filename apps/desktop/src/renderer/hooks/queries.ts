import {
  keepPreviousData,
  queryOptions,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { AssetLibraryGroupKind, MapId, PackId, PluginId, ProjectId } from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import { useCallback, useMemo } from 'react';

import { loadTilesetPack } from '@/lib/tileset-pack';

import type {
  AssetDataUrlResponse,
  AssetLibraryGetPackCacheStatusResponse,
  AssetLibraryGetPackLibraryResponse,
  AssetPackGetResponse,
  AssetPacksListResponse,
  HomePathsResponse,
  JobsListResponse,
  LogsListRecentResponse,
  MapGetResponse,
  MapsListResponse,
  PlaytestListResponse,
  PluginContributionsResponse,
  PluginManifestResponse,
  PluginsListResponse,
  ProjectGetResponse,
  ProjectsListResponse,
  SystemVersionResponse,
} from '@/lib/bridge-types';
import { invokeIpc } from '@/lib/ipc';
import { queryKeys } from '@/lib/query-client';

const UNKNOWN_INTEGRITY_HASH = 'integrity:unknown';
const UNKNOWN_CACHE_VERSION = 'cache:unknown';
const ASSET_LIBRARY_METADATA_STALE_MS = 30 * 60 * 1_000;
const ASSET_LIBRARY_METADATA_GC_MS = 2 * 60 * 60 * 1_000;
const ASSET_LIBRARY_THUMBNAIL_STALE_MS = 60 * 60 * 1_000;
const ASSET_LIBRARY_THUMBNAIL_GC_MS = 4 * 60 * 60 * 1_000;

export const ASSET_LIBRARY_PAGE_SIZE = 64;

const queryIdentity = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? fallback : normalized;
};

type BackendAssetLibraryCacheStatus = AssetLibraryGetPackCacheStatusResponse['status'];

export type AssetLibraryCacheStatusKind = BackendAssetLibraryCacheStatus['state'];

export interface AssetLibraryCacheStatus {
  readonly status: AssetLibraryCacheStatusKind;
  readonly supported: boolean;
  readonly packId?: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly cacheVersion?: string | undefined;
  readonly thumbnailCacheVersion?: string | undefined;
  readonly progress?: number | undefined;
  readonly message?: string | undefined;
  readonly groupCount?: number | undefined;
  readonly previewRefCount?: number | undefined;
  readonly updatedAt?: string | undefined;
}

type AssetLibraryThumbnailMethod = (input: {
  readonly packId: PackId;
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sizePx: number;
}) => Promise<AssetDataUrlResponse>;

type AssetLibraryPerformanceBridge = {
  readonly getPackCacheStatus?: typeof window.tileborne.assetLibrary.getPackCacheStatus | undefined;
  readonly getThumbnailDataUrl?: AssetLibraryThumbnailMethod | undefined;
};

export interface AssetLibraryPageQueryInput {
  readonly packId: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly groupKind: AssetLibraryGroupKind;
  readonly query?: string | undefined;
  readonly offset: number;
  readonly limit?: number | undefined;
  readonly cacheVersion?: string | undefined;
}

export interface AssetThumbnailQueryInput {
  readonly packId: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly assetPath: string | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly sizePx: number;
  readonly cacheVersion?: string | undefined;
}

const assetLibraryPerformanceBridge = (): AssetLibraryPerformanceBridge =>
  typeof window === 'undefined'
    ? {}
    : (window.tileborne.assetLibrary as unknown as AssetLibraryPerformanceBridge);

const cacheVersionForStatus = (status: BackendAssetLibraryCacheStatus): string | undefined => {
  if (status.integrityHash === undefined) {
    return undefined;
  }
  return [
    'library',
    status.cacheKind,
    `schema-${status.indexSchemaVersion}`,
    status.integrityHash,
    status.updatedAt ?? status.state,
  ].join(':');
};

const statusMessage = (status: BackendAssetLibraryCacheStatus): string => {
  if (status.errorMessage !== undefined) {
    return status.errorMessage;
  }
  if (status.state === 'cached') {
    const updated = status.updatedAt === undefined ? '' : ` Last updated ${status.updatedAt}.`;
    return `Library metadata cache is ready for ${status.groupCount} groups and ${status.previewRefCount} previews.${updated}`;
  }
  if (status.state === 'stale') {
    return 'A previous library cache exists for another pack integrity. Reload to rebuild the current index.';
  }
  if (status.state === 'building') {
    return 'Building the library metadata cache for this pack.';
  }
  if (status.state === 'error') {
    return 'The library metadata cache could not be rebuilt.';
  }
  return 'No library metadata cache has been built for this pack yet.';
};

const normalizeCacheStatus = (status: BackendAssetLibraryCacheStatus): AssetLibraryCacheStatus => {
  const cacheVersion = cacheVersionForStatus(status);
  return {
    status: status.state,
    supported: true,
    packId: status.packId,
    integrityHash: status.integrityHash,
    cacheVersion,
    thumbnailCacheVersion:
      status.thumbnailSheetsAvailable && status.thumbnailSheetCount > 0 ? cacheVersion : undefined,
    message: statusMessage(status),
    groupCount: status.groupCount,
    previewRefCount: status.previewRefCount,
    updatedAt: status.updatedAt,
  };
};

const assetLibraryCacheStatus = async (packId: string): Promise<AssetLibraryCacheStatus> => {
  const bridge = assetLibraryPerformanceBridge();
  const method = bridge.getPackCacheStatus;
  if (method === undefined) {
    return {
      status: 'cold',
      supported: false,
      message: 'Backend cache status IPC is not available yet.',
    };
  }
  const response = await invokeIpc(() => method.call(bridge, { packId: packId as PackId }));
  return normalizeCacheStatus(response.status);
};

const thumbnailVariantKey = (input: AssetThumbnailQueryInput): string => {
  const bridge = assetLibraryPerformanceBridge();
  if (typeof bridge.getThumbnailDataUrl !== 'function') {
    return 'atlas';
  }
  return `${input.x ?? 0}:${input.y ?? 0}:${input.width ?? 0}:${input.height ?? 0}`;
};

const fetchAssetThumbnail = (input: AssetThumbnailQueryInput): Promise<AssetDataUrlResponse> => {
  const bridge = assetLibraryPerformanceBridge();
  if (
    typeof bridge.getThumbnailDataUrl === 'function' &&
    input.assetPath !== undefined &&
    input.x !== undefined &&
    input.y !== undefined &&
    input.width !== undefined &&
    input.height !== undefined
  ) {
    return invokeIpc(() =>
      bridge.getThumbnailDataUrl!({
        packId: input.packId! as PackId,
        assetPath: input.assetPath!,
        x: input.x!,
        y: input.y!,
        width: input.width!,
        height: input.height!,
        sizePx: input.sizePx,
      }),
    );
  }
  return invokeIpc(() =>
    window.tileborne.assets.getAssetDataUrl({
      packId: input.packId! as PackId,
      assetPath: input.assetPath!,
    }),
  );
};

export const assetLibraryStatusQueryOptions = (input: {
  readonly packId: string | undefined;
  readonly integrityHash?: string | undefined;
}) =>
  queryOptions({
    queryKey: queryKeys.assetLibrary.status(
      input.packId ?? '',
      queryIdentity(input.integrityHash, UNKNOWN_INTEGRITY_HASH),
    ),
    queryFn: () => assetLibraryCacheStatus(input.packId!),
    enabled: input.packId !== undefined && input.packId.length > 0,
    staleTime: 15_000,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'building' || status === 'cold' || status === 'stale' ? 2_000 : false;
    },
  });

export const assetLibraryPageQueryOptions = (input: AssetLibraryPageQueryInput) => {
  const normalizedQuery = input.query?.trim() ?? '';
  const limit = input.limit ?? ASSET_LIBRARY_PAGE_SIZE;
  return queryOptions({
    queryKey: queryKeys.assetLibrary.packLibraryPage(
      input.packId ?? '',
      queryIdentity(input.integrityHash, UNKNOWN_INTEGRITY_HASH),
      input.groupKind,
      normalizedQuery,
      input.offset,
      limit,
      queryIdentity(input.cacheVersion, UNKNOWN_CACHE_VERSION),
    ),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.assetLibrary.getPackLibrary({
          packId: input.packId! as PackId,
          groupKind: input.groupKind,
          query: normalizedQuery,
          offset: input.offset,
          limit,
        }),
      ),
    enabled: input.packId !== undefined && input.packId.length > 0,
    placeholderData: keepPreviousData,
    staleTime: ASSET_LIBRARY_METADATA_STALE_MS,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
  });
};

export const assetThumbnailQueryOptions = (input: AssetThumbnailQueryInput) =>
  queryOptions({
    queryKey: queryKeys.assets.thumbnail(
      input.packId ?? '',
      queryIdentity(input.integrityHash, UNKNOWN_INTEGRITY_HASH),
      input.assetPath ?? '',
      input.sizePx,
      queryIdentity(input.cacheVersion, UNKNOWN_CACHE_VERSION),
      thumbnailVariantKey(input),
    ),
    queryFn: () => fetchAssetThumbnail(input),
    enabled:
      input.packId !== undefined &&
      input.packId.length > 0 &&
      input.assetPath !== undefined &&
      input.assetPath.length > 0,
    staleTime: ASSET_LIBRARY_THUMBNAIL_STALE_MS,
    gcTime: ASSET_LIBRARY_THUMBNAIL_GC_MS,
  });

export function useProjectsList() {
  return useQuery<ProjectsListResponse>({
    queryKey: queryKeys.projects.list(),
    queryFn: () => invokeIpc(() => window.tileborne.projects.list({})),
  });
}

export function useProject(projectId: string | undefined): UseQueryResult<ProjectGetResponse> {
  return useQuery<ProjectGetResponse>({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    queryFn: () =>
      invokeIpc(() => window.tileborne.projects.get({ projectId: projectId! as ProjectId })),
    enabled: projectId !== undefined && projectId.length > 0,
  });
}

export function useMaps(projectId: string | undefined) {
  return useQuery<MapsListResponse>({
    queryKey: queryKeys.maps.list(projectId ?? ''),
    queryFn: () =>
      invokeIpc(() => window.tileborne.maps.list({ projectId: projectId! as ProjectId })),
    enabled: projectId !== undefined && projectId.length > 0,
  });
}

export function useMap(
  projectId: string | undefined,
  mapId: string | undefined,
): UseQueryResult<MapGetResponse> {
  return useQuery<MapGetResponse>({
    queryKey: queryKeys.maps.detail(projectId ?? '', mapId ?? ''),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.maps.get({
          projectId: projectId! as ProjectId,
          mapId: mapId! as MapId,
        }),
      ),
    enabled:
      projectId !== undefined && projectId.length > 0 && mapId !== undefined && mapId.length > 0,
  });
}

export function useAssetPacks() {
  return useQuery<AssetPacksListResponse>({
    queryKey: queryKeys.assets.list(),
    queryFn: () => invokeIpc(() => window.tileborne.assets.listPacks({})),
  });
}

export function useAssetPack(packId: string | undefined) {
  return useQuery<AssetPackGetResponse>({
    queryKey: queryKeys.assets.detail(packId ?? ''),
    queryFn: () => invokeIpc(() => window.tileborne.assets.getPack({ packId: packId! as PackId })),
    enabled: packId !== undefined && packId.length > 0,
    staleTime: ASSET_LIBRARY_METADATA_STALE_MS,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
  });
}

export function useTilesetPack(
  packId: string | undefined,
  options: { readonly integrityHash?: string | undefined } = {},
): UseQueryResult<TilesetPack> {
  return useQuery<TilesetPack>({
    queryKey: queryKeys.assets.tilesetPack(
      packId ?? '',
      queryIdentity(options.integrityHash, UNKNOWN_INTEGRITY_HASH),
    ),
    queryFn: () => loadTilesetPack(packId! as PackId),
    enabled: packId !== undefined && packId.length > 0,
    staleTime: ASSET_LIBRARY_METADATA_STALE_MS,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
  });
}

export function useAssetDataUrl(
  packId: string | undefined,
  assetPath: string | undefined,
  options: {
    readonly integrityHash?: string | undefined;
    readonly cacheVersion?: string | undefined;
  } = {},
) {
  return useQuery<AssetDataUrlResponse>({
    queryKey: queryKeys.assets.dataUrl(
      packId ?? '',
      queryIdentity(options.integrityHash, UNKNOWN_INTEGRITY_HASH),
      assetPath ?? '',
      queryIdentity(options.cacheVersion, UNKNOWN_CACHE_VERSION),
    ),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.assets.getAssetDataUrl({
          packId: packId! as PackId,
          assetPath: assetPath!,
        }),
      ),
    enabled:
      packId !== undefined && packId.length > 0 && assetPath !== undefined && assetPath.length > 0,
    staleTime: ASSET_LIBRARY_THUMBNAIL_STALE_MS,
    gcTime: ASSET_LIBRARY_THUMBNAIL_GC_MS,
  });
}

export function useAssetThumbnailDataUrl(
  packId: string | undefined,
  preview:
    | Omit<AssetThumbnailQueryInput, 'packId' | 'integrityHash' | 'sizePx' | 'cacheVersion'>
    | undefined,
  options: {
    readonly integrityHash?: string | undefined;
    readonly sizePx: number;
    readonly cacheVersion?: string | undefined;
  },
) {
  return useQuery(
    assetThumbnailQueryOptions({
      packId,
      integrityHash: options.integrityHash,
      assetPath: preview?.assetPath,
      x: preview?.x,
      y: preview?.y,
      width: preview?.width,
      height: preview?.height,
      sizePx: options.sizePx,
      cacheVersion: options.cacheVersion,
    }),
  );
}

export function useAssetPackLibrary(
  packId: string | undefined,
  options: {
    readonly groupKind: AssetLibraryGroupKind;
    readonly query?: string | undefined;
    readonly offset?: number | undefined;
    readonly limit?: number | undefined;
    readonly integrityHash?: string | undefined;
    readonly cacheVersion?: string | undefined;
  },
): UseQueryResult<AssetLibraryGetPackLibraryResponse> {
  const normalizedQuery = options.query?.trim() ?? '';
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  return useQuery<AssetLibraryGetPackLibraryResponse>({
    queryKey: queryKeys.assetLibrary.packLibraryPage(
      packId ?? '',
      queryIdentity(options.integrityHash, UNKNOWN_INTEGRITY_HASH),
      options.groupKind,
      normalizedQuery,
      offset,
      limit,
      queryIdentity(options.cacheVersion, UNKNOWN_CACHE_VERSION),
    ),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.assetLibrary.getPackLibrary({
          packId: packId! as PackId,
          groupKind: options.groupKind,
          query: normalizedQuery,
          offset,
          limit,
        }),
      ),
    enabled: packId !== undefined && packId.length > 0,
    placeholderData: keepPreviousData,
    staleTime: ASSET_LIBRARY_METADATA_STALE_MS,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
  });
}

export function useAssetLibraryCacheStatus(
  packId: string | undefined,
  integrityHash?: string | undefined,
) {
  return useQuery(assetLibraryStatusQueryOptions({ packId, integrityHash }));
}

export function useAssetPackLibraryPages(
  packId: string | undefined,
  options: {
    readonly groupKind: AssetLibraryGroupKind;
    readonly query?: string | undefined;
    readonly pageCount: number;
    readonly pageSize?: number | undefined;
    readonly integrityHash?: string | undefined;
    readonly cacheVersion?: string | undefined;
  },
) {
  const pageSize = options.pageSize ?? ASSET_LIBRARY_PAGE_SIZE;
  const pageCount = Math.max(1, Math.trunc(options.pageCount));
  const offsets = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index * pageSize),
    [pageCount, pageSize],
  );
  const pageQueries = useQueries({
    queries: offsets.map((offset) =>
      assetLibraryPageQueryOptions({
        packId,
        groupKind: options.groupKind,
        query: options.query,
        offset,
        limit: pageSize,
        integrityHash: options.integrityHash,
        cacheVersion: options.cacheVersion,
      }),
    ),
  });
  const pages = pageQueries.flatMap((query) => (query.data === undefined ? [] : [query.data]));
  const firstPage = pages[0];
  const groups = pages.flatMap((page) => page.groups);
  const firstError = pageQueries.find((query) => query.isError)?.error;

  return {
    data:
      firstPage === undefined
        ? undefined
        : {
            packId: firstPage.packId,
            total: firstPage.total,
            offset: 0,
            limit: pageCount * pageSize,
            groups,
          },
    pages,
    pageQueries,
    isLoading: pages.length === 0 && pageQueries.some((query) => query.isLoading),
    isFetching: pageQueries.some((query) => query.isFetching),
    isError: pageQueries.some((query) => query.isError),
    error: firstError,
  };
}

export function usePrefetchAssetLibraryPage() {
  const queryClient = useQueryClient();
  return useCallback(
    (input: AssetLibraryPageQueryInput) => {
      void queryClient.prefetchQuery(assetLibraryPageQueryOptions(input));
    },
    [queryClient],
  );
}

export function usePrefetchAssetThumbnail() {
  const queryClient = useQueryClient();
  return useCallback(
    (input: AssetThumbnailQueryInput) => {
      void queryClient.prefetchQuery(assetThumbnailQueryOptions(input));
    },
    [queryClient],
  );
}

export function usePluginsList() {
  return useQuery<PluginsListResponse>({
    queryKey: queryKeys.plugins.list(),
    queryFn: () => invokeIpc(() => window.tileborne.plugins.list({})),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function usePluginContributions() {
  return useQuery<PluginContributionsResponse>({
    queryKey: queryKeys.plugins.contributions(),
    queryFn: () => invokeIpc(() => window.tileborne.plugins.listContributions({})),
  });
}

export function usePluginManifest(
  pluginId: string | undefined,
): UseQueryResult<PluginManifestResponse> {
  return useQuery<PluginManifestResponse>({
    queryKey: queryKeys.plugins.manifest(pluginId ?? ''),
    queryFn: () =>
      invokeIpc(() => window.tileborne.plugins.getManifest({ pluginId: pluginId! as PluginId })),
    enabled: pluginId !== undefined && pluginId.length > 0,
  });
}

export function useJobs() {
  return useQuery<JobsListResponse>({
    queryKey: queryKeys.jobs.list(),
    queryFn: () => invokeIpc(() => window.tileborne.jobs.list({})),
  });
}

export function useLogs() {
  return useQuery<LogsListRecentResponse>({
    queryKey: queryKeys.logs.list(),
    queryFn: () => invokeIpc(() => window.tileborne.logs.listRecent({ limit: 1_000 })),
  });
}

export function usePlaytestSessions(options?: { refetchInterval?: number | false }) {
  return useQuery<PlaytestListResponse>({
    queryKey: queryKeys.playtest.list(),
    queryFn: () => invokeIpc(() => window.tileborne.playtest.list({})),
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useHomePaths() {
  return useQuery<HomePathsResponse>({
    queryKey: queryKeys.system.homePaths(),
    queryFn: () => invokeIpc(() => window.tileborne.system.getHomePaths({})),
  });
}

export function useSystemVersion() {
  return useQuery<SystemVersionResponse>({
    queryKey: queryKeys.system.version(),
    queryFn: () => invokeIpc(() => window.tileborne.system.getVersion({})),
  });
}

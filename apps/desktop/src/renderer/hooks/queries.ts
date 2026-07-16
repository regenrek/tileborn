import {
  keepPreviousData,
  queryOptions,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AssetLibraryGroupKind,
  AssetLibraryReference,
  BehaviorReference,
  MapId,
  PackId,
  PluginId,
  ProjectId,
} from '@tileborne/core';
import type { TilesetPack } from '@tileborne/sdk-tileset/schemas';
import type { BehaviorReferenceKind } from '@tileborne/ipc-contracts';
import type { PlaytestSessionId } from '@tileborne/services-build';
import { useCallback, useMemo } from 'react';

import type { LibraryPreviewRef } from '@/lib/asset-library-bridge';
import { loadTilesetPack } from '@/lib/tileset-pack';
import { assetLibraryReferenceKey } from '@/lib/working-palettes-bridge';

import type {
  AssetDataUrlResponse,
  AssetLibraryGetPackCacheStatusResponse,
  AssetLibraryGetPackLibraryResponse,
  AssetLibraryGetPackUseSitesResponse,
  AssetLibraryResolvePreviewsResponse,
  AssetPackGetResponse,
  BehaviorsOpenResponse,
  BehaviorsReferencesResponse,
  BehaviorsResolveReferencesResponse,
  BehaviorsRegistryResponse,
  AssetPacksListResponse,
  CatalogResolveResponse,
  CatalogValidateResponse,
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
  ReadinessCheckResponse,
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
const WORKING_PALETTE_PREVIEW_BATCH_SIZE = 64;

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

type AssetLibraryPerformanceBridge = {
  readonly getPackCacheStatus?: typeof window.tileborne.assetLibrary.getPackCacheStatus | undefined;
};

export interface AssetLibraryPageQueryInput {
  readonly packId: string | undefined;
  readonly integrityHash?: string | undefined;
  readonly groupKind: AssetLibraryGroupKind;
  readonly query?: string | undefined;
  readonly offset: number;
  readonly limit?: number | undefined;
  readonly cacheVersion?: string | undefined;
  readonly keepPreviousData?: boolean | undefined;
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
  return queryOptions<AssetLibraryGetPackLibraryResponse>({
    queryKey: queryKeys.assetLibrary.packLibraryPage(
      input.packId ?? '',
      queryIdentity(input.integrityHash, UNKNOWN_INTEGRITY_HASH),
      input.groupKind,
      normalizedQuery,
      input.offset,
      limit,
      queryIdentity(input.cacheVersion, UNKNOWN_CACHE_VERSION),
    ),
    queryFn: ({ signal }) =>
      runAbortableQuery(signal, () =>
        invokeIpc(() =>
          window.tileborne.assetLibrary.getPackLibrary({
            packId: input.packId! as PackId,
            groupKind: input.groupKind,
            query: normalizedQuery,
            offset: input.offset,
            limit,
          }),
        ),
      ),
    enabled: input.packId !== undefined && input.packId.length > 0,
    ...(input.keepPreviousData === false ? {} : { placeholderData: keepPreviousData }),
    staleTime: ASSET_LIBRARY_METADATA_STALE_MS,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
  });
};

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
  return useQuery(tilesetPackQueryOptions(packId, options));
}

export const tilesetPackQueryOptions = (
  packId: string | undefined,
  options: { readonly integrityHash?: string | undefined } = {},
) =>
  queryOptions({
    queryKey: queryKeys.assets.tilesetPack(
      packId ?? '',
      queryIdentity(options.integrityHash, UNKNOWN_INTEGRITY_HASH),
    ),
    queryFn: () => loadTilesetPack(packId! as PackId),
    enabled: packId !== undefined && packId.length > 0,
    staleTime: ASSET_LIBRARY_METADATA_STALE_MS,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
  });

export function useTilesetPacks(packIds: readonly string[]) {
  return useQueries({
    queries: packIds.map((packId) => tilesetPackQueryOptions(packId)),
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

const groupRefsByPackId = (
  refs: readonly AssetLibraryReference[],
): ReadonlyMap<string, readonly AssetLibraryReference[]> => {
  const byPack = new Map<string, AssetLibraryReference[]>();
  for (const ref of refs) {
    const bucket = byPack.get(ref.packId);
    if (bucket === undefined) {
      byPack.set(ref.packId, [ref]);
    } else {
      bucket.push(ref);
    }
  }
  return byPack;
};

const refsIdentity = (refs: readonly AssetLibraryReference[]): string =>
  refs.map(assetLibraryReferenceKey).join('|');

export const runAbortableQuery = <T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const abortError = () =>
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Query was aborted', 'AbortError');
    const onAbort = () => reject(abortError());
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    void operation().then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });

export const workingPalettePreviewsQueryOptions = (
  packId: string,
  refs: readonly AssetLibraryReference[],
) =>
  queryOptions({
    queryKey: queryKeys.assetLibrary.previews(packId, refsIdentity(refs)),
    queryFn: ({ signal }): Promise<AssetLibraryResolvePreviewsResponse> =>
      runAbortableQuery(signal, () =>
        invokeIpc(() =>
          window.tileborne.assetLibrary.resolvePreviews({ packId: packId as PackId, refs }),
        ),
      ),
    enabled: packId.length > 0 && refs.length > 0,
    staleTime: ASSET_LIBRARY_METADATA_STALE_MS,
    gcTime: ASSET_LIBRARY_METADATA_GC_MS,
  });

export interface WorkingPalettePreviews {
  readonly previewByKey: ReadonlyMap<string, LibraryPreviewRef>;
  readonly isLoading: boolean;
}

/**
 * Resolves palette item previews via the main process (which parses the pack
 * and builds the preview index off the renderer UI thread, cached per pack).
 * The renderer receives only the small atlas rects, never the full manifest.
 */
export function useWorkingPalettePreviews(
  refs: readonly AssetLibraryReference[],
): WorkingPalettePreviews {
  const refsByPack = useMemo(() => groupRefsByPackId(refs), [refs]);
  const batches = useMemo(() => {
    const result: { readonly packId: string; readonly refs: readonly AssetLibraryReference[] }[] =
      [];
    for (const [packId, packRefs] of refsByPack) {
      for (let offset = 0; offset < packRefs.length; offset += WORKING_PALETTE_PREVIEW_BATCH_SIZE) {
        result.push({
          packId,
          refs: packRefs.slice(offset, offset + WORKING_PALETTE_PREVIEW_BATCH_SIZE),
        });
      }
    }
    return result;
  }, [refsByPack]);
  return useQueries({
    queries: batches.map((batch) => workingPalettePreviewsQueryOptions(batch.packId, batch.refs)),
    combine: (results) => {
      const previewByKey = new Map<string, LibraryPreviewRef>();
      for (const result of results) {
        for (const entry of result.data?.previews ?? []) {
          if (entry.preview !== undefined) {
            previewByKey.set(entry.key, entry.preview);
          }
        }
      }
      return {
        previewByKey,
        isLoading: results.some((result) => result.isLoading),
      };
    },
  });
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
    readonly keepPreviousData?: boolean | undefined;
  },
): UseQueryResult<AssetLibraryGetPackLibraryResponse> {
  const normalizedQuery = options.query?.trim() ?? '';
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  return useQuery(
    assetLibraryPageQueryOptions({
      packId,
      groupKind: options.groupKind,
      query: normalizedQuery,
      offset,
      limit,
      integrityHash: options.integrityHash,
      cacheVersion: options.cacheVersion,
      keepPreviousData: options.keepPreviousData,
    }),
  );
}

export function useAssetPackUseSites(
  projectId: string | undefined,
  packId: string | undefined,
  limit = 100,
): UseQueryResult<AssetLibraryGetPackUseSitesResponse> {
  return useQuery<AssetLibraryGetPackUseSitesResponse>({
    queryKey: queryKeys.assetLibrary.useSites(projectId ?? '', packId ?? '', limit),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.assetLibrary.getPackUseSites({
          projectId: projectId! as ProjectId,
          packId: packId! as PackId,
          limit,
        }),
      ),
    enabled:
      projectId !== undefined && projectId.length > 0 && packId !== undefined && packId.length > 0,
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

export function usePluginsList() {
  return useQuery<PluginsListResponse>({
    queryKey: queryKeys.plugins.list(),
    queryFn: () => invokeIpc(() => window.tileborne.plugins.list({})),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useBehaviors(projectId: string | undefined): UseQueryResult<BehaviorsOpenResponse> {
  return useQuery<BehaviorsOpenResponse>({
    queryKey: queryKeys.behaviors.documents(projectId ?? ''),
    queryFn: () =>
      invokeIpc(() => window.tileborne.behaviors.open({ projectId: projectId! as ProjectId })),
    enabled: projectId !== undefined && projectId.length > 0,
    staleTime: 0,
  });
}

export function useBehaviorRegistry(
  projectId: string | undefined,
): UseQueryResult<BehaviorsRegistryResponse> {
  return useQuery<BehaviorsRegistryResponse>({
    queryKey: queryKeys.behaviors.registry(projectId ?? ''),
    queryFn: () =>
      invokeIpc(() => window.tileborne.behaviors.registry({ projectId: projectId! as ProjectId })),
    enabled: projectId !== undefined && projectId.length > 0,
  });
}

export const BEHAVIOR_REFERENCE_PAGE_SIZE = 32;

export const behaviorReferencePageQueryOptions = (input: {
  readonly projectId: string | undefined;
  readonly kind: BehaviorReferenceKind;
  readonly query?: string | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
  readonly enabled?: boolean | undefined;
}) => {
  const query = input.query?.trim() ?? '';
  const offset = input.offset ?? 0;
  const limit = input.limit ?? BEHAVIOR_REFERENCE_PAGE_SIZE;
  return queryOptions<BehaviorsReferencesResponse>({
    queryKey: queryKeys.behaviorReferences.page(
      input.projectId ?? '',
      input.kind,
      query,
      offset,
      limit,
    ),
    queryFn: ({ signal }) =>
      runAbortableQuery(signal, () =>
        invokeIpc(() =>
          window.tileborne.behaviors.references({
            projectId: input.projectId! as ProjectId,
            kind: input.kind,
            query,
            offset,
            limit,
          }),
        ),
      ),
    enabled: input.enabled !== false && input.projectId !== undefined && input.projectId.length > 0,
    placeholderData: keepPreviousData,
  });
};

export function useBehaviorReferences(input: {
  readonly projectId: string | undefined;
  readonly kind: BehaviorReferenceKind;
  readonly query?: string | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
  readonly enabled?: boolean | undefined;
}): UseQueryResult<BehaviorsReferencesResponse> {
  return useQuery(behaviorReferencePageQueryOptions(input));
}

const behaviorReferenceIdentity = (reference: BehaviorReference): string => {
  switch (reference._tag) {
    case 'entity':
      return `${reference._tag}:${reference.objectId}`;
    case 'asset':
      return `${reference._tag}:${reference.assetId}`;
    case 'catalog':
      return `${reference._tag}:${reference.objectTypeId}`;
    case 'behavior':
      return `${reference._tag}:${reference.behaviorId}`;
  }
};

export const behaviorReferenceResolveQueryOptions = (
  projectId: string | undefined,
  references: readonly BehaviorReference[],
) => {
  if (references.length > 64)
    throw new Error('Behavior reference resolve chunks are limited to 64 items');
  const referencesKey = references.map(behaviorReferenceIdentity).sort().join('|');
  return queryOptions<BehaviorsResolveReferencesResponse>({
    queryKey: queryKeys.behaviorReferences.resolve(projectId ?? '', referencesKey),
    queryFn: ({ signal }) =>
      runAbortableQuery(signal, () =>
        invokeIpc(() =>
          window.tileborne.behaviors.resolveReferences({
            projectId: projectId! as ProjectId,
            references,
          }),
        ),
      ),
    enabled: projectId !== undefined && projectId.length > 0 && references.length > 0,
  });
};

export const chunkBehaviorReferences = (
  references: readonly BehaviorReference[],
): readonly (readonly BehaviorReference[])[] => {
  const unique = new Map(
    references.map((reference) => [behaviorReferenceIdentity(reference), reference]),
  );
  const stable = [...unique]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, reference]) => reference);
  return Array.from({ length: Math.ceil(stable.length / 64) }, (_, index) =>
    stable.slice(index * 64, (index + 1) * 64),
  );
};

export const behaviorReferenceResolveQueries = (
  projectId: string | undefined,
  references: readonly BehaviorReference[],
) =>
  chunkBehaviorReferences(references).map((chunk) =>
    behaviorReferenceResolveQueryOptions(projectId, chunk),
  );

export function useResolveBehaviorReferences(
  projectId: string | undefined,
  references: readonly BehaviorReference[],
) {
  return useQueries({
    queries: behaviorReferenceResolveQueries(projectId, references),
    combine: (results) => {
      const settled = results.every(({ data }) => data !== undefined);
      return {
        data: settled
          ? {
              options: results.flatMap(({ data }) => data?.options ?? []),
              missing: results.flatMap(({ data }) => data?.missing ?? []),
            }
          : undefined,
        isFetching: results.some(({ isFetching }) => isFetching),
        isError: results.some(({ isError }) => isError),
        error: results.find(({ error }) => error !== null)?.error ?? null,
      };
    },
  });
}

/**
 * Resolves the merged (plugin + project) game-object catalog for a project via
 * the slice-3 `tileborne:catalog:resolve` IPC. The renderer browses/places
 * object types purely from this projected DTO — it never imports
 * `services-plugin` or runs the catalog merge itself (ADR-0025 D2/D3).
 */
export function useResolvedCatalog(
  projectId: string | undefined,
): UseQueryResult<CatalogResolveResponse> {
  return useQuery<CatalogResolveResponse>({
    queryKey: queryKeys.catalog.resolve(projectId ?? ''),
    queryFn: () =>
      invokeIpc(() => window.tileborne.catalog.resolve({ projectId: projectId! as ProjectId })),
    enabled: projectId !== undefined && projectId.length > 0,
  });
}

/**
 * Runs the slice-3 `tileborne:catalog:validate` IPC for a project and returns
 * the structured {@link CatalogValidationReport} (the project fragment merged
 * with plugin catalogs). Mirrors {@link useResolvedCatalog}: the renderer reads
 * only the projected report DTO — it never imports `services-plugin`, runs the
 * merge, or calls `validateCatalog` itself (ADR-0025 D2/D3). The navigable
 * validation drawer (slice 8) consumes this; refreshes follow the same
 * invalidation as resolve (import success + plugin changes).
 */
export function useValidateCatalog(
  projectId: string | undefined,
): UseQueryResult<CatalogValidateResponse> {
  return useQuery<CatalogValidateResponse>({
    queryKey: queryKeys.catalog.validate(projectId ?? ''),
    queryFn: () =>
      invokeIpc(() => window.tileborne.catalog.validate({ projectId: projectId! as ProjectId })),
    enabled: projectId !== undefined && projectId.length > 0,
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

/** Canonical project/map readiness report used by Problems and execution UI. */
export function useReadiness(
  projectId: string | undefined,
  mapId: string | undefined,
  purpose: 'authoring' | 'playtest' | 'build' = 'authoring',
): UseQueryResult<ReadinessCheckResponse> {
  return useQuery<ReadinessCheckResponse>({
    queryKey: queryKeys.readiness.check(projectId ?? '', mapId ?? '', purpose),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.readiness.check({
          projectId: projectId! as ProjectId,
          ...(mapId === undefined ? {} : { mapId: mapId as MapId }),
          purpose,
        }),
      ),
    enabled: projectId !== undefined && projectId.length > 0,
    staleTime: 0,
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

export function usePlaytestSessions(options?: {
  refetchInterval?: number | false;
}): UseQueryResult<PlaytestListResponse> {
  return useQuery<PlaytestListResponse>({
    queryKey: queryKeys.playtest.list(),
    queryFn: () => invokeIpc(() => window.tileborne.playtest.list({})),
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function usePlaytestBehaviorDebug(
  sessionId: string | null,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.playtest.behaviorDebug(sessionId ?? ''),
    queryFn: () =>
      invokeIpc(() =>
        window.tileborne.playtest.behaviorDebugInspect({
          sessionId: sessionId! as PlaytestSessionId,
        }),
      ),
    enabled: sessionId !== null,
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

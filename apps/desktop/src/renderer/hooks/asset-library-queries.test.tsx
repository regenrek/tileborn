// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, isCancelledError } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { AssetLibraryGroup, AssetLibraryReference, makePackId, makeTileId } from '@tileborne/core';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assetThumbnailUrl } from '@/lib/asset-url';
import {
  ASSET_LIBRARY_PAGE_SIZE,
  assetLibraryPageQueryOptions,
  useAssetLibraryCacheStatus,
  useAssetPackLibraryPages,
  useWorkingPalettePreviews,
  workingPalettePreviewsQueryOptions,
} from './queries';

const packId = makePackId('550e8400-e29b-41d4-a716-446655440000');
const tileId = makeTileId('550e8400-e29b-41d4-a716-446655440003');
const tileRef = new AssetLibraryReference({
  packId,
  kind: 'tile',
  refId: tileId,
  tileId,
});

const groupForOffset = (offset: number) =>
  new AssetLibraryGroup({
    id: `tileset:${offset}`,
    packId,
    kind: 'tileset',
    label: `Tileset ${offset}`,
    count: 1,
    metadata: {},
    searchText: `tileset ${offset}`,
    previewRefs: [tileRef],
  });

describe('asset library query pagination', () => {
  let client: QueryClient;
  let getPackLibrary: ReturnType<typeof vi.fn>;
  let getPackCacheStatus: ReturnType<typeof vi.fn>;
  let getAssetDataUrl: ReturnType<typeof vi.fn>;
  let resolvePreviews: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    getPackLibrary = vi.fn(async (input: { readonly offset?: number; readonly limit?: number }) => {
      const offset = input.offset ?? 0;
      const limit = input.limit ?? ASSET_LIBRARY_PAGE_SIZE;
      return {
        packId,
        total: ASSET_LIBRARY_PAGE_SIZE * 3,
        offset,
        limit,
        groups: [groupForOffset(offset)],
      };
    });
    getPackCacheStatus = vi.fn(async () => ({
      status: {
        packId,
        integrityHash: 'sha256:test',
        indexSchemaVersion: 1,
        state: 'cached',
        cacheKind: 'index-metadata',
        groupCount: 42,
        previewRefCount: 12,
        thumbnailSheetCount: 0,
        thumbnailSheetsAvailable: false,
        updatedAt: '2026-05-25T16:40:00.000Z',
      },
    }));
    getAssetDataUrl = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,atlas' }));
    resolvePreviews = vi.fn(async () => ({ previews: [] }));
    Object.defineProperty(window, 'tileborne', {
      configurable: true,
      value: {
        assetLibrary: { getPackLibrary, getPackCacheStatus, resolvePreviews },
        assets: { getAssetDataUrl },
      },
    });
  });

  afterEach(() => {
    client.clear();
  });

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('loads additional offsets without refetching previous pages', async () => {
    const { result, rerender } = renderHook(
      ({ pageCount }: { readonly pageCount: number }) =>
        useAssetPackLibraryPages(packId, {
          groupKind: 'tileset',
          pageCount,
          pageSize: ASSET_LIBRARY_PAGE_SIZE,
          integrityHash: 'sha256:test',
          cacheVersion: 'library:v1',
        }),
      { initialProps: { pageCount: 1 }, wrapper },
    );

    await waitFor(() => expect(result.current.data?.groups).toHaveLength(1));
    expect(getPackLibrary).toHaveBeenCalledTimes(1);
    expect(getPackLibrary).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, limit: ASSET_LIBRARY_PAGE_SIZE }),
    );

    rerender({ pageCount: 2 });

    await waitFor(() => expect(result.current.data?.groups).toHaveLength(2));
    expect(getPackLibrary).toHaveBeenCalledTimes(2);
    expect(getPackLibrary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: ASSET_LIBRARY_PAGE_SIZE,
        limit: ASSET_LIBRARY_PAGE_SIZE,
      }),
    );
  });

  it('normalizes typed cache status responses into cache-versioned query data', async () => {
    const { result } = renderHook(() => useAssetLibraryCacheStatus(packId, 'sha256:test'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data?.status).toBe('cached'));
    expect(result.current.data?.cacheVersion).toContain('library:index-metadata:schema-1');
    expect(result.current.data?.cacheVersion).toContain('2026-05-25T16:40:00.000Z');
    expect(result.current.data?.thumbnailCacheVersion).toBeUndefined();
    expect(result.current.data?.message).toContain('42 groups');
  });

  it('bounds working-palette preview IPC requests to 64 references', async () => {
    const refs = Array.from({ length: 130 }, (_, index) => {
      const id = makeTileId(`550e8400-e29b-41d4-a716-${index.toString(16).padStart(12, '0')}`);
      return new AssetLibraryReference({ packId, kind: 'tile', refId: id, tileId: id });
    });

    renderHook(() => useWorkingPalettePreviews(refs), { wrapper });

    await waitFor(() => expect(resolvePreviews).toHaveBeenCalledTimes(3));
    const batchSizes = resolvePreviews.mock.calls.map((call) => {
      const input = call[0] as { readonly refs: readonly AssetLibraryReference[] };
      return input.refs.length;
    });
    expect(batchSizes).toEqual([64, 64, 2]);
  });

  it('cancels an obsolete asset search before its delayed IPC result can populate cache', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    getPackLibrary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const options = assetLibraryPageQueryOptions({
      packId,
      groupKind: 'sprite',
      query: 'old search',
      offset: 0,
      limit: 48,
      keepPreviousData: false,
    });
    const observed = client.fetchQuery(options).catch((error: unknown) => error);

    await waitFor(() => expect(getPackLibrary).toHaveBeenCalledTimes(1));
    await client.cancelQueries({ queryKey: options.queryKey });
    resolveRequest?.({
      packId,
      total: 0,
      offset: 0,
      limit: 48,
      groups: [],
    });

    expect(isCancelledError(await observed)).toBe(true);
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
  });

  it('suppresses an obsolete preview batch after cancellation while retaining the current batch', async () => {
    const nextTileId = makeTileId('550e8400-e29b-41d4-a716-446655440099');
    const nextRef = new AssetLibraryReference({
      packId,
      kind: 'tile',
      refId: nextTileId,
      tileId: nextTileId,
    });
    let resolveObsolete: ((value: unknown) => void) | undefined;
    resolvePreviews
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveObsolete = resolve;
          }),
      )
      .mockResolvedValueOnce({ previews: [{ key: 'current', ref: nextRef }] });
    const obsolete = workingPalettePreviewsQueryOptions(String(packId), [tileRef]);
    const current = workingPalettePreviewsQueryOptions(String(packId), [nextRef]);
    const observedObsolete = client.fetchQuery(obsolete).catch((error: unknown) => error);

    await waitFor(() => expect(resolvePreviews).toHaveBeenCalledTimes(1));
    await client.cancelQueries({ queryKey: obsolete.queryKey });
    await client.fetchQuery(current);
    resolveObsolete?.({ previews: [{ key: 'obsolete', ref: tileRef }] });

    expect(isCancelledError(await observedObsolete)).toBe(true);
    expect(client.getQueryData(obsolete.queryKey)).toBeUndefined();
    expect(client.getQueryData(current.queryKey)).toEqual({
      previews: [{ key: 'current', ref: nextRef }],
    });
  });

  it('addresses thumbnails by crop geometry on the tileborne-asset thumb host', () => {
    const url = new URL(
      assetThumbnailUrl(
        packId,
        { assetPath: 'Images/terrain.png', x: 32, y: 64, width: 32, height: 32 },
        'sha256:test',
      ),
    );
    expect(url.protocol).toBe('tileborne-asset:');
    expect(url.host).toBe('thumb');
    expect(url.searchParams.get('id')).toBe(packId);
    expect(url.searchParams.get('path')).toBe('Images/terrain.png');
    expect(url.searchParams.get('x')).toBe('32');
    expect(url.searchParams.get('y')).toBe('64');
    expect(url.searchParams.get('w')).toBe('32');
    expect(url.searchParams.get('h')).toBe('32');
    expect(url.searchParams.get('v')).toBe('sha256:test');
    // No IPC is involved in resolving a thumbnail URL.
    expect(getAssetDataUrl).not.toHaveBeenCalled();
  });
});

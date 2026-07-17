// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import {
  AssetLibraryReference,
  makePackId,
  makeProjectId,
  makeTileId,
  makeWorkingPaletteId,
  makeWorkingPaletteItemId,
  type WorkingPalette,
} from '@tileborne/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCreateVisualBehavior,
  useConvertBehaviorToTypeScript,
  useImportSpriteSheet,
  useRemoveAssetPack,
  useRemoveBehavior,
  useSaveVisualBehavior,
  useSaveTypeScriptBehavior,
  useSetMapTilesetPack,
  useTiledImportApply,
  useUpdateMap,
  useUpdateProject,
} from '@/hooks/mutations';
import { TileborneQueryError } from '@/lib/ipc';
import { queryKeys } from '@/lib/query-client';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import { useWorkingPalettesStore } from '@/stores/working-palettes-store';

const setMapTilesetPackBridgeMock = vi.fn();
const removePackBridgeMock = vi.fn();
const updateProjectBridgeMock = vi.fn();
const updateMapBridgeMock = vi.fn();
const createVisualBehaviorBridgeMock = vi.fn();
const convertBehaviorBridgeMock = vi.fn();
const saveVisualBehaviorBridgeMock = vi.fn();
const saveTypeScriptBehaviorBridgeMock = vi.fn();
const removeBehaviorBridgeMock = vi.fn();
const importSpriteSheetBridgeMock = vi.fn();
const tiledImportApplyBridgeMock = vi.fn();

const tileborneStub = {
  projects: { update: updateProjectBridgeMock },
  maps: {
    setMapTilesetPack: setMapTilesetPackBridgeMock,
    update: updateMapBridgeMock,
  },
  behaviors: {
    createVisual: createVisualBehaviorBridgeMock,
    convertToTypeScript: convertBehaviorBridgeMock,
    saveVisual: saveVisualBehaviorBridgeMock,
    saveTypeScript: saveTypeScriptBehaviorBridgeMock,
    remove: removeBehaviorBridgeMock,
  },
  assets: {
    removePack: removePackBridgeMock,
    importSpriteSheet: importSpriteSheetBridgeMock,
  },
  tiledImport: { apply: tiledImportApplyBridgeMock },
};

beforeEach(() => {
  setMapTilesetPackBridgeMock.mockReset();
  removePackBridgeMock.mockReset();
  updateProjectBridgeMock.mockReset();
  updateMapBridgeMock.mockReset();
  createVisualBehaviorBridgeMock.mockReset();
  convertBehaviorBridgeMock.mockReset();
  saveVisualBehaviorBridgeMock.mockReset();
  saveTypeScriptBehaviorBridgeMock.mockReset();
  removeBehaviorBridgeMock.mockReset();
  importSpriteSheetBridgeMock.mockReset();
  tiledImportApplyBridgeMock.mockReset();
  (globalThis as { window: typeof window }).window = Object.assign(globalThis.window ?? {}, {
    tileborne: tileborneStub,
  }) as Window & typeof globalThis & { tileborne: typeof tileborneStub };
  useWorkingPalettesStore.getState().__resetForTests();
  useEditorUiStore.setState({
    activePalettePackId: null,
    brushIntent: { kind: 'eraser' },
    activeTool: 'select',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const wrapperWithClient =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

describe('useSetMapTilesetPack', () => {
  it('returns the updated map summary on success and is not pending', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    setMapTilesetPackBridgeMock.mockResolvedValue({
      map: {
        id: 'map-1',
        path: 'maps/map-1.json',
        width: 32,
        height: 32,
        layerCount: 3,
        objectCount: 0,
      },
    });
    const { result } = renderHook(() => useSetMapTilesetPack(), {
      wrapper: wrapperWithClient(client),
    });
    const response = await result.current.mutateAsync({
      projectId: 'project-1' as never,
      mapId: 'map-1' as never,
      packId: 'pack-paintable-1' as never,
    });
    expect(setMapTilesetPackBridgeMock).toHaveBeenCalledTimes(1);
    expect(response.map.id).toBe('map-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.readiness.all });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.assetLibrary.useSitesProject('project-1'),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('throws a TileborneQueryError when the IPC call rejects', async () => {
    setMapTilesetPackBridgeMock.mockRejectedValue({
      _tag: 'MapTilesetPackNotPaintableError',
      message: 'asset pack is not paintable: pack-asset-only',
    });
    const { result } = renderHook(() => useSetMapTilesetPack(), { wrapper });
    await expect(
      result.current.mutateAsync({
        projectId: 'project-1' as never,
        mapId: 'map-1' as never,
        packId: 'pack-asset-only' as never,
      }),
    ).rejects.toBeInstanceOf(TileborneQueryError);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('asset use-site invalidation', () => {
  it('refreshes the project-scoped projection after a player-model/project save', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    updateProjectBridgeMock.mockResolvedValue({ project: { id: 'project-models' } });
    const { result } = renderHook(() => useUpdateProject(), {
      wrapper: wrapperWithClient(client),
    });

    await result.current.mutateAsync({ project: { id: 'project-models' } } as never);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.assetLibrary.useSitesProject('project-models'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.behaviorReferences.project('project-models'),
    });
  });

  it('refreshes the project-scoped projection after a map/object save', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    updateMapBridgeMock.mockResolvedValue({ map: { id: 'map-1' } });
    const { result } = renderHook(() => useUpdateMap(), {
      wrapper: wrapperWithClient(client),
    });

    await result.current.mutateAsync({ projectId: 'project-maps', map: { id: 'map-1' } } as never);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.maps.detail('project-maps', 'map-1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.assetLibrary.useSitesProject('project-maps'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.behaviorReferences.project('project-maps'),
    });
  });
});

describe('behavior reference invalidation', () => {
  it.each([
    ['create', useCreateVisualBehavior, createVisualBehaviorBridgeMock],
    ['convert', useConvertBehaviorToTypeScript, convertBehaviorBridgeMock],
    ['save', useSaveVisualBehavior, saveVisualBehaviorBridgeMock],
    ['save TypeScript', useSaveTypeScriptBehavior, saveTypeScriptBehaviorBridgeMock],
    ['remove', useRemoveBehavior, removeBehaviorBridgeMock],
  ] as const)(
    'refreshes the project registry after behavior %s',
    async (_operation, useHook, bridgeMock) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
      bridgeMock.mockResolvedValue({});
      const { result } = renderHook(() => useHook(), {
        wrapper: wrapperWithClient(client),
      });

      await result.current.mutateAsync({ projectId: 'project-behaviors' } as never);

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.behaviorReferences.kind('project-behaviors', 'behavior'),
      });
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: queryKeys.behaviors.registry('project-behaviors'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.behaviorReferences.resolveAll('project-behaviors'),
      });
    },
  );

  it('refreshes all registries after importing a sprite sheet', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    importSpriteSheetBridgeMock.mockResolvedValue({});
    const { result } = renderHook(() => useImportSpriteSheet(), {
      wrapper: wrapperWithClient(client),
    });

    await result.current.mutateAsync({} as never);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.behaviorReferences.all });
  });

  it('refreshes the project registry after applying a Tiled import', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    tiledImportApplyBridgeMock.mockResolvedValue({});
    const { result } = renderHook(() => useTiledImportApply(), {
      wrapper: wrapperWithClient(client),
    });

    await result.current.mutateAsync({ projectId: 'project-tiled' } as never);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.behaviorReferences.project('project-tiled'),
    });
  });
});

describe('useRemoveAssetPack', () => {
  it('removes stale pack cache, prunes working palettes, and resets selected brush state', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const removedPackId = makePackId('550e8400-e29b-41d4-a716-446655440101');
    const otherPackId = makePackId('550e8400-e29b-41d4-a716-446655440102');
    const projectId = makeProjectId('550e8400-e29b-41d4-a716-446655440103');
    const paletteId = makeWorkingPaletteId('550e8400-e29b-41d4-a716-446655440104');
    const removedTileId = makeTileId('550e8400-e29b-41d4-a716-446655440105');
    const otherTileId = makeTileId('550e8400-e29b-41d4-a716-446655440106');
    const removedRef = new AssetLibraryReference({
      packId: removedPackId,
      kind: 'tile',
      refId: removedTileId,
      tileId: removedTileId,
    });
    const otherRef = new AssetLibraryReference({
      packId: otherPackId,
      kind: 'tile',
      refId: otherTileId,
      tileId: otherTileId,
    });
    const palette: WorkingPalette = {
      id: paletteId,
      projectId,
      name: 'Mixed palette',
      items: [
        {
          id: makeWorkingPaletteItemId('550e8400-e29b-41d4-a716-446655440107'),
          ref: removedRef,
          label: 'Removed tile',
        },
        {
          id: makeWorkingPaletteItemId('550e8400-e29b-41d4-a716-446655440108'),
          ref: otherRef,
          label: 'Other tile',
        },
      ],
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    };

    client.setQueryData(queryKeys.assets.list(), {
      packs: [
        {
          id: removedPackId,
          name: 'Removed Pack',
          version: '1.0.0',
          licenseSpdxId: 'CC0-1.0',
          integrityHash: 'sha256:removed',
          assetCount: 1,
          capability: { packId: removedPackId, paintable: true },
        },
        {
          id: otherPackId,
          name: 'Other Pack',
          version: '1.0.0',
          licenseSpdxId: 'CC0-1.0',
          integrityHash: 'sha256:other',
          assetCount: 1,
          capability: { packId: otherPackId, paintable: true },
        },
      ],
    });
    client.setQueryData(queryKeys.assets.detail(removedPackId), {
      pack: {
        id: removedPackId,
        name: 'Removed Pack',
        version: '1.0.0',
        licenseSpdxId: 'CC0-1.0',
        integrityHash: 'sha256:removed',
        assetCount: 1,
        capability: { packId: removedPackId, paintable: true },
      },
    });
    client.setQueryData(queryKeys.assetLibrary.status(removedPackId, 'sha256:removed'), {
      status: 'cached',
      supported: true,
      packId: removedPackId,
    });
    useWorkingPalettesStore.setState({
      palettes: [palette],
      activePaletteId: palette.id,
      loadedProjectId: undefined,
      isLoading: false,
      error: undefined,
    });
    useEditorUiStore.setState({
      activePalettePackId: removedPackId,
      brushIntent: { kind: 'tile', tileId: removedTileId },
      activeTool: 'tileBrush',
    });
    removePackBridgeMock.mockResolvedValue({
      removedPackId,
      invalidatedAssetLibraryCacheEntries: 1,
      prunedWorkingPaletteItemCount: 1,
      affectedProjectIds: [projectId],
      affectedPaletteIds: [paletteId],
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRemoveAssetPack(), {
      wrapper: wrapperWithClient(client),
    });

    await result.current.mutateAsync(removedPackId);

    expect(removePackBridgeMock).toHaveBeenCalledWith({ packId: removedPackId });
    expect(
      client.getQueryData<{ packs: readonly { id: string }[] }>(queryKeys.assets.list())?.packs,
    ).toEqual([expect.objectContaining({ id: otherPackId })]);
    expect(client.getQueryData(queryKeys.assets.detail(removedPackId))).toBeUndefined();
    expect(
      client
        .getQueryCache()
        .findAll()
        .some(
          (query) => query.queryKey[0] === 'assetLibrary' && query.queryKey[1] === removedPackId,
        ),
    ).toBe(false);
    expect(
      useWorkingPalettesStore.getState().palettes[0]?.items.map((item) => item.ref.packId),
    ).toEqual([otherPackId]);
    expect(useEditorUiStore.getState().activePalettePackId).toBeNull();
    expect(useEditorUiStore.getState().brushIntent).toEqual({ kind: 'eraser' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.assets.list() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.assetLibrary.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.workingPalettes.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.readiness.all });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.assetLibrary.useSitesProject(String(projectId)),
    });
  });
});

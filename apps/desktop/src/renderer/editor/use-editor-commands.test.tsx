// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TileborneMap } from '@tileborne/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/lib/query-client';

import { createStrokeTileCommand, createTileEditCommand } from './editor-commands.js';
import { getTileIndex } from './map-utils.js';
import { createTestMap, TEST_TILE_LAYER_ID } from './test-fixtures.js';
import { useEditorCommands } from './use-editor-commands.js';

const mutateAsyncMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/mutations', () => ({
  useUpdateMap: () => ({
    mutateAsync: mutateAsyncMock,
  }),
}));

const makeWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useEditorCommands map ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return setTimeout(() => callback(performance.now()), 0) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      clearTimeout(handle);
    });
    mutateAsyncMock.mockReset();
    mutateAsyncMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not let a stale map prop replace local edits while a save is pending', () => {
    const queryClient = new QueryClient();
    const patchedMaps: TileborneMap[] = [];
    const initialMap = createTestMap();
    const { result, rerender } = renderHook(
      ({ map }) =>
        useEditorCommands({
          projectId: 'project-1',
          mapId: 'map-1',
          map,
          onMapPatched: (patchedMap) => {
            patchedMaps.push(patchedMap);
          },
        }),
      {
        initialProps: { map: initialMap },
        wrapper: makeWrapper(queryClient),
      },
    );

    act(() => {
      result.current.applyCommand(createTileEditCommand(initialMap, TEST_TILE_LAYER_ID, 2, 3, 4));
    });
    const firstEdit = patchedMaps.at(-1)!;

    rerender({ map: initialMap });

    act(() => {
      result.current.applyCommand(createTileEditCommand(firstEdit, TEST_TILE_LAYER_ID, 3, 3, 7));
    });
    const secondEdit = patchedMaps.at(-1)!;

    expect(getTileIndex(secondEdit, TEST_TILE_LAYER_ID, 2, 3)).toBe(4);
    expect(getTileIndex(secondEdit, TEST_TILE_LAYER_ID, 3, 3)).toBe(7);
  });

  it('coalesces rapid tile edits into one optimistic cache frame and one debounced map save', async () => {
    const queryClient = new QueryClient();
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const patchedMaps: TileborneMap[] = [];
    const initialMap = createTestMap();
    const { result } = renderHook(
      ({ map }) =>
        useEditorCommands({
          projectId: 'project-1',
          mapId: 'map-1',
          map,
          onMapPatched: (patchedMap) => {
            patchedMaps.push(patchedMap);
          },
        }),
      {
        initialProps: { map: initialMap },
        wrapper: makeWrapper(queryClient),
      },
    );

    act(() => {
      let currentMap = initialMap;
      for (let tileX = 0; tileX < 8; tileX += 1) {
        const command = createTileEditCommand(currentMap, TEST_TILE_LAYER_ID, tileX, 3, tileX + 1);
        result.current.applyCommand(command);
        currentMap = patchedMaps.at(-1)!;
      }
    });

    expect(patchedMaps).toHaveLength(8);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(setQueryDataSpy).toHaveBeenCalledTimes(1);
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });

    expect(mutateAsyncMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    const savedMap = mutateAsyncMock.mock.calls[0]?.[0]?.map as TileborneMap;
    expect(getTileIndex(savedMap, TEST_TILE_LAYER_ID, 0, 3)).toBe(1);
    expect(getTileIndex(savedMap, TEST_TILE_LAYER_ID, 7, 3)).toBe(8);
  });

  it('replaces live stroke history while applying incremental deltas', () => {
    const queryClient = new QueryClient();
    const patchedMaps: TileborneMap[] = [];
    const initialMap = createTestMap();
    const { result } = renderHook(
      ({ map }) =>
        useEditorCommands({
          projectId: 'project-1',
          mapId: 'map-1',
          map,
          onMapPatched: (patchedMap) => {
            patchedMaps.push(patchedMap);
          },
        }),
      {
        initialProps: { map: initialMap },
        wrapper: makeWrapper(queryClient),
      },
    );

    act(() => {
      const firstDelta = createStrokeTileCommand(TEST_TILE_LAYER_ID, [
        { tileX: 1, tileY: 1, oldIndex: 0, newIndex: 3 },
      ]);
      result.current.applyCommand(firstDelta, {
        history: 'push',
        historyCommand: firstDelta,
      });
      const fullStroke = createStrokeTileCommand(TEST_TILE_LAYER_ID, [
        { tileX: 1, tileY: 1, oldIndex: 0, newIndex: 3 },
        { tileX: 2, tileY: 1, oldIndex: 0, newIndex: 4 },
      ]);
      result.current.applyCommand(
        createStrokeTileCommand(TEST_TILE_LAYER_ID, [
          { tileX: 2, tileY: 1, oldIndex: 0, newIndex: 4 },
        ]),
        { history: 'replace', historyCommand: fullStroke },
      );
    });

    const afterStroke = patchedMaps.at(-1)!;
    expect(getTileIndex(afterStroke, TEST_TILE_LAYER_ID, 1, 1)).toBe(3);
    expect(getTileIndex(afterStroke, TEST_TILE_LAYER_ID, 2, 1)).toBe(4);

    act(() => {
      result.current.undo();
    });

    const afterUndo = patchedMaps.at(-1)!;
    expect(getTileIndex(afterUndo, TEST_TILE_LAYER_ID, 1, 1)).toBe(0);
    expect(getTileIndex(afterUndo, TEST_TILE_LAYER_ID, 2, 1)).toBe(0);
  });

  it('rolls a failed save back to the previous map without keeping a blank optimistic cache', async () => {
    mutateAsyncMock.mockRejectedValueOnce(new Error('save failed'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryClient = new QueryClient();
    const settled: string[] = [];
    const initialMap = createTestMap();
    const { result } = renderHook(
      ({ map }) =>
        useEditorCommands({
          projectId: 'project-1',
          mapId: 'map-1',
          map,
          onPersistSettled: (_map, status) => {
            settled.push(status);
          },
        }),
      {
        initialProps: { map: initialMap },
        wrapper: makeWrapper(queryClient),
      },
    );

    act(() => {
      result.current.applyCommand(createTileEditCommand(initialMap, TEST_TILE_LAYER_ID, 2, 3, 4));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();
    });

    const cached = queryClient.getQueryData<{ map: typeof initialMap }>(
      queryKeys.maps.detail('project-1', 'map-1'),
    );

    expect(settled).toEqual(['rolled-back']);
    expect(cached?.map).toBe(initialMap);
    expect(getTileIndex(cached!.map, TEST_TILE_LAYER_ID, 2, 3)).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[tileborne] failed to persist map edit',
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });
});

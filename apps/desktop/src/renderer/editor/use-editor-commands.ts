import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProjectId, TileborneMap } from '@tileborne/core';

import { useUpdateMap } from '@/hooks/mutations';
import { queryKeys } from '@/lib/query-client';
import { useEditorCommandsBridge } from '@/stores/editor-commands-bridge';

import type { EditorCommand } from './editor-commands.js';

const DEBOUNCE_MS = 300;

const scheduleFrame = (callback: FrameRequestCallback): number => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number;
};

const cancelFrame = (handle: number): void => {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
};

export interface UseEditorCommandsOptions {
  readonly projectId: string;
  readonly mapId: string;
  readonly map: TileborneMap | undefined;
  readonly onMapPatched?: (map: TileborneMap, command: EditorCommand) => void;
  readonly onPersistSettled?: (
    map: TileborneMap,
    status: 'saved' | 'rolled-back',
  ) => void;
}

export interface UseEditorCommandsResult {
  readonly applyCommand: (command: EditorCommand, options?: ApplyCommandOptions) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface ApplyCommandOptions {
  readonly history?: 'push' | 'replace' | 'skip';
  readonly historyCommand?: EditorCommand | undefined;
}

export function useEditorCommands({
  projectId,
  mapId,
  map,
  onMapPatched,
  onPersistSettled,
}: UseEditorCommandsOptions): UseEditorCommandsResult {
  const queryClient = useQueryClient();
  const updateMap = useUpdateMap();
  const undoStackRef = useRef<EditorCommand[]>([]);
  const redoStackRef = useRef<EditorCommand[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mapRef = useRef<TileborneMap | undefined>(map);
  const cacheFrameRef = useRef<number | undefined>(undefined);
  const pendingCacheMapRef = useRef<TileborneMap | undefined>(undefined);
  const pendingMapRef = useRef<TileborneMap | undefined>(undefined);
  const rollbackMapRef = useRef<TileborneMap | undefined>(undefined);
  const saveInFlightMapRef = useRef<TileborneMap | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  const setBridgeCommands = useEditorCommandsBridge((state) => state.setCommands);
  const clearBridgeCommands = useEditorCommandsBridge((state) => state.clearCommands);

  const syncBridge = useCallback(
    (
      undoFn: () => void,
      redoFn: () => void,
      flushPersistFn: () => Promise<void>,
      applyCommandFn: (command: EditorCommand) => void,
    ) => {
      setBridgeCommands({
        projectId,
        mapId,
        undo: undoFn,
        redo: redoFn,
        flushPersist: flushPersistFn,
        applyCommand: applyCommandFn,
        canUndo: undoStackRef.current.length > 0,
        canRedo: redoStackRef.current.length > 0,
      });
    },
    [setBridgeCommands],
  );

  const bump = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const hasLocalPendingEdits = useCallback(
    () =>
      pendingMapRef.current !== undefined ||
      rollbackMapRef.current !== undefined ||
      saveInFlightMapRef.current !== undefined ||
      debounceRef.current !== undefined,
    [],
  );

  useEffect(() => {
    if (map !== undefined && mapRef.current !== map && hasLocalPendingEdits()) {
      return;
    }
    mapRef.current = map;
  }, [hasLocalPendingEdits, map]);

  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
      }
      if (cacheFrameRef.current !== undefined) {
        cancelFrame(cacheFrameRef.current);
        cacheFrameRef.current = undefined;
      }
      clearBridgeCommands({ projectId, mapId });
    },
    [clearBridgeCommands, mapId, projectId],
  );

  const writeCache = useCallback(
    (nextMap: TileborneMap) => {
      queryClient.setQueryData(queryKeys.maps.detail(projectId, mapId), { map: nextMap });
    },
    [mapId, projectId, queryClient],
  );

  const flushCachePatch = useCallback(() => {
    if (cacheFrameRef.current !== undefined) {
      cancelFrame(cacheFrameRef.current);
      cacheFrameRef.current = undefined;
    }
    const pending = pendingCacheMapRef.current;
    pendingCacheMapRef.current = undefined;
    if (pending) {
      writeCache(pending);
    }
  }, [writeCache]);

  const patchCache = useCallback(
    (nextMap: TileborneMap) => {
      pendingCacheMapRef.current = nextMap;
      if (cacheFrameRef.current !== undefined) {
        return;
      }
      cacheFrameRef.current = scheduleFrame(() => {
        cacheFrameRef.current = undefined;
        const pending = pendingCacheMapRef.current;
        pendingCacheMapRef.current = undefined;
        if (pending) {
          writeCache(pending);
        }
      });
    },
    [writeCache],
  );

  const flushPersist = useCallback(async () => {
    flushCachePatch();
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    const pending = pendingMapRef.current;
    if (!pending) {
      return;
    }
    pendingMapRef.current = undefined;
    const rollback = rollbackMapRef.current;
    rollbackMapRef.current = undefined;
    saveInFlightMapRef.current = pending;
    try {
      await updateMap.mutateAsync({ projectId: projectId as ProjectId, map: pending });
      if (saveInFlightMapRef.current === pending) {
        saveInFlightMapRef.current = undefined;
      }
      if (!hasLocalPendingEdits()) {
        onPersistSettled?.(pending, 'saved');
      }
    } catch (error) {
      console.error('[tileborne] failed to persist map edit', error);
      if (saveInFlightMapRef.current === pending) {
        saveInFlightMapRef.current = undefined;
      }
      if (mapRef.current !== pending || pendingMapRef.current !== undefined) {
        return;
      }
      if (rollback) {
        mapRef.current = rollback;
        writeCache(rollback);
        onPersistSettled?.(rollback, 'rolled-back');
      }
    }
  }, [flushCachePatch, hasLocalPendingEdits, onPersistSettled, projectId, updateMap, writeCache]);

  const schedulePersist = useCallback(
    (nextMap: TileborneMap, rollback: TileborneMap) => {
      pendingMapRef.current = nextMap;
      if (!rollbackMapRef.current) {
        rollbackMapRef.current = rollback;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = undefined;
        void flushPersist();
      }, DEBOUNCE_MS);
    },
    [flushPersist],
  );

  const applyCommand = useCallback(
    (command: EditorCommand, options: ApplyCommandOptions = {}) => {
      const currentMap = mapRef.current;
      if (!currentMap) {
        return;
      }
      const nextMap = command.apply(currentMap);
      if (nextMap === currentMap) {
        return;
      }
      const history = options.history ?? 'push';
      if (history !== 'skip') {
        const historyCommand = options.historyCommand ?? command;
        if (history === 'replace' && undoStackRef.current.length > 0) {
          undoStackRef.current[undoStackRef.current.length - 1] = historyCommand;
        } else {
          undoStackRef.current.push(historyCommand);
        }
        redoStackRef.current = [];
      }
      mapRef.current = nextMap;
      patchCache(nextMap);
      onMapPatched?.(nextMap, command);
      schedulePersist(nextMap, currentMap);
      bump();
    },
    [bump, onMapPatched, patchCache, schedulePersist],
  );

  const undo = useCallback(() => {
    const currentMap = mapRef.current;
    if (!currentMap || undoStackRef.current.length === 0) {
      return;
    }
    const command = undoStackRef.current.pop();
    if (!command) {
      return;
    }
    const inverseCommand = command.inverse(currentMap);
    const nextMap = inverseCommand.apply(currentMap);
    if (nextMap === currentMap) {
      return;
    }
    redoStackRef.current.push(command);
    mapRef.current = nextMap;
    patchCache(nextMap);
    onMapPatched?.(nextMap, inverseCommand);
    schedulePersist(nextMap, currentMap);
    bump();
  }, [bump, onMapPatched, patchCache, schedulePersist]);

  const redo = useCallback(() => {
    const currentMap = mapRef.current;
    if (!currentMap || redoStackRef.current.length === 0) {
      return;
    }
    const command = redoStackRef.current.pop();
    if (!command) {
      return;
    }
    const nextMap = command.apply(currentMap);
    if (nextMap === currentMap) {
      return;
    }
    undoStackRef.current.push(command);
    mapRef.current = nextMap;
    patchCache(nextMap);
    onMapPatched?.(nextMap, command);
    schedulePersist(nextMap, currentMap);
    bump();
  }, [bump, onMapPatched, patchCache, schedulePersist]);

  useEffect(() => {
    syncBridge(undo, redo, flushPersist, applyCommand);
  }, [applyCommand, flushPersist, redo, revision, syncBridge, undo]);

  return {
    applyCommand,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
  };
}

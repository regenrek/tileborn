import { useCallback } from 'react';
import type { MapId, ProjectId } from '@tileborne/core';

import { useStartPlaytest, useStopPlaytest } from '@/hooks/mutations';
import { readLobbyModelSelection } from '@/lib/lobby-model-selection';
import { notifyError, notifyInfo, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorCommandsBridge } from '@/stores/editor-commands-bridge';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export function usePlaytestControls() {
  const startPlaytest = useStartPlaytest();
  const stopPlaytest = useStopPlaytest();
  const setPlaytestActive = useEditorUiStore((state) => state.setPlaytestActive);
  const setPlaytestSessionId = useEditorUiStore((state) => state.setPlaytestSessionId);
  const setPlaytestActivePlugins = useEditorUiStore((state) => state.setPlaytestActivePlugins);
  const setPlaytestMode = useEditorUiStore((state) => state.setPlaytestMode);
  const playtestSessionId = useEditorUiStore((state) => state.playtestSessionId);

  const start = useCallback(
    async (
      projectId: string,
      mapId: string,
      options: { readonly selectedPlayerModelId?: string } = {},
    ) => {
      try {
        await useEditorCommandsBridge.getState().flushPersist?.();
        const selectedPlayerModelId =
          options.selectedPlayerModelId ?? readLobbyModelSelection(projectId);
        const result = await startPlaytest.mutateAsync({
          projectId: projectId as ProjectId,
          mapId: mapId as MapId,
          ...(selectedPlayerModelId === undefined ? {} : { selectedPlayerModelId }),
        });
        setPlaytestSessionId(result.session.id);
        setPlaytestActivePlugins(result.session.activePlugins ?? []);
        setPlaytestMode('single');
        setPlaytestActive(result.session.status === 'Running');
        notifyInfo(`Playtest session ${result.session.id} started`);
        if (result.session.runtimeMetrics) {
          notifySuccess(
            `Plugin runtime active · Tick ${result.session.runtimeMetrics.tickCount}`,
          );
        }
      } catch (error) {
        notifyError(error instanceof Error ? error.message : 'Failed to start playtest');
        throw error;
      }
    },
    [setPlaytestActive, setPlaytestActivePlugins, setPlaytestMode, setPlaytestSessionId, startPlaytest],
  );

  const stop = useCallback(async () => {
    if (!playtestSessionId) {
      setPlaytestActive(false);
      setPlaytestSessionId(null);
      setPlaytestActivePlugins([]);
      return;
    }
    try {
      await stopPlaytest.mutateAsync(playtestSessionId);
      notifySuccess('Playtest stopped');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to stop playtest');
    } finally {
      setPlaytestActive(false);
      setPlaytestSessionId(null);
      setPlaytestActivePlugins([]);
      setPlaytestMode('none');
    }
  }, [
    playtestSessionId,
    setPlaytestActive,
    setPlaytestActivePlugins,
    setPlaytestMode,
    setPlaytestSessionId,
    stopPlaytest,
  ]);

  return {
    start,
    stop,
    isStarting: startPlaytest.isPending,
    isStopping: stopPlaytest.isPending,
  };
}

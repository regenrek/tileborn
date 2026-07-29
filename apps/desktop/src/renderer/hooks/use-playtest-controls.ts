import { useCallback } from 'react';
import type { MapId, ProjectId } from '@tileborne/core';

import { useStartPlaytest, useStopPlaytest } from '@/hooks/mutations';
import { readLobbyModelSelection } from '@/lib/lobby-model-selection';
import { notifyError, notifyInfo, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorCommandsBridge } from '@/stores/editor-commands-bridge';
import { useEditorUiStore } from '@/stores/editor-ui-store';

export type PlaytestStopOwner = {
  readonly sessionId: string;
  readonly projectId: string;
  readonly mapId: string;
};

const stoppedPlaytestOwnerKeys = new Set<string>();
const stoppingPlaytestOwnerPromises = new Map<string, Promise<void>>();

export const playtestStopOwnerKey = (owner: PlaytestStopOwner): string =>
  `${owner.sessionId}\u0000${owner.projectId}\u0000${owner.mapId}`;

export const isPlaytestStopOwnerStopped = (owner: PlaytestStopOwner): boolean =>
  stoppedPlaytestOwnerKeys.has(playtestStopOwnerKey(owner));

const markPlaytestStopOwnerStopped = (owner: PlaytestStopOwner): void => {
  stoppedPlaytestOwnerKeys.add(playtestStopOwnerKey(owner));
};

export const resetPlaytestStopCoordinatorForTests = (): void => {
  stoppedPlaytestOwnerKeys.clear();
  stoppingPlaytestOwnerPromises.clear();
};

export function usePlaytestControls() {
  const startPlaytest = useStartPlaytest();
  const stopPlaytest = useStopPlaytest();
  const setPlaytestActive = useEditorUiStore((state) => state.setPlaytestActive);
  const setPlaytestSessionId = useEditorUiStore((state) => state.setPlaytestSessionId);
  const setPlaytestActivePlugins = useEditorUiStore((state) => state.setPlaytestActivePlugins);
  const setPlaytestMode = useEditorUiStore((state) => state.setPlaytestMode);

  const start = useCallback(
    async (
      projectId: string,
      mapId: string,
      options: { readonly selectedPlayerModelId?: string } = {},
    ) => {
      try {
        await useEditorCommandsBridge.getState().flushPersistFor(projectId, mapId);
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
          notifySuccess(`Plugin runtime active · Tick ${result.session.runtimeMetrics.tickCount}`);
        }
      } catch (error) {
        notifyError(error instanceof Error ? error.message : 'Failed to start playtest');
        throw error;
      }
    },
    [
      setPlaytestActive,
      setPlaytestActivePlugins,
      setPlaytestMode,
      setPlaytestSessionId,
      startPlaytest,
    ],
  );

  const stop = useCallback(
    async (owner: PlaytestStopOwner) => {
      const ownerKey = playtestStopOwnerKey(owner);
      if (stoppedPlaytestOwnerKeys.has(ownerKey)) {
        return undefined;
      }
      const pendingStop = stoppingPlaytestOwnerPromises.get(ownerKey);
      if (pendingStop !== undefined) {
        return pendingStop;
      }
      let stopPromise!: Promise<void>;
      stopPromise = (async () => {
        const sessionId = owner.sessionId;
        const clearActiveSession = () => {
          if (useEditorUiStore.getState().playtestSessionId === sessionId) {
            setPlaytestActive(false);
            setPlaytestSessionId(null);
            setPlaytestActivePlugins([]);
            setPlaytestMode('none');
          }
        };
        try {
          const response = await stopPlaytest.mutateAsync({
            sessionId,
            projectId: owner.projectId as ProjectId,
            mapId: owner.mapId as MapId,
          });
          if (response.session.status === 'Stopped') {
            markPlaytestStopOwnerStopped(owner);
            clearActiveSession();
          }
          notifySuccess('Playtest stopped');
        } catch (error) {
          const reconciledStopped = await window.tileborne.playtest
            .list({})
            .then((response) => {
              const current = response.sessions.find((session) => session.id === sessionId);
              return current === undefined || current.status === 'Stopped';
            })
            .catch(() => false);
          if (reconciledStopped) {
            markPlaytestStopOwnerStopped(owner);
            clearActiveSession();
          }
          notifyError(error instanceof Error ? error.message : 'Failed to stop playtest');
          throw error;
        } finally {
          if (stoppingPlaytestOwnerPromises.get(ownerKey) === stopPromise) {
            stoppingPlaytestOwnerPromises.delete(ownerKey);
          }
        }
      })();
      stoppingPlaytestOwnerPromises.set(ownerKey, stopPromise);
      return stopPromise;
    },
    [
      setPlaytestActive,
      setPlaytestActivePlugins,
      setPlaytestMode,
      setPlaytestSessionId,
      stopPlaytest,
    ],
  );

  return {
    start,
    stop,
    isStarting: startPlaytest.isPending,
    isStopping: stopPlaytest.isPending,
  };
}

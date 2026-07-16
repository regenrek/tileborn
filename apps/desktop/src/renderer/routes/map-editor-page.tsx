import { Link, useParams, useSearch } from '@tanstack/react-router';
import {
  decodePersistedTileborneMapJson,
  type ProjectId,
  type TileborneMap,
} from '@tileborne/core';
import { Button, Skeleton } from '@tileborne/ui';
import { MapIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { MapEditorViewport } from '@/components/map-editor-viewport';
import { MapEditorToolbar } from '@/components/map-editor-toolbar';
import { PlaytestMultiplayerViewport } from '@/components/playtest-multiplayer-viewport';
import { PlaytestViewport } from '@/components/playtest-viewport';
import { useCreateMap } from '@/hooks/mutations';
import { useMap, useMaps, usePluginContributions, useProject } from '@/hooks/queries';
import { resolveProjectActiveGameMode } from '@/lib/active-game-mode-selection';
import { formatMutationError } from '@/lib/mutation-notifications';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import {
  disposePlaytestMultiplayerSession,
  usePlaytestMultiplayerStore,
} from '@/stores/playtest-multiplayer-store';

export function MapEditorPage() {
  const { projectId, mapId } = useParams({
    from: '/editor/projects/$projectId/maps/$mapId',
  });
  const search = useSearch({ strict: false }) as {
    joinBase?: string;
    joinRoom?: string;
  };
  const mapQuery = useMap(projectId, mapId);
  const mapsQuery = useMaps(projectId);
  const projectQuery = useProject(projectId);
  const contributionsQuery = usePluginContributions();
  const createMap = useCreateMap();
  // ADR-0023 section B: the deep-link join runs the ACTIVE game mode's
  // discovered playtest runtime, resolved from the project selection.
  const rendererCapabilityId = resolveProjectActiveGameMode(
    contributionsQuery.data?.gameModes ?? [],
    projectQuery.data?.project,
  )?.rendererCapabilityId;
  const playtestActive = useEditorUiStore((state) => state.playtestActive);
  const playtestMode = useEditorUiStore((state) => state.playtestMode);
  const playtestSessionId = useEditorUiStore((state) => state.playtestSessionId);
  const playtestActivePlugins = useEditorUiStore((state) => state.playtestActivePlugins);
  const addRecentProject = useEditorUiStore((state) => state.addRecentProject);
  const setRecentProjectMap = useEditorUiStore((state) => state.setRecentProjectMap);
  const joinFromInput = usePlaytestMultiplayerStore((state) => state.joinFromInput);

  useEffect(() => {
    addRecentProject(projectId);
    setRecentProjectMap(projectId, mapId);
  }, [addRecentProject, mapId, projectId, setRecentProjectMap]);

  useEffect(() => {
    if (!search.joinRoom || !mapQuery.data?.map) {
      return;
    }
    // Wait until the discovered modes + project selection are loaded so the
    // join targets the resolved active mode (not a spurious "no mode" error).
    if (contributionsQuery.isLoading || projectQuery.isLoading) {
      return;
    }
    const joinInput =
      search.joinBase && search.joinRoom
        ? `${search.joinBase.replace(/\/$/, '')}/rooms/${search.joinRoom}`
        : search.joinRoom;
    void joinFromInput(
      joinInput,
      rendererCapabilityId,
      mapId,
      mapQuery.data.map.size.width,
      mapQuery.data.map.size.height,
      search.joinBase,
    );
  }, [
    rendererCapabilityId,
    contributionsQuery.isLoading,
    projectQuery.isLoading,
    joinFromInput,
    mapId,
    mapQuery.data?.map,
    search.joinBase,
    search.joinRoom,
  ]);

  useEffect(
    () => () => {
      disposePlaytestMultiplayerSession();
    },
    [],
  );

  // The viewports consume a runtime `TileborneMap` (`_tag` layers + Option fields).
  // The maps cache may hold EITHER the persisted IPC shape (layers keyed by
  // `kind`, e.g. a fresh `maps.get` fetch) OR an already-decoded runtime map (an
  // optimistic/in-memory write). Decode only the persisted shape through the
  // canonical boundary (ADR-0019); pass an already-decoded map through unchanged
  // so we never double-decode. Memoized to keep a stable identity across renders.
  const map = useMemo(() => {
    const raw = mapQuery.data?.map;
    if (raw === undefined) {
      return undefined;
    }
    const firstLayer = (raw as { readonly layers?: ReadonlyArray<Record<string, unknown>> })
      .layers?.[0];
    if (firstLayer !== undefined && '_tag' in firstLayer && !('kind' in firstLayer)) {
      return raw as TileborneMap;
    }
    return decodePersistedTileborneMapJson(raw);
  }, [mapQuery.data?.map]);

  if (mapQuery.isLoading) {
    return (
      <div
        className="flex h-full flex-col gap-3 p-4"
        aria-busy="true"
        aria-label="Loading map"
        data-testid="map-editor-loading"
      >
        <Skeleton className="h-10 w-full max-w-xl rounded-md" />
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      </div>
    );
  }

  if (mapQuery.isError || !mapQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <MapIcon className="size-10 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-medium">Open or create a map</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Pick an existing map or create a new one to open the map editor viewport.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {(mapsQuery.data?.maps ?? []).slice(0, 5).map((map) => (
            <Link
              key={map.id}
              to="/projects/$projectId/maps/$mapId"
              params={{ projectId, mapId: map.id }}
            >
              <Button variant="outline" size="sm">
                Open {map.id}
              </Button>
            </Link>
          ))}
          <Button
            size="sm"
            disabled={createMap.isPending}
            onClick={() => {
              void createMap
                .mutateAsync({ projectId: projectId as ProjectId, width: 64, height: 64 })
                .then((result) => {
                  notifySuccess(`Created map ${result.mapId}`);
                })
                .catch((error) => {
                  notifyError(
                    formatMutationError(error, 'create map', 'Adjust dimensions and retry.'),
                  );
                });
            }}
          >
            Create map
          </Button>
        </div>
      </div>
    );
  }

  if (map === undefined) {
    return null;
  }
  const singlePlaytestSessionId =
    playtestActive && playtestMode === 'single' ? playtestSessionId : null;
  const showSinglePlaytest = singlePlaytestSessionId !== null;
  const showMultiplayerPlaytest = playtestActive && playtestMode === 'multiplayer';
  const showEditorViewport = !showSinglePlaytest && !showMultiplayerPlaytest;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {showEditorViewport ? (
        <MapEditorViewport projectId={projectId} mapId={mapId} map={map} />
      ) : null}
      {!playtestActive ? <MapEditorToolbar /> : null}
      {showSinglePlaytest ? (
        <PlaytestViewport
          projectId={projectId}
          map={map}
          sessionId={singlePlaytestSessionId}
          activePlugins={playtestActivePlugins}
        />
      ) : null}
      {showMultiplayerPlaytest ? (
        <PlaytestMultiplayerViewport projectId={projectId} map={map} />
      ) : null}
    </div>
  );
}

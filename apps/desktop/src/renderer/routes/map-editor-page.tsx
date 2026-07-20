import { Link, useParams, useSearch } from '@tanstack/react-router';
import {
  decodePersistedTileborneMapJson,
  type ProjectId,
  type TileborneMap,
} from '@tileborne/core';
import { Button, Skeleton } from '@tileborne/ui';
import { MapIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, type ComponentProps } from 'react';

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

type MapEditorPlaytestDebugWindow = Window & {
  __tileborneMapEditorPlaytestDebug?: {
    events: Array<{
      event: 'render' | 'mount-single' | 'unmount-single' | 'mount-page' | 'unmount-page';
      projectId: string;
      mapId: string;
      playtestActive: boolean;
      playtestMode: string;
      playtestSessionId: string | null;
      retainedSessionId: string | null;
      showSinglePlaytest: boolean;
      mapQueryState?: string | undefined;
      retainedMapKey?: string | undefined;
    }>;
  };
};

type MapEditorPlaytestDebugEvent =
  MapEditorPlaytestDebugWindow['__tileborneMapEditorPlaytestDebug'] extends infer Debug
    ? Debug extends { events: Array<infer Event> }
      ? Event
      : never
    : never;

const appendMapEditorPlaytestDebugEvent = (event: MapEditorPlaytestDebugEvent): void => {
  const debugWindow = window as MapEditorPlaytestDebugWindow;
  if (debugWindow.__tileborneMapEditorPlaytestDebug === undefined) return;
  debugWindow.__tileborneMapEditorPlaytestDebug.events = [
    ...debugWindow.__tileborneMapEditorPlaytestDebug.events,
    event,
  ].slice(-30);
};

const decodeMapForEditor = (raw: unknown): TileborneMap | undefined => {
  if (raw === undefined) return undefined;
  const firstLayer = (raw as { readonly layers?: ReadonlyArray<Record<string, unknown>> })
    .layers?.[0];
  if (firstLayer !== undefined && '_tag' in firstLayer && !('kind' in firstLayer)) {
    return raw as TileborneMap;
  }
  return decodePersistedTileborneMapJson(raw);
};

function InstrumentedSinglePlaytestViewport({
  debug,
  ...props
}: ComponentProps<typeof PlaytestViewport> & {
  readonly debug: Omit<MapEditorPlaytestDebugEvent, 'event'>;
}) {
  useEffect(() => {
    appendMapEditorPlaytestDebugEvent({ event: 'mount-single', ...debug });
    return () => {
      appendMapEditorPlaytestDebugEvent({ event: 'unmount-single', ...debug });
    };
  }, [debug]);
  return <PlaytestViewport {...props} />;
}

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
  const retainedSinglePlaytestSessionIdRef = useRef<string | null>(null);
  const mapRouteKey = `${projectId}:${mapId}`;
  const retainedMapRef = useRef<{ key: string; map: TileborneMap } | undefined>(undefined);

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
  const freshMap = useMemo(() => decodeMapForEditor(mapQuery.data?.map), [mapQuery.data?.map]);
  if (freshMap !== undefined) {
    retainedMapRef.current = { key: mapRouteKey, map: freshMap };
  } else if (retainedMapRef.current?.key !== mapRouteKey) {
    retainedMapRef.current = undefined;
  }
  const map = freshMap ?? retainedMapRef.current?.map;
  const mapQueryState = mapQuery.isLoading
    ? 'loading'
    : mapQuery.isError
      ? 'error'
      : mapQuery.data === undefined
        ? 'missing'
        : freshMap === undefined
          ? 'invalid'
          : 'ready';
  useEffect(() => {
    appendMapEditorPlaytestDebugEvent({
      event: 'mount-page',
      projectId,
      mapId,
      playtestActive,
      playtestMode,
      playtestSessionId,
      retainedSessionId: retainedSinglePlaytestSessionIdRef.current,
      showSinglePlaytest: false,
      mapQueryState,
      retainedMapKey: retainedMapRef.current?.key,
    });
    return () => {
      appendMapEditorPlaytestDebugEvent({
        event: 'unmount-page',
        projectId,
        mapId,
        playtestActive,
        playtestMode,
        playtestSessionId,
        retainedSessionId: retainedSinglePlaytestSessionIdRef.current,
        showSinglePlaytest: false,
        mapQueryState,
        retainedMapKey: retainedMapRef.current?.key,
      });
    };
  }, [mapId, mapQueryState, playtestActive, playtestMode, playtestSessionId, projectId]);

  if (playtestActive && playtestMode === 'single' && playtestSessionId !== null) {
    retainedSinglePlaytestSessionIdRef.current = playtestSessionId;
  }
  if (!playtestActive || playtestMode !== 'single') {
    retainedSinglePlaytestSessionIdRef.current = null;
  }
  const singlePlaytestSessionId =
    playtestActive && playtestMode === 'single'
      ? (playtestSessionId ?? retainedSinglePlaytestSessionIdRef.current)
      : null;
  const showSinglePlaytest = singlePlaytestSessionId !== null;
  const showMultiplayerPlaytest = playtestActive && playtestMode === 'multiplayer';
  const showEditorViewport = !showSinglePlaytest && !showMultiplayerPlaytest;
  const playtestBranchDebug = useMemo(
    () => ({
      projectId,
      mapId,
      playtestActive,
      playtestMode,
      playtestSessionId,
      retainedSessionId: retainedSinglePlaytestSessionIdRef.current,
      showSinglePlaytest,
      mapQueryState,
      retainedMapKey: retainedMapRef.current?.key,
    }),
    [
      mapId,
      mapQueryState,
      playtestActive,
      playtestMode,
      playtestSessionId,
      projectId,
      showSinglePlaytest,
    ],
  );

  if (mapQuery.isLoading && map === undefined) {
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

  if ((mapQuery.isError || !mapQuery.data) && map === undefined) {
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
  appendMapEditorPlaytestDebugEvent({ event: 'render', ...playtestBranchDebug });
  const usingRetainedMap = freshMap === undefined && map !== undefined;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {usingRetainedMap ? (
        <div
          role={mapQuery.isError ? 'alert' : 'status'}
          data-testid="map-editor-retained-map-status"
          className="pointer-events-none absolute left-3 top-3 z-50 rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm"
        >
          {mapQuery.isError
            ? 'Map refresh failed; continuing with the last loaded map.'
            : 'Refreshing map…'}
        </div>
      ) : null}
      {showEditorViewport ? (
        <MapEditorViewport projectId={projectId} mapId={mapId} map={map} />
      ) : null}
      {!playtestActive ? <MapEditorToolbar /> : null}
      {showSinglePlaytest ? (
        <InstrumentedSinglePlaytestViewport
          projectId={projectId}
          map={map}
          sessionId={singlePlaytestSessionId}
          activePlugins={playtestActivePlugins}
          debug={playtestBranchDebug}
        />
      ) : null}
      {showMultiplayerPlaytest ? (
        <PlaytestMultiplayerViewport projectId={projectId} map={map} />
      ) : null}
    </div>
  );
}

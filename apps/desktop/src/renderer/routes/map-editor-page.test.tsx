// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestMap } from '@/editor/test-fixtures';

const mapQueryMock = vi.hoisted(() => ({
  current: { isLoading: false, isError: false, data: undefined as unknown },
}));
const routeParamsMock = vi.hoisted(() => ({
  current: { projectId: 'project-1', mapId: 'map-1' },
}));
const editorStateMock = vi.hoisted(() => ({
  current: {
    playtestActive: false,
    playtestMode: 'none',
    playtestSessionId: null as string | null,
    playtestActivePlugins: [] as readonly string[],
    addRecentProject: vi.fn(),
    setRecentProjectMap: vi.fn(),
  },
}));
const editorViewportUnmountMock = vi.hoisted(() => vi.fn());
const playtestViewportUnmountMock = vi.hoisted(() => vi.fn());
const playtestViewportCleanupOwners = vi.hoisted(
  () => [] as { readonly sessionId: string; readonly projectId: string; readonly mapId: string }[],
);

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { readonly children: ReactNode }) => <a>{children}</a>,
  useParams: () => routeParamsMock.current,
  useSearch: () => ({}),
}));

vi.mock('@/hooks/queries', () => ({
  useMap: () => mapQueryMock.current,
  useMaps: () => ({ data: { maps: [] } }),
  useProject: () => ({ data: undefined, isLoading: false }),
  usePluginContributions: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/mutations', () => ({
  useCreateMap: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: typeof editorStateMock.current) => unknown) =>
    selector(editorStateMock.current),
}));

vi.mock('@/stores/playtest-multiplayer-store', () => ({
  disposePlaytestMultiplayerSession: vi.fn(),
  usePlaytestMultiplayerStore: (
    selector: (state: { joinFromInput: () => Promise<void> }) => unknown,
  ) => selector({ joinFromInput: vi.fn(async () => undefined) }),
}));

vi.mock('@/components/map-editor-toolbar', () => ({
  MapEditorToolbar: () => <div data-testid="editor-toolbar" />,
}));

vi.mock('@/components/playtest-viewport', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    PlaytestViewport: ({
      sessionId,
      projectId,
      map,
    }: {
      readonly sessionId: string;
      readonly projectId: string;
      readonly map: { readonly id: string };
    }) => {
      React.useEffect(
        () => () => {
          playtestViewportUnmountMock();
          playtestViewportCleanupOwners.push({ sessionId, projectId, mapId: map.id });
        },
        [map.id, projectId, sessionId],
      );
      return (
        <div
          data-testid="single-playtest-viewport"
          data-session-id={sessionId}
          data-project-id={projectId}
          data-map-id={map.id}
        />
      );
    },
  };
});

vi.mock('@/components/playtest-multiplayer-viewport', () => ({
  PlaytestMultiplayerViewport: () => <div data-testid="multiplayer-playtest-viewport" />,
}));

vi.mock('@/components/map-editor-viewport', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    MapEditorViewport: () => {
      React.useEffect(() => () => editorViewportUnmountMock(), []);
      return <div data-testid="editor-viewport" />;
    },
  };
});

import { MapEditorPage } from './map-editor-page';

describe('MapEditorPage playtest viewport ownership', () => {
  beforeEach(() => {
    mapQueryMock.current = {
      isLoading: false,
      isError: false,
      data: { map: createTestMap() },
    };
    routeParamsMock.current = { projectId: 'project-1', mapId: 'map-1' };
    editorStateMock.current = {
      playtestActive: false,
      playtestMode: 'none',
      playtestSessionId: null,
      playtestActivePlugins: [],
      addRecentProject: vi.fn(),
      setRecentProjectMap: vi.fn(),
    };
    editorViewportUnmountMock.mockReset();
    playtestViewportUnmountMock.mockReset();
    playtestViewportCleanupOwners.splice(0);
  });

  afterEach(() => {
    cleanup();
  });

  it('unmounts the editor viewport while a playtest viewport is active', () => {
    const { queryByTestId, rerender } = render(<MapEditorPage />);

    expect(queryByTestId('editor-viewport')).not.toBeNull();
    expect(queryByTestId('single-playtest-viewport')).toBeNull();

    editorStateMock.current = {
      ...editorStateMock.current,
      playtestActive: true,
      playtestMode: 'single',
      playtestSessionId: 'session-1',
      playtestActivePlugins: ['@tileborne-plugins/example-arena'],
    };
    rerender(<MapEditorPage />);

    expect(queryByTestId('editor-viewport')).toBeNull();
    expect(queryByTestId('single-playtest-viewport')).not.toBeNull();
    expect(editorViewportUnmountMock).toHaveBeenCalledTimes(1);
  });

  it('retains the single playtest viewport across transient session id churn while playtest stays active', () => {
    editorStateMock.current = {
      ...editorStateMock.current,
      playtestActive: true,
      playtestMode: 'single',
      playtestSessionId: 'session-1',
      playtestActivePlugins: ['@tileborne-plugins/example-arena'],
    };
    const { getByTestId, queryByTestId, rerender } = render(<MapEditorPage />);

    const viewport = getByTestId('single-playtest-viewport');
    expect(viewport.getAttribute('data-session-id')).toBe('session-1');

    editorStateMock.current = {
      ...editorStateMock.current,
      playtestSessionId: null,
    };
    rerender(<MapEditorPage />);

    expect(queryByTestId('editor-viewport')).toBeNull();
    expect(getByTestId('single-playtest-viewport')).toBe(viewport);
    expect(getByTestId('single-playtest-viewport').getAttribute('data-session-id')).toBe(
      'session-1',
    );
    expect(playtestViewportUnmountMock).not.toHaveBeenCalled();

    editorStateMock.current = {
      ...editorStateMock.current,
      playtestSessionId: 'session-1',
    };
    rerender(<MapEditorPage />);

    expect(getByTestId('single-playtest-viewport')).toBe(viewport);
    expect(playtestViewportUnmountMock).not.toHaveBeenCalled();

    editorStateMock.current = {
      ...editorStateMock.current,
      playtestActive: false,
      playtestMode: 'none',
      playtestSessionId: null,
    };
    rerender(<MapEditorPage />);

    expect(queryByTestId('single-playtest-viewport')).toBeNull();
    expect(playtestViewportUnmountMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up the mounted playtest owner when route project or map changes', () => {
    const oldMap = { ...createTestMap(), id: 'map-owned-1' as never };
    const newMap = { ...createTestMap(), id: 'map-owned-2' as never };
    mapQueryMock.current = {
      isLoading: false,
      isError: false,
      data: { map: oldMap },
    };
    editorStateMock.current = {
      ...editorStateMock.current,
      playtestActive: true,
      playtestMode: 'single',
      playtestSessionId: 'session-route',
      playtestActivePlugins: ['@tileborne-plugins/example-arena'],
    };
    const { getByTestId, rerender, unmount } = render(<MapEditorPage />);
    expect(getByTestId('single-playtest-viewport').getAttribute('data-project-id')).toBe(
      'project-1',
    );

    routeParamsMock.current = { projectId: 'project-2', mapId: 'map-2' };
    mapQueryMock.current = {
      isLoading: false,
      isError: false,
      data: { map: newMap },
    };
    rerender(<MapEditorPage />);

    expect(playtestViewportCleanupOwners).toContainEqual({
      sessionId: 'session-route',
      projectId: 'project-1',
      mapId: 'map-owned-1',
    });
    expect(getByTestId('single-playtest-viewport').getAttribute('data-project-id')).toBe(
      'project-2',
    );

    unmount();
    expect(playtestViewportCleanupOwners).toContainEqual({
      sessionId: 'session-route',
      projectId: 'project-2',
      mapId: 'map-owned-2',
    });
  });

  it('retains the opened map editor route across transient map query churn', () => {
    const { getByTestId, queryByTestId, rerender } = render(<MapEditorPage />);

    const editorViewport = getByTestId('editor-viewport');

    mapQueryMock.current = {
      isLoading: true,
      isError: false,
      data: undefined,
    };
    rerender(<MapEditorPage />);

    expect(queryByTestId('map-editor-loading')).toBeNull();
    expect(getByTestId('editor-viewport')).toBe(editorViewport);
    expect(getByTestId('map-editor-retained-map-status').textContent).toContain('Refreshing map');
    expect(editorViewportUnmountMock).not.toHaveBeenCalled();

    mapQueryMock.current = {
      isLoading: false,
      isError: true,
      data: undefined,
    };
    rerender(<MapEditorPage />);

    expect(getByTestId('editor-viewport')).toBe(editorViewport);
    expect(getByTestId('map-editor-retained-map-status').textContent).toContain(
      'Map refresh failed',
    );
    expect(editorViewportUnmountMock).not.toHaveBeenCalled();
  });

  it('keeps hook order stable when the map query resolves after an initial loading render', () => {
    mapQueryMock.current = {
      isLoading: true,
      isError: false,
      data: undefined,
    };
    const { getByTestId, queryByTestId, rerender } = render(<MapEditorPage />);

    expect(getByTestId('map-editor-loading')).not.toBeNull();

    mapQueryMock.current = {
      isLoading: false,
      isError: false,
      data: { map: createTestMap() },
    };
    rerender(<MapEditorPage />);

    expect(queryByTestId('map-editor-loading')).toBeNull();
    expect(getByTestId('editor-viewport')).not.toBeNull();
  });
});

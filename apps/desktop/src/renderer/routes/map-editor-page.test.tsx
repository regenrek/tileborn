// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestMap } from '@/editor/test-fixtures';

const mapQueryMock = vi.hoisted(() => ({
  current: { isLoading: false, isError: false, data: undefined as unknown },
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { readonly children: ReactNode }) => <a>{children}</a>,
  useParams: () => ({ projectId: 'project-1', mapId: 'map-1' }),
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

vi.mock('@/components/playtest-viewport', () => ({
  PlaytestViewport: () => <div data-testid="single-playtest-viewport" />,
}));

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
    editorStateMock.current = {
      playtestActive: false,
      playtestMode: 'none',
      playtestSessionId: null,
      playtestActivePlugins: [],
      addRecentProject: vi.fn(),
      setRecentProjectMap: vi.fn(),
    };
    editorViewportUnmountMock.mockReset();
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
});

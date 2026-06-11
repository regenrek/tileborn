// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as Record<string, never>)}>{children}</a>
  ),
  useParams: () => ({ projectId: 'project-1', mapId: undefined }),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({
    data: { project: { id: 'project-1', name: 'Demo Project' } },
    isLoading: false,
  }),
  useMaps: () => ({
    data: { maps: [{ id: 'map-1', width: 64, height: 64 }] },
    isLoading: false,
  }),
  usePluginContributions: () => ({ data: undefined, isLoading: false, isError: false }),
}));

const { setSpriteEditorOpen } = vi.hoisted(() => ({ setSpriteEditorOpen: vi.fn() }));

vi.mock('@/stores/editor-ui-store', () => {
  const state = {
    setGenerateMapDialogOpen: vi.fn(),
    setCreateMapDialogOpen: vi.fn(),
    setSpriteEditorOpen,
    recentProjectMaps: {},
  };
  type State = typeof state;
  const useEditorUiStore = (selector: (value: State) => unknown) => selector(state);
  return { useEditorUiStore };
});

import { ProjectTreeTab } from './project-tree-tab';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectTreeTab tools section', () => {
  it('lists the registry tool editors and the sprite studio action', () => {
    render(<ProjectTreeTab projectId="project-1" />);

    expect(screen.getByTestId('sidebar-tools')).toBeTruthy();
    expect(screen.getByTestId('sidebar-tool-entity-editor').textContent).toContain(
      'Entity Editor',
    );
    expect(screen.getByTestId('sidebar-tool-player-model-editor').textContent).toContain(
      'Player Model Editor',
    );
    expect(screen.getByTestId('sidebar-tool-sprite-studio').textContent).toContain(
      'Sprite / Animation Studio',
    );
  });

  it('opens the sprite studio dialog from the tools section', () => {
    render(<ProjectTreeTab projectId="project-1" />);

    fireEvent.click(screen.getByTestId('sidebar-tool-sprite-studio'));
    expect(setSpriteEditorOpen).toHaveBeenCalledWith(true);
  });

  it('hides the tools section when no project is open', () => {
    render(<ProjectTreeTab projectId={undefined} />);

    expect(screen.queryByTestId('sidebar-tools')).toBeNull();
  });
});

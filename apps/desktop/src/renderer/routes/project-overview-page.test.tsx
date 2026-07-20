// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    readonly children: ReactNode;
    readonly to: string;
    readonly params?: Record<string, string>;
  }) => {
    const href = params?.projectId === undefined ? to : to.replace('$projectId', params.projectId);
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ projectId: 'project:550e8400-e29b-41d4-a716-446655440001' }),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({
    data: {
      project: {
        id: 'project:550e8400-e29b-41d4-a716-446655440001',
        name: 'Audio Route Project',
        engineVersion: '0.1.0',
      },
    },
  }),
  useMaps: () => ({ data: { maps: [] } }),
  useReadiness: () => ({
    data: {
      report: {
        ok: true,
        purpose: 'authoring',
        diagnostics: [],
      },
    },
    isLoading: false,
  }),
  usePluginContributions: () => ({ data: { gameModes: [] } }),
}));

const editorState = {
  addRecentProject: vi.fn(),
  setCreateMapDialogOpen: vi.fn(),
  setGenerateMapDialogOpen: vi.fn(),
  setShipGameDialogOpen: vi.fn(),
};

vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: typeof editorState) => unknown) => selector(editorState),
}));

import { ProjectOverviewPage } from './project-overview-page';

describe('ProjectOverviewPage production workspace route entries', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('links from the project overview to the Audio workspace route', () => {
    render(<ProjectOverviewPage />);

    expect(screen.getByTestId('open-audio').getAttribute('href')).toBe(
      '/projects/project:550e8400-e29b-41d4-a716-446655440001/audio',
    );
    expect(screen.getByText('Music, SFX and event bindings')).toBeDefined();
  });

  it('links from the project overview to the Game Shell workspace route', () => {
    render(<ProjectOverviewPage />);

    expect(screen.getByTestId('open-game-shell').getAttribute('href')).toBe(
      '/projects/project:550e8400-e29b-41d4-a716-446655440001/game-shell',
    );
    expect(screen.getByText('Menus, screens and actions')).toBeDefined();
  });
});

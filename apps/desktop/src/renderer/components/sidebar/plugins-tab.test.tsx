// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const battleRoyalePluginId = ['@tileborne-plugins', 'battle-royale'].join('/');

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as Record<string, never>)}>{children}</a>
  ),
  useParams: () => ({ projectId: 'project-1', mapId: 'map-1' }),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({ data: undefined }),
  usePluginsList: () => ({
    data: {
      plugins: [
        {
          id: 'tileborne.battle-royale',
          version: '0.1.0',
          rootPath: '/plugins/br',
          enabled: true,
        },
      ],
    },
    isLoading: false,
  }),
  usePluginContributions: () => ({
    data: {
      panels: [
        {
          pluginId: battleRoyalePluginId,
          pluginName: 'Battle Royale',
          id: 'battle-royale-settings',
          zone: 'plugins',
          title: 'Battle Royale Settings',
          description: 'Configure battle royale gameplay.',
          capabilities: ['settings'],
        },
      ],
      tools: [],
      gameModes: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/mutations', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/stores/editor-ui-store', () => {
  const state = {
    setPluginInstallDialogOpen: vi.fn(),
  };
  type State = typeof state;
  const useEditorUiStore = (selector: (value: State) => unknown) => selector(state);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, { getState: () => state }),
  };
});

import { PluginsTab } from '@/components/sidebar/plugins-tab';

describe('PluginsTab', () => {
  afterEach(() => {
    cleanup();
  });

  it('places plugin-provided settings under Plugins', () => {
    render(<PluginsTab projectId="project-1" />);

    expect(screen.getByTestId('sidebar-plugin-zone-plugins')).toBeTruthy();
    expect(screen.getByText('Battle Royale Settings')).toBeTruthy();
    expect(screen.getByText('Open plugin manager')).toBeTruthy();
  });
});

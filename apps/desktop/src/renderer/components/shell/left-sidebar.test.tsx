// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project-1', mapId: 'map-1' }),
}));

vi.mock('@/hooks/queries', () => ({
  useMaps: () => ({ data: { maps: [{ id: 'map-1' }, { id: 'map-2' }] } }),
  useAssetPacks: () => ({
    data: { packs: [{ id: 'pack-1' }, { id: 'pack-2' }, { id: 'pack-3' }] },
  }),
  usePluginsList: () => ({ data: { plugins: [{ id: 'plugin-1' }] } }),
}));

vi.mock('@/hooks/use-working-palettes', () => ({
  useActiveWorkingPalette: () => ({
    id: 'palette-1',
    name: 'Build palette',
    items: [{ id: 'item-1' }, { id: 'item-2' }],
  }),
}));

vi.mock('@/components/sidebar/project-tree-tab', () => ({
  ProjectTreeTab: () => <div data-testid="project-section">Project maps</div>,
  ProjectTreeTabCollapsedHint: ({ onClick }: { readonly onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      Project
    </button>
  ),
}));

vi.mock('@/components/sidebar/working-palette-tab', () => ({
  WorkingPaletteTab: () => <div data-testid="working-palette-section">Working palette content</div>,
  WorkingPaletteTabCollapsedHint: ({ onClick }: { readonly onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      Working Palette
    </button>
  ),
}));

vi.mock('@/components/sidebar/assets-tab', () => ({
  AssetsTab: () => <div data-testid="assets-section">Assets content</div>,
  AssetsTabCollapsedHint: ({ onClick }: { readonly onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      Assets
    </button>
  ),
}));

vi.mock('@/components/sidebar/plugins-tab', () => ({
  PluginsTab: () => <div data-testid="plugins-section">Plugin settings</div>,
  PluginsTabCollapsedHint: ({ onClick }: { readonly onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      Plugins
    </button>
  ),
}));

vi.mock('@/stores/editor-ui-store', () => {
  const state = {
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn((collapsed: boolean) => {
      state.sidebarCollapsed = collapsed;
    }),
  };
  type State = typeof state;
  const useEditorUiStore = (selector: (value: State) => unknown) => selector(state);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, { getState: () => state }),
  };
});

import { LeftSidebar } from '@/components/shell/left-sidebar';

describe('LeftSidebar IA navigation', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses Project as the default section and switches between approved IA sections', () => {
    render(<LeftSidebar />);

    expect(screen.getByTestId('left-sidebar-title').textContent).toBe('Project');
    expect(screen.getAllByText('2')).toHaveLength(2);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByText('undefined')).toBeNull();
    expect(screen.getByTestId('project-section')).toBeTruthy();
    expect(screen.queryByTestId('assets-section')).toBeNull();
    expect(screen.queryByTestId('working-palette-section')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Working Palette/i }));
    expect(screen.getByTestId('left-sidebar-title').textContent).toBe('Working Palette');
    expect(screen.getByTestId('working-palette-section')).toBeTruthy();
    expect(screen.queryByTestId('assets-section')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Assets/i }));
    expect(screen.getByTestId('left-sidebar-title').textContent).toBe('Assets');
    expect(screen.getByTestId('assets-section')).toBeTruthy();
    expect(screen.queryByTestId('working-palette-section')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Plugins/i }));
    expect(screen.getByTestId('left-sidebar-title').textContent).toBe('Plugins');
    expect(screen.getByTestId('plugins-section')).toBeTruthy();
  });
});

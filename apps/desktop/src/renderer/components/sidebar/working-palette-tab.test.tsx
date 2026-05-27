// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const useAssetPacksMock = vi.hoisted(() => vi.fn());
const useMapMock = vi.hoisted(() => vi.fn());
const battleRoyalePluginId = ['@tileborne-plugins', 'battle-royale'].join('/');

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as Record<string, never>)}>{children}</a>
  ),
}));

vi.mock('@/hooks/queries', () => ({
  useAssetPacks: useAssetPacksMock,
  useMap: useMapMock,
  usePluginContributions: () => ({
    data: {
      panels: [],
      tools: [
        {
          pluginId: battleRoyalePluginId,
          pluginName: 'Battle Royale',
          id: 'battle-royale-spawn-tools',
          zone: 'working-palette',
          title: 'Battle Royale Spawn Tools',
          description: 'Curated spawn and loot placement tools.',
          capabilities: ['spawn', 'paint'],
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/lib/pack-capability-client', () => ({
  pickPaintablePackId: (
    packs: readonly { id: string }[],
    capabilities: ReadonlyMap<string, { paintable: boolean }>,
    preferred: string | undefined,
  ) => {
    if (preferred && capabilities.get(preferred)?.paintable) return preferred;
    return packs.find((pack) => capabilities.get(pack.id)?.paintable === true)?.id;
  },
  usePackCapabilities: () => ({
    byId: new Map([
      [
        'pack-paintable-1',
        { paintable: true, tilesetCount: 1, tileCount: 29_000, placeableCount: 4 },
      ],
      [
        'pack-imported-map',
        { paintable: true, tilesetCount: 1, tileCount: 512, placeableCount: 0 },
      ],
      ['pack-asset-only', { paintable: false, tilesetCount: 0, tileCount: 0, placeableCount: 0 }],
    ]),
    isLoading: false,
  }),
}));

vi.mock('@/components/sidebar/working-palette-sidebar', () => ({
  WorkingPaletteSidebar: ({
    packId,
    libraryLink,
  }: {
    readonly packId: string;
    readonly libraryLink?: React.ReactNode;
  }) => (
    <div data-testid={`working-palette-sidebar-stub-${packId}`}>
      palette:{packId}
      {libraryLink}
    </div>
  ),
}));

vi.mock('@/stores/editor-ui-store', () => {
  const state = {
    activePalettePackId: 'pack-paintable-1' as string | null,
  };
  type State = typeof state;
  const useEditorUiStore = (selector: (value: State) => unknown) => selector(state);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, { getState: () => state }),
  };
});

import { WorkingPaletteTab } from '@/components/sidebar/working-palette-tab';

describe('WorkingPaletteTab', () => {
  afterEach(() => {
    cleanup();
    useAssetPacksMock.mockReset();
    useMapMock.mockReset();
  });

  it('renders the active working palette for a paintable pack', () => {
    useMapMock.mockReturnValue({ data: undefined });
    useAssetPacksMock.mockReturnValue({
      data: {
        packs: [
          { id: 'pack-paintable-1', name: 'Paintable Pack', assetCount: 29_000 },
          { id: 'pack-asset-only', name: 'Asset Only', assetCount: 2 },
        ],
      },
      isLoading: false,
    });

    render(<WorkingPaletteTab projectId="project-1" />);

    expect(screen.getByText('Build palette')).toBeTruthy();
    expect(screen.getByText('Battle Royale Spawn Tools')).toBeTruthy();
    expect(screen.getByTestId('working-palette-sidebar-stub-pack-paintable-1')).toBeTruthy();
    expect(screen.getByText('Open asset library')).toBeTruthy();
  });

  it('prefers the opened map tileset pack for imported map painting', () => {
    useMapMock.mockReturnValue({
      data: { map: { properties: { tilesetPackId: 'pack-imported-map' } } },
    });
    useAssetPacksMock.mockReturnValue({
      data: {
        packs: [
          { id: 'pack-paintable-1', name: 'Paintable Pack', assetCount: 29_000 },
          { id: 'pack-imported-map', name: 'Imported Tiled source', assetCount: 512 },
        ],
      },
      isLoading: false,
    });

    render(<WorkingPaletteTab projectId="project-1" mapId="map-1" />);

    expect(screen.getByTestId('working-palette-sidebar-stub-pack-imported-map')).toBeTruthy();
  });

  it('does not render installed pack rows or thousands of tile cards in the section shell', () => {
    useMapMock.mockReturnValue({ data: undefined });
    useAssetPacksMock.mockReturnValue({
      data: {
        packs: [{ id: 'pack-paintable-1', name: 'Huge Pack', assetCount: 29_000 }],
      },
      isLoading: false,
    });

    render(<WorkingPaletteTab projectId="project-1" />);

    expect(screen.queryAllByTestId(/^sidebar-pack-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^tile-card-/)).toHaveLength(0);
  });

  it('guides users to Assets when no packs are installed', () => {
    useMapMock.mockReturnValue({ data: undefined });
    useAssetPacksMock.mockReturnValue({
      data: { packs: [] },
      isLoading: false,
    });

    render(<WorkingPaletteTab projectId="project-1" />);

    expect(screen.getByText('No asset packs')).toBeTruthy();
    expect(screen.getByText(/Open Assets to import a pack/i)).toBeTruthy();
  });
});

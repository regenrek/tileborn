// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useParamsMock = vi.hoisted(() => vi.fn());
const setActivePalettePackIdMock = vi.hoisted(() => vi.fn());
const setMapTilesetPackMutateMock = vi.hoisted(() => vi.fn());
const setAssetImportDialogOpenMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as Record<string, never>)}>{children}</a>
  ),
  useParams: useParamsMock,
}));

vi.mock('@/hooks/queries', () => ({
  useAssetPacks: () => ({
    data: {
      packs: [
        { id: 'pack-paintable-1', name: 'Paintable Pack 1', assetCount: 4 },
        { id: 'pack-paintable-2', name: 'Paintable Pack 2', assetCount: 6 },
        { id: 'pack-asset-only', name: 'Asset Only Pack', assetCount: 2 },
      ],
    },
    isLoading: false,
  }),
  usePluginContributions: () => ({
    data: { panels: [], tools: [] },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/mutations', () => ({
  useSetMapTilesetPack: () => ({
    mutate: setMapTilesetPackMutateMock,
    isPending: false,
  }),
  useScanTiledMap: () => ({
    mutate: vi.fn(),
    isPending: false,
    data: undefined,
  }),
  useImportTiledMap: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/lib/pack-capability-client', () => ({
  pickPaintablePackId: (
    packs: readonly { id: string }[],
    capabilities: ReadonlyMap<string, { paintable: boolean }>,
    preferred: string | undefined,
  ) => {
    if (preferred && capabilities.get(preferred)?.paintable) return preferred;
    return packs.find((p) => capabilities.get(p.id)?.paintable === true)?.id;
  },
  usePackCapabilities: () => ({
    byId: new Map([
      ['pack-paintable-1', { paintable: true, tilesetCount: 1, tileCount: 16, placeableCount: 67 }],
      ['pack-paintable-2', { paintable: true, tilesetCount: 1, tileCount: 8, placeableCount: 0 }],
      ['pack-asset-only', { paintable: false, tilesetCount: 0, tileCount: 0, placeableCount: 11 }],
    ]),
    isLoading: false,
  }),
}));

vi.mock('@/stores/editor-ui-store', () => {
  const state = {
    activePalettePackId: 'pack-paintable-1' as string | null,
    setActivePalettePackId: setActivePalettePackIdMock,
    setAssetImportDialogOpen: setAssetImportDialogOpenMock,
  };
  type State = typeof state;
  const useEditorUiStore = (selector: (value: State) => unknown) => selector(state);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, { getState: () => state }),
  };
});

import { AssetsTab } from '@/components/sidebar/assets-tab';

describe('AssetsTab pack click wiring', () => {
  beforeEach(() => {
    setActivePalettePackIdMock.mockReset();
    setMapTilesetPackMutateMock.mockReset();
    setAssetImportDialogOpenMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it('fires setMapTilesetPack mutation when a paintable pack is clicked with an open map', () => {
    useParamsMock.mockReturnValue({
      projectId: 'project-1',
      mapId: 'map-1',
    });
    render(<AssetsTab projectId="project-1" />);
    fireEvent.click(screen.getByTestId('sidebar-pack-pack-paintable-2'));
    expect(setActivePalettePackIdMock).toHaveBeenCalledWith('pack-paintable-2');
    expect(setMapTilesetPackMutateMock).toHaveBeenCalledTimes(1);
    expect(setMapTilesetPackMutateMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      mapId: 'map-1',
      packId: 'pack-paintable-2',
    });
  });

  it('only updates the editor store when no map is open', () => {
    useParamsMock.mockReturnValue({ projectId: 'project-1' });
    render(<AssetsTab projectId="project-1" />);
    fireEvent.click(screen.getByTestId('sidebar-pack-pack-paintable-2'));
    expect(setActivePalettePackIdMock).toHaveBeenCalledWith('pack-paintable-2');
    expect(setMapTilesetPackMutateMock).not.toHaveBeenCalled();
  });

  it('allows object-only packs to be selected without setting the map tileset pack', () => {
    useParamsMock.mockReturnValue({
      projectId: 'project-1',
      mapId: 'map-1',
    });
    render(<AssetsTab projectId="project-1" />);
    const button = screen.getByTestId('sidebar-pack-pack-asset-only');
    expect(button).toHaveProperty('disabled', false);
    expect(screen.getByText('2 assets · 11 objects · no tilesets')).toBeTruthy();
    fireEvent.click(button);
    expect(setActivePalettePackIdMock).toHaveBeenCalledWith('pack-asset-only');
    expect(setMapTilesetPackMutateMock).not.toHaveBeenCalled();
  });

  it('keeps the working palette out of Assets while showing installed packs', () => {
    useParamsMock.mockReturnValue({
      projectId: 'project-1',
      mapId: 'map-1',
    });
    render(<AssetsTab projectId="project-1" />);
    const firstPackButton = screen.getByTestId('sidebar-pack-pack-paintable-1');
    expect(firstPackButton).toBeTruthy();
    expect(screen.queryByTestId('sidebar-tileset-palette-region')).toBeNull();
    expect(screen.queryByTestId('working-palette-sidebar')).toBeNull();
  });

  it('has exactly one primary Import action that opens the wizard', () => {
    useParamsMock.mockReturnValue({
      projectId: 'project-1',
      mapId: 'map-1',
    });
    render(<AssetsTab projectId="project-1" />);
    const importActions = screen.getAllByRole('button', { name: 'Import' });
    expect(importActions).toHaveLength(1);
    fireEvent.click(screen.getByTestId('sidebar-import'));
    expect(setAssetImportDialogOpenMock).toHaveBeenCalledWith(true);
    expect(screen.queryByText('Import Tiled source')).toBeNull();
    expect(screen.queryByText('Import asset pack')).toBeNull();
    expect(screen.getByText('Open asset library')).toBeTruthy();
    expect(screen.getByText('Installed packs')).toBeTruthy();
  });

  it('shows paintable tile and object counts without the false no-tiles message', () => {
    useParamsMock.mockReturnValue({
      projectId: 'project-1',
      mapId: 'map-1',
    });
    render(<AssetsTab projectId="project-1" />);

    expect(screen.getByText('1 tilesets · 16 tiles · 67 objects')).toBeTruthy();
    expect(
      screen.queryByText(/None of the installed packs contain paintable tilesets/i),
    ).toBeNull();
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useParamsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const useAssetPackMock = vi.hoisted(() => vi.fn());
const useAssetPackUseSitesMock = vi.hoisted(() => vi.fn());
const removePackMutateAsyncMock = vi.hoisted(() => vi.fn());
const useRemoveAssetPackMock = vi.hoisted(() => vi.fn());
const setMapTilesetPackMutateMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());
const setActivePalettePackIdMock = vi.hoisted(() => vi.fn());
const assetPackBrowserDialogMock = vi.hoisted(() =>
  vi.fn(
    (props: {
      readonly open: boolean;
      readonly packId: string;
      readonly initialSearch?: string | undefined;
    }) => (
      <div
        data-testid="asset-pack-browser-dialog-stub"
        data-open={props.open ? 'true' : 'false'}
        data-pack-id={props.packId}
        data-initial-search={props.initialSearch}
      />
    ),
  ),
);
const editorUiState = vi.hoisted(() => ({
  activePalettePackId: null as string | null,
  setActivePalettePackId: setActivePalettePackIdMock,
  setSelection: vi.fn(),
  selectTool: vi.fn(),
  setCatalogTargetObjectTypeId: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: useParamsMock,
  useNavigate: () => navigateMock,
}));

vi.mock('@/hooks/queries', () => ({
  useAssetPack: useAssetPackMock,
  useAssetPackUseSites: useAssetPackUseSitesMock,
  useAssetDataUrl: () => ({ data: undefined, isLoading: false }),
  useTilesetPack: () => ({ data: undefined, isLoading: false }),
  useAssetPackLibraryPages: () => ({ data: undefined, isLoading: false, isError: false }),
  useAssetLibraryCacheStatus: () => ({
    data: { status: 'cold', supported: false },
    isLoading: false,
  }),
  usePrefetchAssetLibraryPage: () => vi.fn(),
  ASSET_LIBRARY_PAGE_SIZE: 64,
}));

vi.mock('@/hooks/mutations', () => ({
  useRemoveAssetPack: useRemoveAssetPackMock,
  useReloadAssetLibraryCache: () => ({ mutate: vi.fn(), isPending: false }),
  useSetMapTilesetPack: () => ({
    mutate: setMapTilesetPackMutateMock,
    isPending: false,
  }),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: notifySuccessMock,
}));

vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: typeof editorUiState) => unknown) => selector(editorUiState),
}));

vi.mock('@/components/asset-library/asset-pack-browser-dialog', () => ({
  AssetPackBrowserDialog: assetPackBrowserDialogMock,
}));

vi.mock('./use-pack-tile-stats', () => ({
  usePackTileStats: () => ({ tileCount: 12, tileSize: '16x16', loading: false }),
}));

import { AssetPackDetailsPane } from './asset-pack-details-pane';

const pack = {
  id: 'pack:550e8400-e29b-41d4-a716-446655440001',
  name: 'Tiny Dungeon',
  version: '1.0.0',
  licenseSpdxId: 'CC0-1.0',
  integrityHash: 'sha256:test',
  assetCount: 4,
  capability: {
    packId: 'pack:550e8400-e29b-41d4-a716-446655440001',
    paintable: true,
  },
};

describe('AssetPackDetailsPane remove action', () => {
  beforeEach(() => {
    useParamsMock.mockReturnValue({});
    useAssetPackMock.mockReturnValue({ data: { pack }, isLoading: false });
    useAssetPackUseSitesMock.mockReturnValue({
      data: { useSites: [], total: 0, truncated: false },
      isLoading: false,
    });
    removePackMutateAsyncMock.mockReset();
    removePackMutateAsyncMock.mockResolvedValue({});
    useRemoveAssetPackMock.mockReset();
    useRemoveAssetPackMock.mockReturnValue({
      mutateAsync: removePackMutateAsyncMock,
      isPending: false,
    });
    setMapTilesetPackMutateMock.mockReset();
    notifySuccessMock.mockReset();
    setActivePalettePackIdMock.mockReset();
    navigateMock.mockReset();
    editorUiState.setSelection.mockReset();
    editorUiState.selectTool.mockReset();
    editorUiState.setCatalogTargetObjectTypeId.mockReset();
    editorUiState.activePalettePackId = null;
    assetPackBrowserDialogMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('confirms before removing the selected asset pack', async () => {
    render(<AssetPackDetailsPane packId={pack.id} />);

    fireEvent.click(screen.getByTestId('asset-pack-remove'));
    expect(screen.getByTestId('asset-pack-remove-dialog')).toBeTruthy();

    fireEvent.click(screen.getByTestId('asset-pack-confirm-remove'));

    await waitFor(() => {
      expect(removePackMutateAsyncMock).toHaveBeenCalledWith(pack.id);
    });
  });

  it('disables the remove button while removal is pending', () => {
    useRemoveAssetPackMock.mockReturnValue({
      mutateAsync: removePackMutateAsyncMock,
      isPending: true,
    });

    render(<AssetPackDetailsPane packId={pack.id} />);

    expect(screen.getByTestId('asset-pack-remove')).toHaveProperty('disabled', true);
  });

  it('marks the license row as focused for asset-library license diagnostics', () => {
    render(<AssetPackDetailsPane packId={pack.id} focusPath={`assetPacks.${pack.id}.license`} />);

    expect(screen.getByTestId('asset-pack-license-row').getAttribute('data-focused')).toBe('true');
  });

  it('opens and filters the browser for per-asset license diagnostics', async () => {
    const assetId = 'asset:550e8400-e29b-41d4-a716-446655440002';
    render(
      <AssetPackDetailsPane
        packId={pack.id}
        focusPath={`assetPacks.${pack.id}.assets.${assetId}.license`}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('asset-pack-browser-dialog-stub').getAttribute('data-open')).toBe(
        'true',
      );
    });
    expect(
      screen.getByTestId('asset-pack-focused-asset-license').getAttribute('data-asset-id'),
    ).toBe(assetId);
    expect(
      screen.getByTestId('asset-pack-browser-dialog-stub').getAttribute('data-initial-search'),
    ).toBe(assetId);
  });

  it('shows exact canonical consumers and navigates to the owning entity', () => {
    useParamsMock.mockReturnValue({ projectId: 'project:test' });
    useAssetPackUseSitesMock.mockReturnValue({
      data: {
        useSites: [
          {
            id: 'entity:crate',
            kind: 'entity',
            label: 'Loot crate',
            detail: 'Entity visual uses placeable:crate',
            navigation: {
              kind: 'catalog',
              projectId: 'project:test',
              objectTypeId: 'object-type:crate',
            },
          },
        ],
        total: 1,
        truncated: false,
      },
      isLoading: false,
    });

    render(<AssetPackDetailsPane packId={pack.id} />);

    const useSites = screen.getByTestId('asset-pack-use-sites');
    expect(useSites.textContent).toContain('Dependencies & use sites');
    expect(useSites.textContent).toContain('Loot crate');
    expect(useSites.textContent).toContain('Entity visual uses placeable:crate');

    fireEvent.click(screen.getByTestId('asset-pack-use-site-entity'));
    expect(editorUiState.setCatalogTargetObjectTypeId).toHaveBeenCalledWith('object-type:crate');
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/projects/$projectId/entities',
      params: { projectId: 'project:test' },
    });
  });

  it.each([
    ['player-model', 'playerModels.max.ref'],
    ['animation', 'playerModels.max.clips.run'],
  ] as const)('deep-links a %s use site to its exact model and clip path', (kind, path) => {
    useParamsMock.mockReturnValue({ projectId: 'project:test' });
    useAssetPackUseSitesMock.mockReturnValue({
      data: {
        useSites: [
          {
            id: `${kind}:max`,
            kind,
            label: kind === 'animation' ? 'Maltipoo Max · run' : 'Maltipoo Max',
            detail: path,
            navigation: {
              kind: 'player-model',
              projectId: 'project:test',
              modelId: 'max',
              path,
            },
          },
        ],
        total: 1,
        truncated: false,
      },
      isLoading: false,
    });

    render(<AssetPackDetailsPane packId={pack.id} />);
    fireEvent.click(screen.getByTestId(`asset-pack-use-site-${kind}`));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/projects/$projectId/player-models',
      params: { projectId: 'project:test' },
      search: { modelId: 'max', path },
    });
  });
});

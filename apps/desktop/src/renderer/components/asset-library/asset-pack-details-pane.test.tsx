// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useParamsMock = vi.hoisted(() => vi.fn());
const useAssetPackMock = vi.hoisted(() => vi.fn());
const removePackMutateAsyncMock = vi.hoisted(() => vi.fn());
const useRemoveAssetPackMock = vi.hoisted(() => vi.fn());
const setMapTilesetPackMutateMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());
const setActivePalettePackIdMock = vi.hoisted(() => vi.fn());
const editorUiState = vi.hoisted(() => ({
  activePalettePackId: null as string | null,
  setActivePalettePackId: setActivePalettePackIdMock,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: useParamsMock,
}));

vi.mock('@/hooks/queries', () => ({
  useAssetPack: useAssetPackMock,
  useAssetDataUrl: () => ({ data: undefined, isLoading: false }),
  useAssetThumbnailDataUrl: () => ({ data: undefined, isLoading: false }),
  useTilesetPack: () => ({ data: undefined, isLoading: false }),
  useAssetPackLibraryPages: () => ({ data: undefined, isLoading: false, isError: false }),
  useAssetLibraryCacheStatus: () => ({
    data: { status: 'cold', supported: false },
    isLoading: false,
  }),
  usePrefetchAssetLibraryPage: () => vi.fn(),
  usePrefetchAssetThumbnail: () => vi.fn(),
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
    editorUiState.activePalettePackId = null;
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
});

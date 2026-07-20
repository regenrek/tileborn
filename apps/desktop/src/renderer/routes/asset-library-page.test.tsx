// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useParamsMock = vi.hoisted(() => vi.fn());
const useSearchMock = vi.hoisted(() => vi.fn());
const useAssetPacksMock = vi.hoisted(() => vi.fn());
const assetPackDetailsPaneMock = vi.hoisted(() =>
  vi.fn((props: { readonly packId: string; readonly focusPath?: string | undefined }) => (
    <div data-testid="asset-pack-details-pane-stub" data-pack-id={props.packId}>
      {props.focusPath}
    </div>
  )),
);

vi.mock('@tanstack/react-router', () => ({
  useParams: useParamsMock,
  useSearch: useSearchMock,
}));

vi.mock('@/hooks/queries', () => ({
  useAssetPacks: useAssetPacksMock,
}));

vi.mock('@/hooks/use-focus-search-shortcut', () => ({
  useFocusSearchShortcut: vi.fn(),
}));

vi.mock('@/components/shell/closeable-workspace-page', () => ({
  CloseableWorkspacePage: ({ children }: { readonly children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

vi.mock('@/components/asset-library/asset-pack-preview-thumb', () => ({
  AssetPackPreviewThumb: ({ packId }: { readonly packId: string }) => (
    <div data-testid={`asset-pack-preview-${packId}`} />
  ),
}));

vi.mock('@/components/asset-library/asset-pack-details-pane', () => ({
  AssetPackDetailsPane: assetPackDetailsPaneMock,
}));

vi.mock('@/components/asset-library/drop-path', () => ({
  readDroppedImportPath: vi.fn(),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifyError: vi.fn(),
}));

vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      activePalettePackId: null,
      setAssetImportDialogOpen: vi.fn(),
      setAssetImportSourcePath: vi.fn(),
      setSpriteEditorOpen: vi.fn(),
    }),
}));

import { AssetLibraryPage } from './asset-library-page';

describe('AssetLibraryPage diagnostic focus', () => {
  beforeEach(() => {
    useParamsMock.mockReturnValue({ projectId: 'project:one' });
    useSearchMock.mockReturnValue({
      packId: 'pack:target',
      focus: 'assetPacks.pack:target.license',
    });
    useAssetPacksMock.mockReturnValue({
      isLoading: false,
      data: {
        packs: [
          {
            id: 'pack:first',
            name: 'First Pack',
            version: '1.0.0',
            assetCount: 1,
            licenseSpdxId: 'MIT',
          },
          {
            id: 'pack:target',
            name: 'Target Pack',
            version: '1.0.0',
            assetCount: 1,
            licenseSpdxId: 'CC0-1.0',
          },
        ],
      },
    });
    assetPackDetailsPaneMock.mockClear();
  });

  afterEach(cleanup);

  it('selects and focuses the pack named by the asset-library search target', () => {
    render(<AssetLibraryPage />);

    expect(screen.getByTestId('asset-pack-card-pack:target').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(assetPackDetailsPaneMock).toHaveBeenCalledWith(
      {
        packId: 'pack:target',
        focusPath: 'assetPacks.pack:target.license',
      },
      undefined,
    );
  });
});

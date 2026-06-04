// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  AssetLibraryGroup,
  AssetLibraryReference,
  makePackId,
  makeProjectId,
  makeTileId,
  makeWorkingPaletteId,
  makeWorkingPaletteItemId,
  type WorkingPalette,
  type WorkingPaletteId,
} from '@tileborne/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useTilesetPackMock = vi.hoisted(() => vi.fn());
const useAssetPackMock = vi.hoisted(() => vi.fn());
const useAssetPackLibraryPagesMock = vi.hoisted(() => vi.fn());
const useAssetLibraryCacheStatusMock = vi.hoisted(() => vi.fn());
const prefetchAssetLibraryPageMock = vi.hoisted(() => vi.fn());
const reloadCacheMutateMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/queries', () => ({
  ASSET_LIBRARY_PAGE_SIZE: 64,
  useAssetPack: useAssetPackMock,
  useTilesetPack: useTilesetPackMock,
  useAssetPackLibraryPages: useAssetPackLibraryPagesMock,
  useAssetLibraryCacheStatus: useAssetLibraryCacheStatusMock,
  usePrefetchAssetLibraryPage: () => prefetchAssetLibraryPageMock,
}));

vi.mock('@/hooks/mutations', () => ({
  useReloadAssetLibraryCache: () => ({
    mutate: reloadCacheMutateMock,
    isPending: false,
  }),
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: vi.fn(),
}));

let editorState: { brushIntent: { kind: string }; selectBrush: (...args: unknown[]) => void };
vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: typeof editorState) => unknown) => selector(editorState),
}));

import { parseTilesetPackJson } from '@/lib/tileset-pack';
import { AssetPackBrowser } from '@/components/asset-library/asset-pack-browser';
import { useWorkingPalettesStore } from '@/stores/working-palettes-store';
import type { WorkingPaletteItemDraft } from '@/lib/working-palettes-bridge';

const projectId = makeProjectId('550e8400-e29b-41d4-a716-446655440101');
const packId = makePackId('550e8400-e29b-41d4-a716-446655440000');
const tileId = makeTileId('550e8400-e29b-41d4-a716-446655440003');
const secondTileId = makeTileId('550e8400-e29b-41d4-a716-446655440004');
const paletteId = makeWorkingPaletteId('550e8400-e29b-41d4-a716-446655440301');
const alternatePaletteId = makeWorkingPaletteId('550e8400-e29b-41d4-a716-446655440302');

const tileRef = new AssetLibraryReference({
  packId,
  kind: 'tile',
  refId: tileId,
  tileId,
});

const secondTileRef = new AssetLibraryReference({
  packId,
  kind: 'tile',
  refId: secondTileId,
  tileId: secondTileId,
});

const terrainRef = new AssetLibraryReference({
  packId,
  kind: 'terrain',
  refId: 'tiled-source:grass terrain',
});

const autotileRef = new AssetLibraryReference({
  packId,
  kind: 'autotile',
  refId: 'autotile:grass-edge',
});

const placeableRef = new AssetLibraryReference({
  packId,
  kind: 'placeable',
  refId: 'placeable:550e8400-e29b-41d4-a716-446655440005',
  tileId,
});

const secondPlaceableRef = new AssetLibraryReference({
  packId,
  kind: 'placeable',
  refId: 'placeable:550e8400-e29b-41d4-a716-446655440006',
  tileId: secondTileId,
});

const tilesetGroup = new AssetLibraryGroup({
  id: 'tileset:tileset:550e8400-e29b-41d4-a716-446655440002',
  packId,
  kind: 'tileset',
  label: 'Sample Walls',
  count: 2,
  metadata: { tilesetId: 'tileset:550e8400-e29b-41d4-a716-446655440002' },
  searchText: 'sample walls',
  previewRefs: [tileRef],
});

const terrainGroup = new AssetLibraryGroup({
  id: 'terrain:tiled-source:grass terrain',
  packId,
  kind: 'terrain',
  label: 'Grass Terrain',
  count: 2,
  metadata: { terrainClass: 'tiled-source:grass terrain' },
  searchText: 'grass terrain',
  primaryRef: terrainRef,
  previewRefs: [tileRef],
});

const autotileGroup = new AssetLibraryGroup({
  id: 'autotile:grass-edge',
  packId,
  kind: 'autotile',
  label: 'Grass Edge',
  count: 2,
  metadata: { ruleId: 'autotile:grass-edge' },
  searchText: 'grass edge',
  primaryRef: autotileRef,
  previewRefs: [tileRef, secondTileRef],
});

const sourceGroup = new AssetLibraryGroup({
  id: 'source:Objects',
  packId,
  kind: 'source',
  label: 'Objects',
  count: 2,
  metadata: { source: 'Objects' },
  searchText: 'objects',
  previewRefs: [placeableRef, secondPlaceableRef],
});

let palettes: WorkingPalette[];
let activePaletteId: WorkingPaletteId | undefined;

const installWorkingPaletteBridge = () => {
  const workingPalettes = {
    list: vi.fn(async () => ({ palettes, activePaletteId })),
    create: vi.fn(async (input: { name: string; items?: readonly WorkingPaletteItemDraft[] }) => {
      const palette: WorkingPalette = {
        id: paletteId,
        projectId,
        name: input.name,
        items: (input.items ?? []).map((item, index) => ({
          id: makeWorkingPaletteItemId(`550e8400-e29b-41d4-a716-44665544040${index + 1}`),
          ref: item.ref,
          label: item.label ?? item.ref.refId,
        })),
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
      };
      palettes = [palette];
      activePaletteId = palette.id;
      return { palette };
    }),
    setActive: vi.fn(async (input: { paletteId: WorkingPaletteId }) => {
      const palette = palettes.find((entry) => entry.id === input.paletteId);
      if (palette === undefined) {
        throw new Error(`missing palette ${input.paletteId}`);
      }
      activePaletteId = palette.id;
      return { palette };
    }),
    addItems: vi.fn(
      async (input: { paletteId: WorkingPaletteId; items: readonly WorkingPaletteItemDraft[] }) => {
        const existing = palettes.find((palette) => palette.id === input.paletteId)!;
        const next: WorkingPalette = {
          ...existing,
          items: [
            ...existing.items,
            ...input.items.map((item, index) => ({
              id: makeWorkingPaletteItemId(`550e8400-e29b-41d4-a716-44665544050${index + 1}`),
              ref: item.ref,
              label: item.label ?? item.ref.refId,
            })),
          ],
        };
        palettes = [next];
        return { palette: next };
      },
    ),
    update: vi.fn(),
    delete: vi.fn(),
    removeItem: vi.fn(
      async (input: { paletteId: WorkingPaletteId; itemId: WorkingPalette['items'][number]['id'] }) => {
        const existing = palettes.find((palette) => palette.id === input.paletteId)!;
        const next: WorkingPalette = {
          ...existing,
          items: existing.items.filter((item) => item.id !== input.itemId),
        };
        palettes = [next];
        return { palette: next };
      },
    ),
    reorderItems: vi.fn(),
    getActive: vi.fn(),
  };
  Object.defineProperty(window, 'tileborne', {
    configurable: true,
    value: { workingPalettes },
  });
  return workingPalettes;
};

const samplePackJson = {
  schemaVersion: 1 as const,
  id: 'pack:550e8400-e29b-41d4-a716-446655440000',
  name: 'Tiled source',
  version: '1.0.0',
  license: { spdxId: 'CC0-1.0' },
  assets: [
    {
      id: 'asset:550e8400-e29b-41d4-a716-446655440001',
      path: 'atlas.png',
      mime: 'image/png',
      size: 8,
      hash: 'sha256:fixture',
      license: { spdxId: 'CC0-1.0' },
    },
  ],
  terrainClasses: ['tiled-source:grass terrain'],
  tilesets: [
    {
      id: 'tileset:550e8400-e29b-41d4-a716-446655440002',
      name: 'tiled-source:source=foo/Sample Walls.tmx',
      atlasAssetId: 'asset:550e8400-e29b-41d4-a716-446655440001',
      cellSize: { width: 16, height: 16 },
      margin: 0,
      spacing: 0,
    },
  ],
  tiles: [
    {
      id: 'tile:550e8400-e29b-41d4-a716-446655440003',
      tilesetId: 'tileset:550e8400-e29b-41d4-a716-446655440002',
      uv: { x: 0, y: 0, w: 16, h: 16 },
      tags: ['walls'],
      terrainClass: 'tiled-source:grass terrain',
    },
    {
      id: 'tile:550e8400-e29b-41d4-a716-446655440004',
      tilesetId: 'tileset:550e8400-e29b-41d4-a716-446655440002',
      uv: { x: 16, y: 0, w: 16, h: 16 },
      tags: ['floor'],
      terrainClass: 'tiled-source:grass terrain',
    },
  ],
  autotileRules: [],
  variantFilters: [],
  animations: [],
  terrainTransitions: [],
  collisionMasks: [],
  placeables: [
    {
      id: 'placeable:550e8400-e29b-41d4-a716-446655440005',
      name: 'Pillar',
      size: { width: 16, height: 16 },
      frames: [
        {
          assetId: 'asset:550e8400-e29b-41d4-a716-446655440001',
          tileId: 'tile:550e8400-e29b-41d4-a716-446655440003',
          uv: { x: 0, y: 0, w: 16, h: 16 },
        },
      ],
      tags: ['structures'],
      source: {
        format: 'tiled',
        tilesetName: 'Objects',
        localTileId: 0,
        properties: {},
      },
    },
    {
      id: 'placeable:550e8400-e29b-41d4-a716-446655440006',
      name: 'Crate',
      size: { width: 16, height: 16 },
      frames: [
        {
          assetId: 'asset:550e8400-e29b-41d4-a716-446655440001',
          tileId: 'tile:550e8400-e29b-41d4-a716-446655440004',
          uv: { x: 16, y: 0, w: 16, h: 16 },
        },
      ],
      tags: ['structures'],
      source: {
        format: 'tiled',
        tilesetName: 'Objects',
        localTileId: 1,
        properties: {},
      },
    },
  ],
};

const imageCollectionOnlyPackJson = {
  ...samplePackJson,
  tiles: [],
  terrainClasses: [],
  tilesets: [
    {
      id: 'tileset:550e8400-e29b-41d4-a716-446655440002',
      name: 'Atlas-Props-Sprites',
      atlasAssetId: 'asset:550e8400-e29b-41d4-a716-446655440001',
      cellSize: { width: 736, height: 608 },
      margin: 0,
      spacing: 0,
    },
  ],
  placeables: samplePackJson.placeables.map((placeable) => ({
    ...placeable,
    source: {
      ...placeable.source,
      tilesetName: 'Atlas-Props-Sprites',
    },
  })),
};

describe('AssetPackBrowser', () => {
  let originalOffsetHeight: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    // jsdom reports offsetWidth/offsetHeight as 0 for every element, which makes
    // @tanstack/react-virtual measure the scroll viewport as 0px tall and render
    // zero rows (its range is null when the measured outer size is 0). Give every
    // element a stable non-zero box so the virtualizer computes a real window and
    // mounts the leading group cards the assertions below rely on.
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 600,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 320,
    });

    editorState = {
      brushIntent: { kind: 'eraser' },
      selectBrush: vi.fn(),
    };
    useAssetPackMock.mockReset();
    useAssetPackMock.mockReturnValue({
      data: {
        pack: {
          id: packId,
          name: 'Tiled source',
          version: '1.0.0',
          licenseSpdxId: 'CC0-1.0',
          integrityHash: 'sha256:test',
          assetCount: 1,
          capability: { packId, paintable: true },
        },
      },
      isLoading: false,
      isError: false,
    });
    useTilesetPackMock.mockReset();
    useAssetPackLibraryPagesMock.mockReset();
    useAssetPackLibraryPagesMock.mockImplementation(
      (_packId: string, options: { groupKind: string }) => ({
        data: {
          packId,
          total: 1,
          offset: 0,
          limit: 64,
          groups:
            options.groupKind === 'terrain'
              ? [terrainGroup]
              : options.groupKind === 'autotile'
                ? [autotileGroup]
                : options.groupKind === 'source'
                  ? [sourceGroup]
                  : [tilesetGroup],
        },
        isLoading: false,
        isError: false,
      }),
    );
    useAssetLibraryCacheStatusMock.mockReset();
    useAssetLibraryCacheStatusMock.mockReturnValue({
      data: {
        status: 'cached',
        supported: true,
        cacheVersion: 'library:v1',
        thumbnailCacheVersion: 'thumbs:v1',
      },
      isLoading: false,
    });
    prefetchAssetLibraryPageMock.mockReset();
    reloadCacheMutateMock.mockReset();
    palettes = [];
    activePaletteId = undefined;
    installWorkingPaletteBridge();
    useWorkingPalettesStore.getState().__resetForTests();
  });

  afterEach(() => {
    if (originalOffsetHeight !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    } else {
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
    if (originalOffsetWidth !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    } else {
      delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    }
    cleanup();
  });

  it('shows loading skeleton while pack data is being fetched', () => {
    useTilesetPackMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    useAssetPackLibraryPagesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const { container } = render(
      <AssetPackBrowser packId={packId} packName="Tiled source" projectId={projectId} />,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows an empty-state message when the pack has no tileset manifest', () => {
    useTilesetPackMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    useAssetPackLibraryPagesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<AssetPackBrowser packId={packId} packName="Asset-only pack" projectId={projectId} />);
    expect(screen.getByTestId('asset-pack-browser-empty')).toBeTruthy();
  });

  it('renders the tilesets / terrain / objects tabs with grouped browsing', () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);
    expect(screen.getByTestId('asset-pack-browser-tab-tileset')).toBeTruthy();
    expect(screen.getByTestId('asset-pack-browser-tab-terrain')).toBeTruthy();
    expect(screen.getByTestId('asset-pack-browser-tab-autotile')).toBeTruthy();
    expect(screen.getByTestId('asset-pack-browser-tab-placeable')).toBeTruthy();
    expect(screen.getAllByText('Sample Walls').length).toBeGreaterThan(0);
  });

  it('opens image-collection-only packs on Objects instead of an empty Tilesets tab', async () => {
    const pack = parseTilesetPackJson(imageCollectionOnlyPackJson);
    const imageSourceGroup = new AssetLibraryGroup({
      ...sourceGroup,
      id: 'source:Atlas-Props-Sprites',
      label: 'Atlas-Props-Sprites',
      metadata: { source: 'Atlas-Props-Sprites' },
      searchText: 'atlas props sprites',
    });
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    useAssetPackLibraryPagesMock.mockImplementation(
      (_packId: string, options: { groupKind: string }) => ({
        data: {
          packId,
          total: options.groupKind === 'source' ? 1 : 0,
          offset: 0,
          limit: 64,
          groups: options.groupKind === 'source' ? [imageSourceGroup] : [],
        },
        isLoading: false,
        isError: false,
      }),
    );

    render(<AssetPackBrowser packId={pack.id} packName="Atlas-Props-Sprites" projectId={projectId} />);

    expect(await screen.findByTestId('asset-pack-browser-group-source:Atlas-Props-Sprites')).toBeTruthy();
    expect(screen.getByTestId('asset-pack-browser-tab-placeable').textContent).toContain('1');
    expect(screen.getByTestId('asset-pack-browser-tab-tileset').textContent).not.toContain('1');

    fireEvent.click(screen.getByTestId('asset-pack-browser-tab-tileset'));
    expect(await screen.findByTestId('asset-pack-browser-empty-tileset')).toBeTruthy();
  });

  it('renders each visible group as a dense bounded thumbnail grid', async () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);

    const tilesetGroupNode = screen.getByTestId(
      'asset-pack-browser-group-tileset:tileset:550e8400-e29b-41d4-a716-446655440002',
    );
    expect(
      within(tilesetGroupNode).getAllByTestId(
        'asset-pack-browser-item-tileset:tileset:550e8400-e29b-41d4-a716-446655440002',
      ),
    ).toHaveLength(2);

    fireEvent.click(screen.getByTestId('asset-pack-browser-tab-terrain'));
    const terrainGroupNode = await screen.findByTestId(
      'asset-pack-browser-group-terrain:tiled-source:grass terrain',
    );
    expect(
      within(terrainGroupNode).getAllByTestId(
        'asset-pack-browser-item-terrain:tiled-source:grass terrain',
      ),
    ).toHaveLength(2);

    fireEvent.click(screen.getByTestId('asset-pack-browser-tab-placeable'));
    const sourceGroupNode = await screen.findByTestId('asset-pack-browser-group-source:Objects');
    expect(
      within(sourceGroupNode).getAllByTestId('asset-pack-browser-item-source:Objects'),
    ).toHaveLength(2);
  });

  it('keeps per-group thumbnail rendering capped behind Load more', () => {
    const manyPreviewRefs = Array.from(
      { length: 96 },
      (_, index) => {
        const generatedTileId = makeTileId(
          `550e8400-e29b-41d4-a716-${String(446655441000 + index).padStart(12, '0')}`,
        );
        return new AssetLibraryReference({
          packId,
          kind: 'tile',
          refId: generatedTileId,
          tileId: generatedTileId,
        });
      },
    );
    const largeGroup = new AssetLibraryGroup({
      id: 'tileset:large-preview-group',
      packId,
      kind: 'tileset',
      label: 'Large Preview Group',
      count: 96,
      metadata: {},
      searchText: 'large preview group',
      previewRefs: manyPreviewRefs,
    });
    useTilesetPackMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    useAssetPackLibraryPagesMock.mockReturnValue({
      data: {
        packId,
        total: 1,
        offset: 0,
        limit: 64,
        groups: [largeGroup],
      },
      isLoading: false,
      isError: false,
    });

    render(<AssetPackBrowser packId={packId} packName="Tiled source" projectId={projectId} />);

    const group = screen.getByTestId('asset-pack-browser-group-tileset:large-preview-group');
    expect(
      within(group).getAllByTestId('asset-pack-browser-item-tileset:large-preview-group'),
    ).toHaveLength(32);

    fireEvent.click(within(group).getByTestId('asset-pack-browser-load-more-group-tileset:large-preview-group'));
    expect(
      within(group).getAllByTestId('asset-pack-browser-item-tileset:large-preview-group'),
    ).toHaveLength(48);

    fireEvent.click(within(group).getByTestId('asset-pack-browser-load-more-group-tileset:large-preview-group'));
    expect(
      within(group).getAllByTestId('asset-pack-browser-item-tileset:large-preview-group'),
    ).toHaveLength(64);
    expect(
      within(group).queryByTestId('asset-pack-browser-load-more-group-tileset:large-preview-group'),
    ).toBeNull();
  });

  it('virtualizes large asset libraries instead of rendering every group card', () => {
    const pack = parseTilesetPackJson(samplePackJson);
    const largeGroups = Array.from(
      { length: 1_000 },
      (_, index) =>
        new AssetLibraryGroup({
          id: `tileset:large-${index}`,
          packId,
          kind: 'tileset',
          label: `Large Tileset ${index}`,
          count: 1,
          metadata: {},
          searchText: `large tileset ${index}`,
          previewRefs: [tileRef],
        }),
    );
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    useAssetPackLibraryPagesMock.mockReturnValue({
      data: {
        packId,
        total: largeGroups.length,
        offset: 0,
        limit: 64,
        groups: largeGroups,
      },
      isLoading: false,
      isError: false,
    });

    const { container } = render(
      <AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />,
    );

    // jsdom reports zero layout height, so @tanstack/react-virtual only mounts
    // the first overscan window. Only a small slice of the 1,000 group cards is
    // in the DOM, while the off-screen tail (e.g. the final group) is absent.
    const renderedCards = container.querySelectorAll(
      '[data-testid^="asset-pack-browser-group-"]',
    );
    expect(renderedCards.length).toBeGreaterThan(0);
    expect(renderedCards.length).toBeLessThan(40);
    expect(screen.queryByText('Large Tileset 999')).toBeNull();
    // The leading group still renders so painting/selection stays interactive.
    expect(screen.getByText('Large Tileset 0')).toBeTruthy();

    // The virtualizer reserves the full scroll height for all 1,000 rows even
    // though only the window is mounted — this is the spacer that drives the
    // scrollbar. Asserting it ties the test to the useVirtualizer wiring rather
    // than to a hand-rolled window so the test cannot pass vacuously.
    const spacer = screen.getByTestId('asset-pack-browser-virtual-spacer');
    expect(spacer.style.height).toBe(`${largeGroups.length * 306}px`);
  });

  it('renders cache status controls and calls the reload mutation', () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });

    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);

    expect(screen.getByTestId('asset-library-cache-status').textContent).toBe('Cached');
    fireEvent.click(screen.getByTestId('asset-library-reload-cache'));
    expect(reloadCacheMutateMock).toHaveBeenCalledWith({
      packId: pack.id,
      integrityHash: 'sha256:test',
    });
  });

  it('does not render thumbnail images for preview cells before they enter the viewport', () => {
    const originalIntersectionObserver = window.IntersectionObserver;
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly scrollMargin = '0px';
      readonly thresholds = [];
      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = vi.fn(() => []);
      unobserve = vi.fn();
    }
    window.IntersectionObserver = MockIntersectionObserver;
    const pack = parseTilesetPackJson(samplePackJson);
    const largeGroups = Array.from(
      { length: 500 },
      (_, index) =>
        new AssetLibraryGroup({
          id: `tileset:thumb-${index}`,
          packId,
          kind: 'tileset',
          label: `Thumb Tileset ${index}`,
          count: 1,
          metadata: {},
          searchText: `thumb tileset ${index}`,
          previewRefs: [tileRef],
        }),
    );
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    useAssetPackLibraryPagesMock.mockReturnValue({
      data: {
        packId,
        total: largeGroups.length,
        offset: 0,
        limit: 64,
        groups: largeGroups,
      },
      isLoading: false,
      isError: false,
    });

    try {
      render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);

      // With an IntersectionObserver that never reports intersection, the
      // canonical thumbnail `<img>` is never mounted (no protocol request),
      // even though the bounded grid of preview cells is rendered.
      expect(screen.queryAllByTestId('asset-pack-browser-item-thumb')).toHaveLength(0);
      expect(screen.getAllByTestId('asset-pack-browser-item-tileset:thumb-0').length).toBeGreaterThan(0);
    } finally {
      window.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('opens the palette switcher and selects the active working palette', async () => {
    const pack = parseTilesetPackJson(samplePackJson);
    const first: WorkingPalette = {
      id: paletteId,
      projectId,
      name: 'Palette A',
      items: [],
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    };
    const second: WorkingPalette = {
      id: alternatePaletteId,
      projectId,
      name: 'Palette B',
      items: [],
      createdAt: '2026-05-25T00:00:01.000Z',
      updatedAt: '2026-05-25T00:00:01.000Z',
    };
    palettes = [first, second];
    activePaletteId = first.id;
    useWorkingPalettesStore.setState({
      palettes,
      activePaletteId,
      loadedProjectId: projectId,
      isLoading: false,
      error: undefined,
    });
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });

    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);

    fireEvent.click(screen.getByTestId('palette-switcher'));

    expect(await screen.findByText('Working palettes')).toBeTruthy();
    fireEvent.click(await screen.findByTestId(`palette-switcher-item-${second.id}`));

    await waitFor(() => {
      expect(window.tileborne.workingPalettes.setActive).toHaveBeenCalledWith({
        projectId,
        paletteId: second.id,
      });
    });
    expect(screen.queryByText('Something went wrong!')).toBeNull();
  });

  it('adds a backend terrain group to a working palette, creating the palette on demand', async () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);
    fireEvent.click(screen.getByTestId('asset-pack-browser-tab-terrain'));
    fireEvent.click(
      (await screen.findAllByTestId('asset-pack-browser-item-terrain:tiled-source:grass terrain'))[0]!,
    );
    await waitFor(() => {
      const nextPalettes = useWorkingPalettesStore.getState().list({ projectId });
      expect(nextPalettes).toHaveLength(1);
      expect(nextPalettes[0]?.items[0]?.ref.kind).toBe('terrain');
    });
  });

  it('adds a single preview cell to a working palette', async () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);

    fireEvent.click(
      screen.getAllByTestId(
        'asset-pack-browser-item-tileset:tileset:550e8400-e29b-41d4-a716-446655440002',
      )[0]!,
    );

    await waitFor(() => {
      const palette = useWorkingPalettesStore.getState().list({ projectId })[0];
      expect(palette?.items).toHaveLength(1);
      expect(palette?.items[0]?.ref.kind).toBe('tile');
    });
  });

  it('removes an added preview cell from the active working palette when clicked again', async () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);

    const cell = screen.getAllByTestId(
      'asset-pack-browser-item-tileset:tileset:550e8400-e29b-41d4-a716-446655440002',
    )[0]!;
    fireEvent.click(cell);

    await waitFor(() => {
      expect(useWorkingPalettesStore.getState().list({ projectId })[0]?.items).toHaveLength(1);
      expect(cell.getAttribute('data-added')).toBe('true');
    });

    fireEvent.click(cell);

    await waitFor(() => {
      expect(useWorkingPalettesStore.getState().list({ projectId })[0]?.items).toHaveLength(0);
      expect(cell.getAttribute('data-added')).toBe('false');
    });
  });

  it('adds visible preview refs for a tileset via "Add group"', async () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);
    const group = screen.getByTestId(
      'asset-pack-browser-group-tileset:tileset:550e8400-e29b-41d4-a716-446655440002',
    );
    fireEvent.click(within(group).getByTestId(/asset-pack-browser-add-group-/));
    await waitFor(() => {
      const palette = useWorkingPalettesStore.getState().list({ projectId })[0];
      expect(palette?.items).toHaveLength(2);
      expect(palette?.items[0]?.ref.kind).toBe('tile');
    });
  });

  it('removes a fully added group from the active working palette', async () => {
    const pack = parseTilesetPackJson(samplePackJson);
    useTilesetPackMock.mockReturnValue({ data: pack, isLoading: false, isError: false });
    render(<AssetPackBrowser packId={pack.id} packName="Tiled source" projectId={projectId} />);
    const group = screen.getByTestId(
      'asset-pack-browser-group-tileset:tileset:550e8400-e29b-41d4-a716-446655440002',
    );
    const groupButton = within(group).getByTestId(/asset-pack-browser-add-group-/);
    fireEvent.click(groupButton);

    await waitFor(() => {
      expect(useWorkingPalettesStore.getState().list({ projectId })[0]?.items).toHaveLength(2);
      expect(groupButton.textContent).toContain('Remove group');
    });

    fireEvent.click(groupButton);

    await waitFor(() => {
      expect(useWorkingPalettesStore.getState().list({ projectId })[0]?.items).toHaveLength(0);
      expect(groupButton.textContent).toContain('Add group');
    });
  });

  it('renders an intentional placeholder cell for groups without previews', () => {
    const emptyGroup = new AssetLibraryGroup({
      id: 'tileset:empty-preview-group',
      packId,
      kind: 'tileset',
      label: 'Empty Preview Group',
      count: 0,
      metadata: {},
      searchText: 'empty preview group',
      previewRefs: [],
    });
    useTilesetPackMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    useAssetPackLibraryPagesMock.mockReturnValue({
      data: {
        packId,
        total: 1,
        offset: 0,
        limit: 64,
        groups: [emptyGroup],
      },
      isLoading: false,
      isError: false,
    });

    render(<AssetPackBrowser packId={packId} packName="Tiled source" projectId={projectId} />);

    expect(
      screen
        .getByTestId('asset-pack-browser-item-tileset:empty-preview-group')
        .getAttribute('data-placeholder'),
    ).toBe('true');
  });
});

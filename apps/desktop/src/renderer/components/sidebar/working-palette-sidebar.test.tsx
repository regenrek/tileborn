// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  AssetLibraryReference,
  GameObjectType,
  SpawnPointComponent,
  LootSourceComponent,
  makeGameObjectTypeId,
  makePackId,
  makePlaceableId,
  makeProjectId,
  makeTileId,
  makeWorkingPaletteId,
  makeWorkingPaletteItemId,
  type Uuid,
  type WorkingPalette,
  type WorkingPaletteItem,
} from '@tileborne/core';
import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectBrushMock = vi.hoisted(() => vi.fn());
const useWorkingPalettePreviewsMock = vi.hoisted(() => vi.fn());

const useResolvedCatalogMock = vi.hoisted(() =>
  vi.fn(
    (): {
      readonly data: {
        readonly objectTypes: readonly unknown[];
        readonly lootTables: readonly unknown[];
        readonly items: readonly unknown[];
      };
    } => ({ data: { objectTypes: [], lootTables: [], items: [] } }),
  ),
);

const useTilesetPacksMock = vi.hoisted(() => vi.fn(() => [] as readonly { data?: unknown }[]));

const useValidateCatalogMock = vi.hoisted(() =>
  vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
);
const useMapMock = vi.hoisted(() => vi.fn(() => ({ data: undefined })));

vi.mock('@/hooks/queries', () => ({
  useWorkingPalettePreviews: useWorkingPalettePreviewsMock,
  useTilesetPacks: useTilesetPacksMock,
  useResolvedCatalog: useResolvedCatalogMock,
  useValidateCatalog: useValidateCatalogMock,
  useMap: useMapMock,
}));

const SPAWN_TYPE_ID = makeGameObjectTypeId('660e8400-e29b-41d4-a716-446655440001' as Uuid);
const LOOT_TYPE_ID = makeGameObjectTypeId('660e8400-e29b-41d4-a716-446655440002' as Uuid);

const catalogObjectType = (input: {
  id: GameObjectType['id'];
  label: string;
  family: string;
  components: GameObjectType['components'];
}): GameObjectType =>
  new GameObjectType({
    id: input.id,
    schemaVersion: 1,
    label: input.label,
    family: input.family as GameObjectType['family'],
    category: Option.none() as GameObjectType['category'],
    layerHint: Option.none(),
    components: input.components,
    instanceDefaults: {},
  });

const catalogWithObjectTypes = () => ({
  data: {
    objectTypes: [
      {
        objectType: catalogObjectType({
          id: SPAWN_TYPE_ID,
          label: 'Spawn Point',
          family: 'spawn',
          components: [new SpawnPointComponent({ data: {} })],
        }),
        origin: 'plugin' as const,
      },
      {
        objectType: catalogObjectType({
          id: LOOT_TYPE_ID,
          label: 'Loot Crate',
          family: 'loot',
          components: [
            new LootSourceComponent({
              lootTableId: Option.none(),
              interactionMode: 'tap',
              grants: {},
            }),
          ],
        }),
        origin: 'plugin' as const,
      },
    ],
    lootTables: [],
    items: [],
  },
});

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

// The sidebar now mounts the catalog import/export controls, which set up
// TanStack mutations and therefore require a QueryClient in scope.
const makeTestClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

// We render the real working-palettes-store (zustand) but stub the editor UI
// store so the sidebar can read brushIntent / selectBrush deterministically.
let editorState: {
  brushIntent: { kind: string; tileId?: unknown };
  selectBrush: (...args: unknown[]) => void;
};
vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: typeof editorState) => unknown) => selector(editorState),
}));

import { useWorkingPalettesStore } from '@/stores/working-palettes-store';
import { WorkingPaletteSidebar } from '@/components/sidebar/working-palette-sidebar';
import { workingPaletteItemKey } from '@/lib/working-palettes-bridge';

const projectId = makeProjectId('550e8400-e29b-41d4-a716-446655440101');
const packId = makePackId('550e8400-e29b-41d4-a716-446655440201');
const paletteId = makeWorkingPaletteId('550e8400-e29b-41d4-a716-446655440301');

const tileItem = (n: number): WorkingPaletteItem => {
  const tileId = makeTileId(`550e8400-e29b-41d4-a716-44665544040${n}`);
  return {
    id: makeWorkingPaletteItemId(`550e8400-e29b-41d4-a716-44665544050${n}`),
    ref: new AssetLibraryReference({
      packId,
      kind: 'tile',
      refId: tileId,
      tileId,
    }),
    label: `Tile ${n}`,
  };
};

const placeableItem = (n: number): WorkingPaletteItem => {
  const placeableId = makePlaceableId(`550e8400-e29b-41d4-a716-44665544060${n}`);
  return {
    id: makeWorkingPaletteItemId(`550e8400-e29b-41d4-a716-44665544070${n}`),
    ref: new AssetLibraryReference({
      packId,
      kind: 'placeable',
      refId: placeableId,
    }),
    label: n === 1 ? 'Rock' : `Object ${n}`,
  };
};

const largeTileItem = (index: number): WorkingPaletteItem => {
  const suffix = index.toString(16).padStart(12, '0');
  const tileId = makeTileId(`550e8400-e29b-41d4-a716-${suffix}`);
  return {
    id: makeWorkingPaletteItemId(`650e8400-e29b-41d4-a716-${suffix}`),
    ref: new AssetLibraryReference({ packId, kind: 'tile', refId: tileId, tileId }),
    label: `Tile ${index}`,
  };
};

const makePalette = (items: readonly WorkingPaletteItem[], name = 'Curated'): WorkingPalette => ({
  id: paletteId,
  projectId,
  name,
  items,
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
});

let bridgePalettes: readonly WorkingPalette[];

const installWorkingPaletteBridge = () => {
  const workingPalettes = {
    list: vi.fn(async () => ({ palettes: bridgePalettes, activePaletteId: paletteId })),
    removeItem: vi.fn(async (input: { itemId: WorkingPaletteItem['id'] }) => {
      const current = bridgePalettes[0]!;
      const next = { ...current, items: current.items.filter((item) => item.id !== input.itemId) };
      bridgePalettes = [next];
      return { palette: next };
    }),
    update: vi.fn(async () => {
      const next = { ...bridgePalettes[0]!, items: [] };
      bridgePalettes = [next];
      return { palette: next };
    }),
    create: vi.fn(),
    delete: vi.fn(),
    setActive: vi.fn(),
    addItems: vi.fn(),
    reorderItems: vi.fn(),
    getActive: vi.fn(),
  };
  Object.defineProperty(window, 'tileborne', {
    configurable: true,
    value: { workingPalettes },
  });
  return workingPalettes;
};

describe('WorkingPaletteSidebar', () => {
  let originalOffsetHeight: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 384,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 240,
    });
    selectBrushMock.mockReset();
    useWorkingPalettePreviewsMock.mockReset();
    useResolvedCatalogMock.mockReturnValue({
      data: { objectTypes: [], lootTables: [], items: [] },
    });
    // Previews now come from the main process via IPC; the sidebar only renders
    // the curated items and looks previews up by ref key.
    useWorkingPalettePreviewsMock.mockReturnValue({ previewByKey: new Map(), isLoading: false });
    useTilesetPacksMock.mockReturnValue([]);
    editorState = {
      brushIntent: { kind: 'eraser' },
      selectBrush: selectBrushMock,
    };
    useWorkingPalettesStore.getState().__resetForTests();
    bridgePalettes = [];
    installWorkingPaletteBridge();
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

  it('shows the empty state when no working palette exists', () => {
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    expect(screen.getAllByText(/No working palette/i).length).toBeGreaterThan(0);
  });

  it('does not render thousands of cards when underlying pack has thousands of tiles', () => {
    bridgePalettes = [makePalette([tileItem(1), tileItem(2)])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    const itemButtons = screen.getAllByTestId(/^working-palette-sidebar-item-/);
    expect(itemButtons).toHaveLength(2);
  });

  it('virtualizes a 2,000-item palette and exposes ordered items on demand while scrolling', async () => {
    bridgePalettes = [
      makePalette(Array.from({ length: 2_000 }, (_, index) => largeTileItem(index))),
    ];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });

    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );

    const renderedItems = screen.getAllByTestId(/^working-palette-sidebar-item-/);
    expect(renderedItems.length).toBeGreaterThan(0);
    expect(renderedItems.length).toBeLessThan(100);
    const refs = useWorkingPalettePreviewsMock.mock.calls.at(-1)?.[0] as readonly unknown[];
    expect(refs).toHaveLength(64);
    expect(Number.parseFloat(screen.getByTestId('working-palette-sidebar-grid').style.height)).toBe(
      17_600,
    );

    const lastItem = largeTileItem(1_999);
    expect(
      screen.queryByTestId(`working-palette-sidebar-item-${workingPaletteItemKey(lastItem)}`),
    ).toBeNull();

    const viewport = screen.getByTestId('working-palette-sidebar-grid-viewport');
    fireEvent.scroll(viewport, { target: { scrollTop: 17_216 } });

    await waitFor(() =>
      expect(
        screen.getByTestId(`working-palette-sidebar-item-${workingPaletteItemKey(lastItem)}`),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByTestId(
        `working-palette-sidebar-item-${workingPaletteItemKey(largeTileItem(0))}`,
      ),
    ).toBeNull();
    const finalWindowRefs = useWorkingPalettePreviewsMock.mock.calls.at(-1)?.[0] as readonly {
      refId: string;
    }[];
    expect(finalWindowRefs.some((ref) => ref.refId === lastItem.ref.refId)).toBe(true);
  });

  it('resolves previews for the palette item refs via the main-process IPC hook', () => {
    bridgePalettes = [makePalette([tileItem(1), tileItem(2), tileItem(3)])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    const refs = useWorkingPalettePreviewsMock.mock.calls.at(-1)?.[0] as readonly {
      refId: string;
    }[];
    expect(refs).toHaveLength(3);
    expect(screen.getAllByTestId(/^working-palette-sidebar-item-/)).toHaveLength(3);
  });

  it('invokes selectBrush with the matching brush intent when a palette item is clicked', () => {
    const item = placeableItem(1);
    bridgePalettes = [makePalette([item])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    const button = screen.getByTestId(
      `working-palette-sidebar-item-placeable:${packId}:${item.ref.refId}:`,
    );
    fireEvent.click(button);
    expect(selectBrushMock).toHaveBeenCalledWith({
      kind: 'placeable',
      packId,
      placeableId: item.ref.refId,
    });
  });

  it('renders palette items as a compact grid without per-item remove buttons', () => {
    bridgePalettes = [makePalette([tileItem(1), tileItem(2)])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('working-palette-sidebar-grid')).toBeTruthy();
    expect(screen.getAllByTestId(/^working-palette-sidebar-item-/)).toHaveLength(2);
    expect(screen.queryAllByTestId(/^working-palette-sidebar-remove-/)).toHaveLength(0);
  });

  it('omits the Objects group when the resolved catalog has no object types', () => {
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('working-palette-objects-group')).toBeNull();
  });

  it('renders catalog object types as chips and selecting one sets the single plugin-object brush carrying the resolved id', () => {
    useResolvedCatalogMock.mockReturnValue(catalogWithObjectTypes());
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('working-palette-objects-group')).toBeTruthy();
    const spawn = screen.getByTestId(`palette-action-${SPAWN_TYPE_ID}`);
    expect(spawn.getAttribute('data-active')).toBe('false');

    fireEvent.click(spawn);
    // The brush carries the resolved GameObjectTypeId verbatim — placement stamps
    // it directly onto MapObject.kind.
    expect(selectBrushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'plugin-object', objectKind: SPAWN_TYPE_ID }),
      'objectPlace',
    );
  });

  it('highlights exactly the active catalog-object chip (single highlight)', () => {
    useResolvedCatalogMock.mockReturnValue(catalogWithObjectTypes());
    editorState = {
      brushIntent: { kind: 'plugin-object', objectKind: SPAWN_TYPE_ID } as never,
      selectBrush: selectBrushMock,
    };
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId(`palette-action-${SPAWN_TYPE_ID}`).getAttribute('data-active')).toBe(
      'true',
    );
    expect(screen.getByTestId(`palette-action-${LOOT_TYPE_ID}`).getAttribute('data-active')).toBe(
      'false',
    );
  });

  it('humanises long internal identifiers in labels coming from the working palette', () => {
    bridgePalettes = [makePalette([{ ...tileItem(1), label: 'Grass Terrain' }])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <QueryClientProvider client={makeTestClient()}>
        <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /Grass Terrain/i })).toBeTruthy();
  });
});

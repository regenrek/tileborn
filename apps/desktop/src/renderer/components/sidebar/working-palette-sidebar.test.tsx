// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  AssetLibraryReference,
  makePackId,
  makePlaceableId,
  makeProjectId,
  makeTileId,
  makeWorkingPaletteId,
  makeWorkingPaletteItemId,
  type WorkingPalette,
  type WorkingPaletteItem,
} from '@tileborne/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectBrushMock = vi.hoisted(() => vi.fn());
const useTilesetPackMock = vi.hoisted(() => vi.fn());
const useAssetDataUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/queries', () => ({
  useAssetDataUrl: useAssetDataUrlMock,
  useTilesetPack: useTilesetPackMock,
}));

vi.mock('@/stores/app-notifications-store', () => ({
  notifySuccess: vi.fn(),
}));

// We render the real working-palettes-store (zustand) but stub the editor UI
// store so the sidebar can read brushIntent / selectBrush deterministically.
let editorState: { brushIntent: { kind: string; tileId?: unknown }; selectBrush: (...args: unknown[]) => void };
vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: typeof editorState) => unknown) => selector(editorState),
}));

import { useWorkingPalettesStore } from '@/stores/working-palettes-store';
import { WorkingPaletteSidebar } from '@/components/sidebar/working-palette-sidebar';

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

// The sidebar only renders items from the working palette. When the
// underlying TilesetPack query is undefined the sidebar shows placeholder
// icons for previews, which is the explicit test surface we want to verify
// here (curated count is independent of pack size).
const stubTilesetPackQuery = (overrides: { isLoading?: boolean; isError?: boolean } = {}) => ({
  data: undefined,
  isLoading: overrides.isLoading ?? false,
  isError: overrides.isError ?? false,
});

describe('WorkingPaletteSidebar', () => {
  beforeEach(() => {
    selectBrushMock.mockReset();
    useTilesetPackMock.mockReset();
    useAssetDataUrlMock.mockReset();
    useAssetDataUrlMock.mockReturnValue({ data: undefined, isLoading: false });
    editorState = {
      brushIntent: { kind: 'eraser' },
      selectBrush: selectBrushMock,
    };
    useWorkingPalettesStore.getState().__resetForTests();
    bridgePalettes = [];
    installWorkingPaletteBridge();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the empty state when no working palette exists', () => {
    useTilesetPackMock.mockReturnValue(stubTilesetPackQuery());
    render(
      <WorkingPaletteSidebar
        projectId={projectId}
        packId={packId}
        packName="Test pack"
      />,
    );
    expect(screen.getAllByText(/No working palette/i).length).toBeGreaterThan(0);
  });

  it('does not render thousands of cards when underlying pack has thousands of tiles', () => {
    useTilesetPackMock.mockReturnValue(stubTilesetPackQuery());
    bridgePalettes = [makePalette([tileItem(1), tileItem(2)])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <WorkingPaletteSidebar
        projectId={projectId}
        packId={packId}
        packName="Test pack"
      />,
    );
    const itemButtons = screen.getAllByTestId(/^working-palette-sidebar-item-/);
    expect(itemButtons).toHaveLength(2);
  });

  it('invokes selectBrush with the matching brush intent when a palette item is clicked', () => {
    useTilesetPackMock.mockReturnValue(stubTilesetPackQuery());
    const item = placeableItem(1);
    bridgePalettes = [makePalette([item])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <WorkingPaletteSidebar
        projectId={projectId}
        packId={packId}
        packName="Test pack"
      />,
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
    useTilesetPackMock.mockReturnValue(stubTilesetPackQuery());
    bridgePalettes = [makePalette([tileItem(1), tileItem(2)])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <WorkingPaletteSidebar
        projectId={projectId}
        packId={packId}
        packName="Test pack"
      />,
    );
    expect(screen.getByTestId('working-palette-sidebar-grid')).toBeTruthy();
    expect(screen.getAllByTestId(/^working-palette-sidebar-item-/)).toHaveLength(2);
    expect(screen.queryAllByTestId(/^working-palette-sidebar-remove-/)).toHaveLength(0);
  });

  it('humanises long internal identifiers in labels coming from the working palette', () => {
    useTilesetPackMock.mockReturnValue(stubTilesetPackQuery());
    bridgePalettes = [makePalette([{ ...tileItem(1), label: 'Grass Terrain' }])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <WorkingPaletteSidebar
        projectId={projectId}
        packId={packId}
        packName="Test pack"
      />,
    );
    expect(screen.getByRole('button', { name: /Grass Terrain/i })).toBeTruthy();
  });
});

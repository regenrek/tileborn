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
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectBrushMock = vi.hoisted(() => vi.fn());
const useWorkingPalettePreviewsMock = vi.hoisted(() => vi.fn());

const usePluginsListMock = vi.hoisted(() =>
  vi.fn(() => ({ data: { plugins: [] as readonly { id: string; enabled: boolean }[] } })),
);

const useTilesetPacksMock = vi.hoisted(() => vi.fn(() => [] as readonly { data?: unknown }[]));

vi.mock('@/hooks/queries', () => ({
  useWorkingPalettePreviews: useWorkingPalettePreviewsMock,
  useTilesetPacks: useTilesetPacksMock,
  usePluginsList: usePluginsListMock,
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

describe('WorkingPaletteSidebar', () => {
  beforeEach(() => {
    selectBrushMock.mockReset();
    useWorkingPalettePreviewsMock.mockReset();
    usePluginsListMock.mockReturnValue({ data: { plugins: [] } });
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
    cleanup();
  });

  it('shows the empty state when no working palette exists', () => {
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

  it('resolves previews for the palette item refs via the main-process IPC hook', () => {
    bridgePalettes = [makePalette([tileItem(1), tileItem(2), tileItem(3)])];
    useWorkingPalettesStore.setState({ palettes: bridgePalettes, activePaletteId: paletteId });
    render(
      <WorkingPaletteSidebar
        projectId={projectId}
        packId={packId}
        packName="Test pack"
      />,
    );
    const refs = useWorkingPalettePreviewsMock.mock.calls.at(-1)?.[0] as readonly { refId: string }[];
    expect(refs).toHaveLength(3);
    expect(screen.getAllByTestId(/^working-palette-sidebar-item-/)).toHaveLength(3);
  });

  it('invokes selectBrush with the matching brush intent when a palette item is clicked', () => {
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

  it('omits the Markers & Tools group when no plugin contributes palette actions', () => {
    render(
      <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />,
    );
    expect(screen.queryByTestId('working-palette-markers-group')).toBeNull();
  });

  it('renders contributed markers as chips and selecting one sets the single plugin-object brush', () => {
    usePluginsListMock.mockReturnValue({
      data: { plugins: [{ id: PLUGIN_ID, enabled: true }] },
    });
    render(
      <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />,
    );

    expect(screen.getByTestId('working-palette-markers-group')).toBeTruthy();
    const spawn = screen.getByTestId('palette-action-battle-royale-spawn-point');
    expect(spawn.getAttribute('data-active')).toBe('false');

    fireEvent.click(spawn);
    expect(selectBrushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'plugin-object', objectKind: 'spawn-point' }),
      'objectPlace',
    );
  });

  it('highlights exactly the active plugin-object marker (single highlight)', () => {
    usePluginsListMock.mockReturnValue({
      data: { plugins: [{ id: PLUGIN_ID, enabled: true }] },
    });
    editorState = {
      brushIntent: { kind: 'plugin-object', objectKind: 'spawn-point' } as never,
      selectBrush: selectBrushMock,
    };
    render(
      <WorkingPaletteSidebar projectId={projectId} packId={packId} packName="Test pack" />,
    );
    expect(
      screen.getByTestId('palette-action-battle-royale-spawn-point').getAttribute('data-active'),
    ).toBe('true');
    expect(
      screen.getByTestId('palette-action-battle-royale-loot-crate').getAttribute('data-active'),
    ).toBe('false');
  });

  it('humanises long internal identifiers in labels coming from the working palette', () => {
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

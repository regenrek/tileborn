// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssetLibraryReference,
  makePackId,
  makeProjectId,
  makeTileId,
  makeWorkingPaletteId,
  makeWorkingPaletteItemId,
  type WorkingPalette,
  type WorkingPaletteId,
  type WorkingPaletteItem,
} from '@tileborne/core';

import type { WorkingPaletteItemDraft } from '@/lib/working-palettes-bridge';

import { useWorkingPalettesStore } from './working-palettes-store';

const projectId = makeProjectId('550e8400-e29b-41d4-a716-446655440101');
const packId = makePackId('550e8400-e29b-41d4-a716-446655440201');

const tileDraft = (n: number): WorkingPaletteItemDraft => {
  const uuid = `550e8400-e29b-41d4-a716-44665544030${n}`;
  const tileId = makeTileId(uuid);
  return {
    ref: new AssetLibraryReference({
      packId,
      kind: 'tile',
      refId: tileId,
      tileId,
    }),
    label: `Tile ${n}`,
  };
};

const itemFromDraft = (draft: WorkingPaletteItemDraft, n: number): WorkingPaletteItem => ({
  id: makeWorkingPaletteItemId(`550e8400-e29b-41d4-a716-44665544040${n}`),
  ref: draft.ref,
  label: draft.label ?? draft.ref.refId,
});

let palettes: WorkingPalette[];
let activePaletteId: WorkingPaletteId | undefined;
let idCounter: number;

const makePalette = (
  name: string,
  items: readonly WorkingPaletteItemDraft[] = [],
): WorkingPalette => {
  idCounter += 1;
  const now = `2026-05-25T00:00:0${idCounter}.000Z`;
  return {
    id: makeWorkingPaletteId(`550e8400-e29b-41d4-a716-44665544050${idCounter}`),
    projectId,
    name,
    items: items.map((item, index) => itemFromDraft(item, idCounter + index)),
    createdAt: now,
    updatedAt: now,
  };
};

const installWorkingPaletteBridge = () => {
  const workingPalettes = {
    list: vi.fn(async () => ({
      palettes,
      activePaletteId,
    })),
    create: vi.fn(async (input: { name: string; items?: readonly WorkingPaletteItemDraft[] }) => {
      const palette = makePalette(input.name, input.items ?? []);
      palettes = [...palettes, palette];
      activePaletteId ??= palette.id;
      return { palette };
    }),
    update: vi.fn(
      async (input: {
        paletteId: WorkingPaletteId;
        name?: string;
        items?: readonly WorkingPaletteItemDraft[];
      }) => {
        const existing = palettes.find((palette) => palette.id === input.paletteId)!;
        const next: WorkingPalette = {
          ...existing,
          name: input.name ?? existing.name,
          items:
            input.items === undefined
              ? existing.items
              : input.items.map((item, index) => itemFromDraft(item, index + 1)),
        };
        palettes = palettes.map((palette) => (palette.id === next.id ? next : palette));
        return { palette: next };
      },
    ),
    delete: vi.fn(async (input: { paletteId: WorkingPaletteId }) => {
      palettes = palettes.filter((palette) => palette.id !== input.paletteId);
      if (activePaletteId === input.paletteId) {
        activePaletteId = palettes[0]?.id;
      }
      return {};
    }),
    setActive: vi.fn(async (input: { paletteId: WorkingPaletteId }) => {
      activePaletteId = input.paletteId;
      return { palette: palettes.find((palette) => palette.id === input.paletteId)! };
    }),
    addItems: vi.fn(
      async (input: { paletteId: WorkingPaletteId; items: readonly WorkingPaletteItemDraft[] }) => {
        const existing = palettes.find((palette) => palette.id === input.paletteId)!;
        const next: WorkingPalette = {
          ...existing,
          items: [
            ...existing.items,
            ...input.items.map((item, index) =>
              itemFromDraft(item, existing.items.length + index + 1),
            ),
          ],
        };
        palettes = palettes.map((palette) => (palette.id === next.id ? next : palette));
        return { palette: next };
      },
    ),
    removeItem: vi.fn(
      async (input: { paletteId: WorkingPaletteId; itemId: WorkingPaletteItem['id'] }) => {
        const existing = palettes.find((palette) => palette.id === input.paletteId)!;
        const next: WorkingPalette = {
          ...existing,
          items: existing.items.filter((item) => item.id !== input.itemId),
        };
        palettes = palettes.map((palette) => (palette.id === next.id ? next : palette));
        return { palette: next };
      },
    ),
    reorderItems: vi.fn(
      async (input: {
        paletteId: WorkingPaletteId;
        itemIds: readonly WorkingPaletteItem['id'][];
      }) => {
        const existing = palettes.find((palette) => palette.id === input.paletteId)!;
        const byId = new Map(existing.items.map((item) => [item.id, item] as const));
        const next: WorkingPalette = {
          ...existing,
          items: input.itemIds.map((itemId) => byId.get(itemId)!),
        };
        palettes = palettes.map((palette) => (palette.id === next.id ? next : palette));
        return { palette: next };
      },
    ),
  };

  Object.defineProperty(window, 'tileborne', {
    configurable: true,
    value: { workingPalettes },
  });
  return workingPalettes;
};

describe('working-palettes-store', () => {
  beforeEach(() => {
    palettes = [];
    activePaletteId = undefined;
    idCounter = 0;
    useWorkingPalettesStore.getState().__resetForTests();
    installWorkingPaletteBridge();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads palettes from the backend bridge', async () => {
    palettes = [makePalette('Existing')];
    activePaletteId = palettes[0]!.id;

    await useWorkingPalettesStore.getState().load({ projectId });

    expect(useWorkingPalettesStore.getState().list({ projectId })).toHaveLength(1);
    expect(useWorkingPalettesStore.getState().getActive({ projectId })?.name).toBe('Existing');
  });

  it('creates a project-scoped palette through IPC and refreshes local cache', async () => {
    const palette = await useWorkingPalettesStore.getState().create({
      projectId,
      name: 'My palette',
    });

    expect(palette.name).toBe('My palette');
    expect(palette.items).toEqual([]);

    const active = useWorkingPalettesStore.getState().getActive({ projectId });
    expect(active?.id).toBe(palette.id);
  });

  it('adds and removes canonical working palette items through IPC', async () => {
    const store = useWorkingPalettesStore.getState();
    const palette = await store.create({ projectId, name: 'A' });
    await store.addItems({ projectId, paletteId: palette.id, items: [tileDraft(1), tileDraft(2)] });
    const withItems = store.list({ projectId })[0]!;
    expect(withItems.items.map((item) => item.ref.kind)).toEqual(['tile', 'tile']);

    await store.removeItem({ projectId, paletteId: palette.id, itemId: withItems.items[0]!.id });
    expect(store.list({ projectId })[0]!.items.map((item) => item.label)).toEqual(['Tile 2']);
  });

  it('reorders items by backend item ids', async () => {
    const store = useWorkingPalettesStore.getState();
    const palette = await store.create({
      projectId,
      name: 'A',
      items: [tileDraft(1), tileDraft(2), tileDraft(3)],
    });
    const items = store.list({ projectId })[0]!.items;
    await store.reorderItems({
      projectId,
      paletteId: palette.id,
      itemIds: [items[2]!.id, items[0]!.id, items[1]!.id],
    });
    const next = useWorkingPalettesStore.getState().list({ projectId })[0]!;
    expect(next.items.map((item) => item.label)).toEqual(['Tile 3', 'Tile 1', 'Tile 2']);
  });

  it('deletes through IPC and honors backend active fallback', async () => {
    const store = useWorkingPalettesStore.getState();
    const first = await store.create({ projectId, name: 'first' });
    const second = await store.create({ projectId, name: 'second' });
    await store.setActive({ projectId, paletteId: second.id });
    expect(useWorkingPalettesStore.getState().getActive({ projectId })?.id).toBe(second.id);
    await store.remove({ projectId, paletteId: second.id });
    expect(useWorkingPalettesStore.getState().getActive({ projectId })?.id).toBe(first.id);
  });
});

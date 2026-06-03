// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CollisionFootprintComponent,
  GameObjectType,
  ItemDefinition,
  LootSourceComponent,
  LootTable,
  makeGameObjectTypeId,
  makeLootTableId,
  makeMapId,
  makeTileborneMap,
  type CategoryTag,
  type FamilyTag,
  type MapObject,
  type ProjectId,
  type TileborneMap,
} from '@tileborne/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Option } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogObjectPanel } from '@/components/inspector/catalog-object-panel';
import { placeObject } from '@/editor/map-utils';

const PROJECT_ID = 'project-1' as ProjectId;
const LOOT_TYPE_ID = makeGameObjectTypeId('11111111-1111-4111-8111-111111111111');
const TABLE_COMMON = makeLootTableId('22222222-2222-4222-8222-222222222222');
const TABLE_RARE = makeLootTableId('33333333-3333-4333-8333-333333333333');

const lootSourceComponent = () =>
  new LootSourceComponent({
    lootTableId: Option.some(TABLE_COMMON),
    interactionMode: 'tap',
    grants: { primary: true },
  });

const lootObjectType = () =>
  new GameObjectType({
    id: LOOT_TYPE_ID,
    schemaVersion: 1,
    label: 'Loot crate',
    family: 'loot' as FamilyTag,
    category: Option.some('containers' as CategoryTag),
    layerHint: Option.none(),
    components: [
      new CollisionFootprintComponent({ source: 'manual', reviewed: true, parts: [] }),
      lootSourceComponent(),
    ],
    instanceDefaults: { maxUses: 3 },
  });

const resolveResponse = (objectType: GameObjectType) => ({
  objectTypes: [{ objectType, origin: 'plugin' as const }],
  lootTables: [
    new LootTable({ id: TABLE_COMMON, label: 'Common cache', entries: [] }),
    new LootTable({ id: TABLE_RARE, label: 'Rare cache', entries: [] }),
  ],
  items: [] as ItemDefinition[],
});

const buildMapWithLootObject = (): { map: TileborneMap; object: MapObject } => {
  const base = makeTileborneMap({
    id: makeMapId('66666666-6666-4666-8666-666666666666'),
    width: 4,
    height: 4,
    tileWidth: 32,
    tileHeight: 32,
  });
  const placed = placeObject(base, { kind: LOOT_TYPE_ID, x: 32, y: 32 });
  const object = placed.map.objects.find((entry) => entry.id === placed.objectId)!;
  return { map: placed.map, object };
};

describe('CatalogObjectPanel', () => {
  let client: QueryClient;
  let resolve: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let objectType: GameObjectType;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    objectType = lootObjectType();
    resolve = vi.fn(async () => resolveResponse(objectType));
    update = vi.fn(async (input: unknown) => ({ map: (input as { map: unknown }).map }));
    Object.defineProperty(window, 'tileborne', {
      configurable: true,
      value: {
        catalog: { resolve },
        maps: { update },
      },
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('resolves the type and renders its components + a loot-source binding', async () => {
    const { map, object } = buildMapWithLootObject();
    render(<CatalogObjectPanel projectId={PROJECT_ID} map={map} object={object} />, { wrapper });

    const panel = await screen.findByTestId('catalog-object-panel');
    expect(panel.getAttribute('data-object-type')).toBe(LOOT_TYPE_ID);
    expect(screen.getByTestId('catalog-component-collision-footprint')).toBeTruthy();
    expect(screen.getByTestId('catalog-component-loot-source')).toBeTruthy();

    // Loot-table picker lists the resolved catalog's loot-table DEFINITIONS.
    const picker = screen.getByTestId('loot-table-picker') as HTMLSelectElement;
    const optionLabels = [...picker.options].map((option) => option.textContent);
    expect(optionLabels).toContain('Common cache');
    expect(optionLabels).toContain('Rare cache');
    expect(picker.value).toBe(TABLE_COMMON);
  });

  it('renders the per-instance override field seeded from instanceDefaults', async () => {
    const { map, object } = buildMapWithLootObject();
    render(<CatalogObjectPanel projectId={PROJECT_ID} map={map} object={object} />, { wrapper });

    const input = (await screen.findByTestId('catalog-override-maxUses')) as HTMLInputElement;
    expect(input.value).toBe('3');
  });

  it('persists edited overrides + loot binding to the MapObject and never mutates the definition', async () => {
    const { map, object } = buildMapWithLootObject();
    render(<CatalogObjectPanel projectId={PROJECT_ID} map={map} object={object} />, { wrapper });

    const input = (await screen.findByTestId('catalog-override-maxUses')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '8' } });

    const picker = screen.getByTestId('loot-table-picker') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: TABLE_RARE } });

    fireEvent.click(screen.getByTestId('catalog-object-save'));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    const savedMap = (update.mock.calls[0]![0] as { map: { objects: readonly MapObject[] } }).map;
    const savedObject = savedMap.objects.find((entry) => entry.id === object.id)!;
    expect(savedObject.properties.maxUses).toBe(8);
    expect(savedObject.properties.lootSource).toEqual({
      lootTableId: TABLE_RARE,
      interactionMode: 'tap',
      grants: { primary: true },
    });

    // Read-only catalog definition (decision c-cgsd): untouched by the edit.
    expect(objectType.instanceDefaults).toEqual({ maxUses: 3 });
    const loot = objectType.components.find((component) => component._tag === 'loot-source');
    expect(loot && (loot as LootSourceComponent).grants).toEqual({ primary: true });
    expect(loot && Option.getOrUndefined((loot as LootSourceComponent).lootTableId)).toBe(
      TABLE_COMMON,
    );
  });

  it('surfaces the collision footprint with the reviewed flag and a per-instance offset adjust', async () => {
    const { map, object } = buildMapWithLootObject();
    render(<CatalogObjectPanel projectId={PROJECT_ID} map={map} object={object} />, { wrapper });

    const section = await screen.findByTestId('collision-footprint-section');
    expect(section.getAttribute('data-footprint-source')).toBe('manual');
    expect(screen.getByTestId('footprint-reviewed').getAttribute('data-reviewed')).toBe('true');
    // `manual` footprints permit per-instance adjustment (ADR-0025 §5).
    expect(screen.getByTestId('footprint-offset-x')).toBeTruthy();
    expect(screen.getByTestId('footprint-offset-y')).toBeTruthy();
  });

  it('persists the per-instance footprint offset to the MapObject without mutating the type', async () => {
    const { map, object } = buildMapWithLootObject();
    render(<CatalogObjectPanel projectId={PROJECT_ID} map={map} object={object} />, { wrapper });

    const offsetX = (await screen.findByTestId('footprint-offset-x')) as HTMLInputElement;
    fireEvent.change(offsetX, { target: { value: '6' } });
    const offsetY = screen.getByTestId('footprint-offset-y') as HTMLInputElement;
    fireEvent.change(offsetY, { target: { value: '-4' } });

    fireEvent.click(screen.getByTestId('catalog-object-save'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    const savedMap = (update.mock.calls[0]![0] as { map: { objects: readonly MapObject[] } }).map;
    const savedObject = savedMap.objects.find((entry) => entry.id === object.id)!;
    expect(savedObject.properties.collisionFootprintOffset).toEqual({ x: 6, y: -4 });

    const footprint = objectType.components.find(
      (component) => component._tag === 'collision-footprint',
    );
    expect(footprint && (footprint as CollisionFootprintComponent).parts).toEqual([]);
  });

  it('renders a machine-derived footprint read-only with no per-instance offset adjust', async () => {
    const generatedType = new GameObjectType({
      id: LOOT_TYPE_ID,
      schemaVersion: 1,
      label: 'Boulder',
      family: 'prop' as FamilyTag,
      category: Option.none(),
      layerHint: Option.none(),
      components: [
        new CollisionFootprintComponent({ source: 'generated', reviewed: false, parts: [] }),
      ],
      instanceDefaults: {},
    });
    resolve.mockResolvedValueOnce(resolveResponse(generatedType));
    const { map, object } = buildMapWithLootObject();
    render(<CatalogObjectPanel projectId={PROJECT_ID} map={map} object={object} />, { wrapper });

    expect(await screen.findByTestId('footprint-readonly-note')).toBeTruthy();
    expect(screen.queryByTestId('footprint-offset-x')).toBeNull();
    expect(screen.getByTestId('footprint-reviewed').getAttribute('data-reviewed')).toBe('false');
  });

  it('shows an unknown-type notice when the kind is absent from the resolved catalog', async () => {
    const { map, object } = buildMapWithLootObject();
    resolve.mockResolvedValueOnce({ objectTypes: [], lootTables: [], items: [] });
    render(<CatalogObjectPanel projectId={PROJECT_ID} map={map} object={object} />, { wrapper });

    expect(await screen.findByTestId('catalog-object-unknown')).toBeTruthy();
  });
});

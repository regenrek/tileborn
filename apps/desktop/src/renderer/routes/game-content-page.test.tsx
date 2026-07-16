// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  GameObjectType,
  VisualRefComponent,
  WeaponRefComponent,
  makeAssetId,
  makeGameObjectTypeId,
  makePlaceableId,
  makeWeaponDefinitionId,
  type Uuid,
} from '@tileborne/core';
import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameContentPage } from '@/routes/game-content-page';
import { documentLifecycle } from '@/lib/document-lifecycle';

const upsertDefinition = vi.fn();
const upsertType = vi.fn();
const uuid = (value: string) => `550e8400-e29b-41d4-a716-${value.padStart(12, '0')}` as Uuid;
const visualEntity = new GameObjectType({
  id: makeGameObjectTypeId(uuid('1')),
  schemaVersion: 1,
  label: 'Medkit sprite',
  family: 'pickup' as GameObjectType['family'],
  category: Option.none(),
  layerHint: Option.some('objects'),
  components: [new VisualRefComponent({
    placeableId: Option.some(makePlaceableId(uuid('2'))),
    assetId: Option.some(makeAssetId(uuid('3'))),
    width: 32,
    height: 32,
    anchors: {},
  })],
  instanceDefaults: {},
});
const brWeaponId = makeWeaponDefinitionId(uuid('11'));
const arenaWeaponId = makeWeaponDefinitionId(uuid('12'));
const brWeaponVisual = new GameObjectType({
  ...visualEntity,
  id: makeGameObjectTypeId(uuid('13')),
  label: 'Pulse Carbine visual',
  components: [
    ...visualEntity.components,
    new WeaponRefComponent({ weaponId: brWeaponId, pickupEntityId: visualEntity.id }),
  ],
});
let catalogData: unknown;

const baseCatalog = () => ({
  objectTypes: [{ objectType: visualEntity, origin: 'project' }, { objectType: brWeaponVisual, origin: 'plugin', sourcePluginId: 'plugin:br' }],
  weapons: [],
  items: [],
  lootTables: [],
  definitionProvenance: { [String(visualEntity.id)]: { _tag: 'project-authored' } },
});

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project:test' }),
  Link: ({ children }: { readonly children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/hooks/queries', () => ({
  useProject: () => ({ data: { project: { settings: { activeGameMode: 'plugin:br' } } } }),
  useResolvedCatalog: () => ({
    data: catalogData,
    isLoading: false,
  }),
}));
vi.mock('@/hooks/use-placeable-visual', () => ({
  usePlaceableVisual: () => ({
    placeableId: 'placeable:test',
    name: 'Pulse Carbine visual',
    packId: 'pack:test',
    packName: 'Test pack',
    integrityHash: 'test-hash',
    preview: { assetPath: 'sprites.png', x: 0, y: 0, width: 32, height: 32 },
  }),
}));
vi.mock('@/hooks/mutations', () => ({
  useUpsertCatalogDefinition: () => ({ mutateAsync: upsertDefinition, isPending: false }),
  useUpsertCatalogType: () => ({ mutateAsync: upsertType, isPending: false }),
  useDuplicateCatalogDefinition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveCatalogDefinition: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/stores/app-notifications-store', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

describe('GameContentPage', () => {
  beforeEach(() => {
    documentLifecycle.resetForTests();
    catalogData = baseCatalog();
  });
  afterEach(() => {
    cleanup();
    documentLifecycle.resetForTests();
    upsertDefinition.mockReset();
    upsertType.mockReset();
  });

  it('creates an item through labeled controls and links the selected real visual as its pickup', async () => {
    upsertDefinition.mockResolvedValue({ saved: true, report: { ok: true, issues: [] } });
    upsertType.mockResolvedValue({ saved: true, report: { ok: true, issues: [] } });
    render(<GameContentPage />);

    fireEvent.click(screen.getByTestId('content-tab-items'));
    fireEvent.change(screen.getByTestId('content-name'), { target: { value: 'Field Medkit' } });
    fireEvent.change(screen.getByTestId('content-rarity'), { target: { value: 'rare' } });
    fireEvent.change(screen.getByTestId('content-visual-entity'), { target: { value: String(visualEntity.id) } });
    fireEvent.click(screen.getByTestId('content-create'));

    await waitFor(() => expect(upsertDefinition).toHaveBeenCalledOnce());
    expect(upsertDefinition.mock.calls[0]?.[0]).toMatchObject({
      kind: 'item',
      definitionJson: { label: 'Field Medkit', data: { tier: 'rare' } },
    });
    await waitFor(() => expect(upsertType).toHaveBeenCalledOnce());
    expect(upsertType.mock.calls[0]?.[0].objectTypeJson.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'loot-source', grantRefs: [expect.objectContaining({ _tag: 'item-grant' })] }),
    ]));
  });

  it('routes Create through lifecycle and preserves the draft when persistence fails', async () => {
    let rejectSave!: (cause: Error) => void;
    upsertDefinition.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));
    render(<GameContentPage />);
    fireEvent.click(screen.getByTestId('content-tab-items'));
    fireEvent.change(screen.getByTestId('content-name'), { target: { value: 'Unsaved Medkit' } });
    fireEvent.change(screen.getByTestId('content-visual-entity'), {
      target: { value: String(visualEntity.id) },
    });
    fireEvent.click(screen.getByTestId('content-create'));

    await waitFor(() => expect(screen.getByTestId('content-document-status').textContent).toBe('saving'));
    rejectSave(new Error('catalog write failed'));
    await waitFor(() => expect(screen.getByTestId('content-document-status').textContent).toBe('error'));
    expect((screen.getByTestId('content-name') as HTMLInputElement).value).toBe('Unsaved Medkit');
    expect(documentLifecycle.get('game-content:project:test')).toMatchObject({
      status: 'error',
      hasRecovery: true,
    });
  });

  it('shows active-mode and project weapons with real visuals but hides other plugin templates', () => {
    catalogData = {
      ...baseCatalog(),
      weapons: [
        { entry: { weapon: { id: brWeaponId }, delivery: { _tag: 'ProjectileDelivery' } }, label: 'Pulse Carbine', origin: 'plugin', sourcePluginId: 'plugin:br' },
        { entry: { weapon: { id: arenaWeaponId }, delivery: { _tag: 'MeleeDelivery' } }, label: String(arenaWeaponId), origin: 'plugin', sourcePluginId: 'plugin:arena' },
      ],
    };
    render(<GameContentPage />);

    fireEvent.click(screen.getByTestId('content-tab-weapons'));

    expect(screen.getByText('Pulse Carbine')).toBeTruthy();
    expect(screen.getByAltText('Pulse Carbine visual visual')).toBeTruthy();
    expect(screen.queryByText(String(arenaWeaponId))).toBeNull();
  });
});

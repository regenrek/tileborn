import {
  GameObjectType,
  LootSourceComponent,
  SpawnPointComponent,
  makeGameObjectTypeId,
  type Uuid,
} from '@tileborne/core';
import type { GameObjectCatalogEntryView } from '@tileborne/ipc-contracts';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  groupCatalogPaletteActions,
  projectCatalogPaletteActions,
} from '@/lib/catalog-palette-projection';

const SPAWN_ID = makeGameObjectTypeId('550e8400-e29b-41d4-a716-446655440000' as Uuid);
const LOOT_ID = makeGameObjectTypeId('550e8400-e29b-41d4-a716-446655440001' as Uuid);
const PLAIN_ID = makeGameObjectTypeId('550e8400-e29b-41d4-a716-446655440002' as Uuid);

const entry = (
  overrides: {
    id?: GameObjectType['id'];
    label?: string;
    family?: string;
    category?: Option.Option<string>;
    components?: GameObjectType['components'];
    origin?: 'plugin' | 'project';
  } = {},
): GameObjectCatalogEntryView => ({
  objectType: new GameObjectType({
    id: overrides.id ?? PLAIN_ID,
    schemaVersion: 1,
    label: overrides.label ?? 'Object',
    family: (overrides.family ?? 'misc') as GameObjectType['family'],
    category: (overrides.category ?? Option.none()) as GameObjectType['category'],
    layerHint: Option.none(),
    components: overrides.components ?? [],
    instanceDefaults: {},
  }),
  origin: overrides.origin ?? 'plugin',
});

describe('projectCatalogPaletteActions', () => {
  it('projects each catalog entry into a sticky palette action carrying the resolved GameObjectTypeId', () => {
    const actions = projectCatalogPaletteActions([
      entry({ id: SPAWN_ID, label: 'Spawn Point', family: 'spawn' }),
    ]);
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    // objectKind is the resolved GameObjectTypeId verbatim — placement stamps it
    // straight onto MapObject.kind (idempotent, no key->id round-trip).
    expect(action.objectKind).toBe(SPAWN_ID);
    expect(action.id).toBe(SPAWN_ID);
    expect(action.label).toBe('Spawn Point');
    expect(action.placement).toBe('sticky');
    expect(action.icon).toBeTruthy();
  });

  it('derives the description from family and optional category', () => {
    const [withCategory] = projectCatalogPaletteActions([
      entry({ family: 'spawn', category: Option.some('gameplay') }),
    ]);
    expect(withCategory!.description).toBe('Spawn · Gameplay');

    const [withoutCategory] = projectCatalogPaletteActions([entry({ family: 'loot' })]);
    expect(withoutCategory!.description).toBe('Loot');
  });

  it('picks a neutral icon per object type and never references a plugin/brand', () => {
    const [spawn] = projectCatalogPaletteActions([
      entry({
        id: SPAWN_ID,
        family: 'spawn',
        components: [new SpawnPointComponent({ data: {} })],
      }),
    ]);
    const [loot] = projectCatalogPaletteActions([
      entry({
        id: LOOT_ID,
        family: 'loot',
        components: [
          new LootSourceComponent({
            lootTableId: Option.none(),
            interactionMode: 'tap',
            grants: {},
          }),
        ],
      }),
    ]);
    const [plain] = projectCatalogPaletteActions([entry({ id: PLAIN_ID, family: 'misc' })]);

    // Distinct components resolve to distinct icons; a component-less type falls
    // back to the shared neutral icon.
    expect(spawn!.icon).not.toBe(loot!.icon);
    expect(plain!.icon).toBeTruthy();
  });

  it('orders actions by family, then category, then label (family-clustered)', () => {
    const actions = projectCatalogPaletteActions([
      entry({ id: LOOT_ID, label: 'Crate', family: 'loot' }),
      entry({ id: SPAWN_ID, label: 'Spawn', family: 'spawn' }),
      entry({ id: PLAIN_ID, label: 'Anchor', family: 'loot' }),
    ]);
    expect(actions.map((action) => action.label)).toEqual(['Anchor', 'Crate', 'Spawn']);
  });
});

describe('groupCatalogPaletteActions', () => {
  it('groups by the open family tag with humanised, deterministically ordered headings', () => {
    const groups = groupCatalogPaletteActions([
      entry({ id: SPAWN_ID, label: 'Spawn', family: 'spawn' }),
      entry({ id: LOOT_ID, label: 'Crate', family: 'loot' }),
      entry({ id: PLAIN_ID, label: 'Anchor', family: 'loot' }),
    ]);
    expect(groups.map((group) => group.id)).toEqual(['loot', 'spawn']);
    expect(groups.map((group) => group.label)).toEqual(['Loot', 'Spawn']);
    expect(groups[0]!.items.map((item) => item.label)).toEqual(['Anchor', 'Crate']);
    expect(groups[1]!.items.map((item) => item.label)).toEqual(['Spawn']);
  });

  it('returns no groups for an empty catalog', () => {
    expect(groupCatalogPaletteActions([])).toEqual([]);
  });
});

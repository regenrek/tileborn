import {
  CollisionFootprintComponent,
  GameObjectType,
  LootSourceComponent,
  MapObject,
  makeGameObjectTypeId,
  makeLayerId,
  makeLootTableId,
  makeObjectId,
  type CategoryTag,
  type FamilyTag,
  type GameObjectComponent,
} from '@tileborne/core';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  LOOT_SOURCE_PROPERTY_KEY,
  buildInstanceOverridesForm,
  findLootSource,
  lootBindingRecord,
  mergeInstanceOverrides,
  mergeLootBinding,
  readInstanceOverrides,
  readLootBinding,
} from './catalog-instance-overrides.js';

const OBJECT_TYPE_ID = makeGameObjectTypeId('11111111-1111-4111-8111-111111111111');
const LOOT_TABLE_ID = makeLootTableId('22222222-2222-4222-8222-222222222222');
const OTHER_LOOT_TABLE_ID = makeLootTableId('33333333-3333-4333-8333-333333333333');

const lootSource = () =>
  new LootSourceComponent({
    lootTableId: Option.some(LOOT_TABLE_ID),
    interactionMode: 'tap',
    grants: { primary: true, bonus: false },
  });

const objectType = (
  components: readonly GameObjectComponent[],
  instanceDefaults = {},
): GameObjectType =>
  new GameObjectType({
    id: OBJECT_TYPE_ID,
    schemaVersion: 1,
    label: 'Loot crate',
    family: 'loot' as FamilyTag,
    category: Option.some('containers' as CategoryTag),
    layerHint: Option.none(),
    components: [...components],
    instanceDefaults,
  });

const mapObject = (properties: MapObject['properties'] = {}): MapObject =>
  new MapObject({
    id: makeObjectId('44444444-4444-4444-8444-444444444444'),
    kind: OBJECT_TYPE_ID,
    x: 32,
    y: 32,
    width: Option.none(),
    height: Option.none(),
    layerId: makeLayerId('55555555-5555-4555-8555-555555555555'),
    properties,
  });

describe('instance overrides form', () => {
  it('derives numeric override fields from the type instanceDefaults', () => {
    const form = buildInstanceOverridesForm(objectType([], { maxUses: 3, note: 'ignored' }));
    expect(form.fields.map((field) => field.key)).toEqual(['maxUses']);
    expect(form.fields[0]?.label).toBe('Max uses');
  });

  it('surfaces the definition default, then the persisted per-instance override', () => {
    const type = objectType([], { maxUses: 3 });
    expect(readInstanceOverrides(mapObject(), type)).toEqual({ maxUses: 3 });
    expect(readInstanceOverrides(mapObject({ maxUses: 9 }), type)).toEqual({ maxUses: 9 });
  });

  it('rejects an invalid numeric draft and parses a valid one', () => {
    const form = buildInstanceOverridesForm(objectType([], { maxUses: 3 }));
    expect(form.parseDraft({ maxUses: 'abc' })).toBeUndefined();
    expect(form.parseDraft({ maxUses: '' })).toBeUndefined();
    expect(form.parseDraft({ maxUses: '7' })).toEqual({ maxUses: 7 });
  });

  it('merges overrides onto properties without mutating the input object', () => {
    const object = mapObject({ existing: 'keep' });
    const next = mergeInstanceOverrides(object, { maxUses: 4 });
    expect(next).toEqual({ existing: 'keep', maxUses: 4 });
    expect(object.properties).toEqual({ existing: 'keep' });
  });
});

describe('loot binding', () => {
  it('finds the loot-source component', () => {
    const type = objectType([
      new CollisionFootprintComponent({ source: 'manual', reviewed: true, parts: [] }),
      lootSource(),
    ]);
    expect(findLootSource(type)?._tag).toBe('loot-source');
    expect(findLootSource(objectType([]))).toBeUndefined();
  });

  it('reads definition defaults when no per-instance override exists', () => {
    const binding = readLootBinding(mapObject(), lootSource());
    expect(binding).toEqual({
      lootTableId: LOOT_TABLE_ID,
      interactionMode: 'tap',
      grants: { primary: true, bonus: false },
    });
  });

  it('reads the per-instance override over the definition', () => {
    const object = mapObject({
      [LOOT_SOURCE_PROPERTY_KEY]: {
        lootTableId: OTHER_LOOT_TABLE_ID,
        interactionMode: 'hold',
        grants: { primary: false },
      },
    });
    const binding = readLootBinding(object, lootSource());
    expect(binding.lootTableId).toBe(OTHER_LOOT_TABLE_ID);
    expect(binding.interactionMode).toBe('hold');
    expect(binding.grants).toEqual({ primary: false, bonus: false });
  });

  it('treats a null lootTableId override as inherit/none', () => {
    const object = mapObject({
      [LOOT_SOURCE_PROPERTY_KEY]: { lootTableId: null, interactionMode: 'auto', grants: {} },
    });
    expect(readLootBinding(object, lootSource()).lootTableId).toBeUndefined();
  });

  it('persists the binding without mutating the definition component', () => {
    const source = lootSource();
    const object = mapObject({ keep: 'me' });
    const next = mergeLootBinding(object, {
      lootTableId: OTHER_LOOT_TABLE_ID,
      interactionMode: 'hold',
      grants: { primary: false, bonus: true },
    });
    expect(next.keep).toBe('me');
    expect(next[LOOT_SOURCE_PROPERTY_KEY]).toEqual({
      lootTableId: OTHER_LOOT_TABLE_ID,
      interactionMode: 'hold',
      grants: { primary: false, bonus: true },
    });
    // The catalog definition is read-only content and stays untouched.
    expect(source.grants).toEqual({ primary: true, bonus: false });
    expect(Option.getOrUndefined(source.lootTableId)).toBe(LOOT_TABLE_ID);
    expect(object.properties).toEqual({ keep: 'me' });
  });

  it('serializes inherit (undefined) as an explicit null table id', () => {
    expect(
      lootBindingRecord({ lootTableId: undefined, interactionMode: 'auto', grants: {} }),
    ).toEqual({
      lootTableId: null,
      interactionMode: 'auto',
      grants: {},
    });
  });
});

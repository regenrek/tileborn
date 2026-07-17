import type { Uuid } from '@tileborne/core';
import {
  ItemGrant,
  WeaponGrant,
  makeItemDefinitionId,
  makeWeaponDefinitionId,
} from '@tileborne/core';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { emptyAmmoReserve, addAmmo, ammoAmount } from './ammo.js';
import { applyGrantRef, type GrantTargetState } from './grants.js';
import { makeAmmoKind, makeInventoryItemId } from './ids.js';
import {
  AmmoGranted,
  InventoryRejected,
  InventoryState,
  ItemDropped,
  ItemGranted,
  PickupSpawned,
  WeaponGranted,
  makeInventoryState,
} from './inventory.js';

const ITEM_UUID = '550e8400-e29b-41d4-a716-446655440001' as Uuid;
const WEAPON_UUID = '550e8400-e29b-41d4-a716-446655440002' as Uuid;

const itemDefinitionId = makeItemDefinitionId(ITEM_UUID);
const weaponDefinitionId = makeWeaponDefinitionId(WEAPON_UUID);
const itemGrant = new ItemGrant({ itemId: itemDefinitionId });
const weaponGrant = new WeaponGrant({ weaponId: weaponDefinitionId });

const grantedItem = makeInventoryItemId(itemDefinitionId);
const shells = makeAmmoKind('shells');

const inventory = (capacity: number, slots: readonly string[] = []): InventoryState =>
  Result.getOrElse(makeInventoryState({ capacity, slots: slots.map(makeInventoryItemId) }), () => {
    throw new Error('test inventory must be valid');
  });

const target = (capacity: number, slots: readonly string[] = []): GrantTargetState => ({
  inventory: inventory(capacity, slots),
  ammo: emptyAmmoReserve(),
});

describe('applyGrantRef — item-grant', () => {
  it('stores one copy by default, keyed by the catalog ItemDefinitionId', () => {
    const before = target(2);
    const { state, results } = applyGrantRef(before, itemGrant, { policy: 'reject' });

    expect(state.inventory.slots).toEqual([grantedItem]);
    expect(state.ammo).toBe(before.ammo);
    expect(results).toEqual([new ItemGranted({ item: grantedItem, slot: 0 })]);
    // Immutable: the input state is untouched.
    expect(before.inventory.slots).toEqual([]);
  });

  it('loops grantItem per resolved quantity', () => {
    const { state, results } = applyGrantRef(target(5), itemGrant, {
      policy: 'reject',
      quantity: 3,
    });

    expect(state.inventory.slots).toEqual([grantedItem, grantedItem, grantedItem]);
    expect(results).toEqual([
      new ItemGranted({ item: grantedItem, slot: 0 }),
      new ItemGranted({ item: grantedItem, slot: 1 }),
      new ItemGranted({ item: grantedItem, slot: 2 }),
    ]);
  });

  it('floors a fractional quantity and grants nothing for a non-positive one', () => {
    const fractional = applyGrantRef(target(5), itemGrant, { policy: 'reject', quantity: 2.9 });
    expect(fractional.state.inventory.slots).toHaveLength(2);

    const none = applyGrantRef(target(5), itemGrant, { policy: 'reject', quantity: 0 });
    expect(none.state.inventory.slots).toEqual([]);
    expect(none.results).toEqual([]);
  });

  it('quantity loop interplays with drop-oldest overflow and dropAt', () => {
    const before = target(2, ['held-a']);
    const { state, results } = applyGrantRef(before, itemGrant, {
      policy: 'drop-oldest',
      dropAt: { x: 3, y: 4 },
      quantity: 2,
    });

    const heldA = makeInventoryItemId('held-a');
    expect(state.inventory.slots).toEqual([grantedItem, grantedItem]);
    expect(results).toEqual([
      new ItemGranted({ item: grantedItem, slot: 1 }),
      new ItemDropped({ item: heldA, reason: 'overflow' }),
      new PickupSpawned({ item: heldA, x: 3, y: 4 }),
      new ItemGranted({ item: grantedItem, slot: 1 }),
    ]);
  });

  it('quantity loop under reject policy declines each copy past capacity', () => {
    const { state, results } = applyGrantRef(target(1), itemGrant, {
      policy: 'reject',
      quantity: 3,
    });

    expect(state.inventory.slots).toEqual([grantedItem]);
    expect(results).toEqual([
      new ItemGranted({ item: grantedItem, slot: 0 }),
      new InventoryRejected({ item: grantedItem, reason: 'capacity-full' }),
      new InventoryRejected({ item: grantedItem, reason: 'capacity-full' }),
    ]);
  });

  it('routes an ammo-bearing item grant into the reserve instead of a slot', () => {
    const before = {
      inventory: inventory(2, ['held-a']),
      ammo: addAmmo(emptyAmmoReserve(), shells, 4),
    };
    const { state, results } = applyGrantRef(before, itemGrant, {
      policy: 'reject',
      ammo: { kind: shells, amount: 6 },
    });

    expect(state.inventory).toBe(before.inventory);
    expect(ammoAmount(state.ammo, shells)).toBe(10);
    expect(results).toEqual([new AmmoGranted({ ammoKind: shells, amount: 6, total: 10 })]);
  });

  it('a non-positive ammo amount is a result-free no-op', () => {
    const before = target(2);
    const { state, results } = applyGrantRef(before, itemGrant, {
      policy: 'reject',
      ammo: { kind: shells, amount: 0 },
    });

    expect(state).toBe(before);
    expect(results).toEqual([]);
  });
});

describe('applyGrantRef — weapon-grant', () => {
  it('emits WeaponGranted and never touches inventory or weapon state', () => {
    const before = target(2, ['held-a']);
    const { state, results } = applyGrantRef(before, weaponGrant, { policy: 'reject' });

    expect(state).toBe(before);
    expect(results).toEqual([new WeaponGranted({ weapon: weaponDefinitionId })]);
  });

  it('confers caller-resolved reserve ammo alongside the weapon', () => {
    const { state, results } = applyGrantRef(target(2), weaponGrant, {
      policy: 'reject',
      ammo: { kind: shells, amount: 12.7 },
    });

    expect(ammoAmount(state.ammo, shells)).toBe(12);
    expect(results).toEqual([
      new WeaponGranted({ weapon: weaponDefinitionId }),
      new AmmoGranted({ ammoKind: shells, amount: 12, total: 12 }),
    ]);
  });

  it('ignores quantity for weapon grants', () => {
    const { results } = applyGrantRef(target(2), weaponGrant, { policy: 'reject', quantity: 3 });
    expect(results).toEqual([new WeaponGranted({ weapon: weaponDefinitionId })]);
  });
});

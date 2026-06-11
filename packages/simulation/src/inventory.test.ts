import type { Uuid } from '@tileborne/core';
import { makeWeaponDefinitionId } from '@tileborne/core';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeAmmoKind, makeEquipmentSlotId, makeInventoryItemId } from './ids.js';
import {
  AmmoGranted,
  InvalidInventoryStateError,
  InventoryRejected,
  InventoryResult,
  InventoryState,
  ItemConsumed,
  ItemDropped,
  ItemEquipped,
  ItemGranted,
  ItemUnequipped,
  PickupSpawned,
  WeaponGranted,
  consumeItem,
  dropItem,
  grantItem,
  makeInventoryState,
} from './inventory.js';

const itemA = makeInventoryItemId('item-a');
const itemB = makeInventoryItemId('item-b');
const itemC = makeInventoryItemId('item-c');
const itemD = makeInventoryItemId('item-d');
const slotPrimary = makeEquipmentSlotId('primary');
const ammoLight = makeAmmoKind('light');
const weaponId = makeWeaponDefinitionId('550e8400-e29b-41d4-a716-446655440001' as Uuid);

const inventory = (capacity: number, slots: readonly string[] = []): InventoryState =>
  Result.getOrElse(makeInventoryState({ capacity, slots: slots.map(makeInventoryItemId) }), () => {
    throw new Error('test inventory must be valid');
  });

describe('makeInventoryState', () => {
  it('accepts a structurally valid state', () => {
    const result = makeInventoryState({ capacity: 3, slots: [itemA, itemB] });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('rejects a negative or non-integer capacity', () => {
    const negative = makeInventoryState({ capacity: -1 });
    expect(Result.isFailure(negative)).toBe(true);
    if (Result.isFailure(negative)) {
      expect(negative.failure).toBeInstanceOf(InvalidInventoryStateError);
    }
    expect(Result.isFailure(makeInventoryState({ capacity: 2.5 }))).toBe(true);
  });

  it('rejects more slots than capacity', () => {
    expect(Result.isFailure(makeInventoryState({ capacity: 1, slots: [itemA, itemB] }))).toBe(true);
  });

  it('exposes fullness as a structural property', () => {
    expect(inventory(2, ['item-a']).isFull).toBe(false);
    expect(inventory(2, ['item-a', 'item-b']).isFull).toBe(true);
    expect(inventory(0).isFull).toBe(true);
  });
});

describe('grantItem', () => {
  it('appends to a free slot and reports the landing index', () => {
    const before = inventory(3, ['item-a']);
    const { state, results } = grantItem(before, itemB, { policy: 'reject' });

    expect(state.slots).toEqual([itemA, itemB]);
    expect(results).toEqual([new ItemGranted({ item: itemB, slot: 1 })]);
    // Immutable: the original state is untouched.
    expect(before.slots).toEqual([itemA]);
  });

  it('drop-oldest evicts the oldest slot before granting', () => {
    const before = inventory(2, ['item-a', 'item-b']);
    const { state, results } = grantItem(before, itemC, { policy: 'drop-oldest' });

    expect(state.slots).toEqual([itemB, itemC]);
    expect(results).toEqual([
      new ItemDropped({ item: itemA, reason: 'overflow' }),
      new ItemGranted({ item: itemC, slot: 1 }),
    ]);
  });

  it('drop-oldest spawns a world pickup for the evicted item when dropAt is given', () => {
    const before = inventory(1, ['item-a']);
    const { results } = grantItem(before, itemB, {
      policy: 'drop-oldest',
      dropAt: { x: 4, y: -2 },
    });

    expect(results).toEqual([
      new ItemDropped({ item: itemA, reason: 'overflow' }),
      new PickupSpawned({ item: itemA, x: 4, y: -2 }),
      new ItemGranted({ item: itemB, slot: 0 }),
    ]);
  });

  it('reject policy declines at capacity and leaves the state unchanged', () => {
    const before = inventory(2, ['item-a', 'item-b']);
    const { state, results } = grantItem(before, itemC, { policy: 'reject' });

    expect(state).toBe(before);
    expect(results).toEqual([new InventoryRejected({ item: itemC, reason: 'capacity-full' })]);
  });

  it('rejects on a zero-capacity inventory even under drop-oldest (eviction cannot make room)', () => {
    const before = inventory(0);
    const { state, results } = grantItem(before, itemA, { policy: 'drop-oldest' });

    expect(state).toBe(before);
    expect(results).toEqual([new InventoryRejected({ item: itemA, reason: 'capacity-full' })]);
  });
});

describe('dropItem', () => {
  it('removes the first occurrence and spawns a pickup at the given position', () => {
    const before = inventory(4, ['item-a', 'item-b', 'item-a']);
    const { state, results } = dropItem(before, itemA, { x: 1, y: 2 });

    expect(state.slots).toEqual([itemB, itemA]);
    expect(results).toEqual([
      new ItemDropped({ item: itemA, reason: 'requested' }),
      new PickupSpawned({ item: itemA, x: 1, y: 2 }),
    ]);
  });

  it('omits the pickup spawn when no position is given', () => {
    const { results } = dropItem(inventory(2, ['item-a']), itemA);
    expect(results).toEqual([new ItemDropped({ item: itemA, reason: 'requested' })]);
  });

  it('rejects an item that is not held', () => {
    const before = inventory(2, ['item-a']);
    const { state, results } = dropItem(before, itemD, { x: 0, y: 0 });

    expect(state).toBe(before);
    expect(results).toEqual([new InventoryRejected({ item: itemD, reason: 'not-held' })]);
  });
});

describe('consumeItem', () => {
  it('removes the first occurrence and emits ItemConsumed', () => {
    const before = inventory(3, ['item-a', 'item-b']);
    const { state, results } = consumeItem(before, itemB);

    expect(state.slots).toEqual([itemA]);
    expect(results).toEqual([new ItemConsumed({ item: itemB })]);
  });

  it('rejects an item that is not held', () => {
    const before = inventory(3, ['item-a']);
    const { state, results } = consumeItem(before, itemC);

    expect(state).toBe(before);
    expect(results).toEqual([new InventoryRejected({ item: itemC, reason: 'not-held' })]);
  });
});

describe('schemas', () => {
  it('round-trips InventoryState through encode/decode', () => {
    const state = inventory(3, ['item-a', 'item-b']);
    const encoded = Schema.encodeUnknownSync(InventoryState)(state);
    const decoded = Schema.decodeUnknownSync(InventoryState)(encoded);
    expect(decoded.slots).toEqual(state.slots);
    expect(decoded.capacity).toBe(state.capacity);
  });

  it('round-trips every InventoryResult variant through the union schema', () => {
    const samples = [
      new ItemGranted({ item: itemA, slot: 0 }),
      new ItemDropped({ item: itemA, reason: 'overflow' }),
      new ItemConsumed({ item: itemA }),
      new ItemEquipped({ item: itemA, slot: slotPrimary }),
      new ItemUnequipped({ item: itemA, slot: slotPrimary }),
      new AmmoGranted({ ammoKind: ammoLight, amount: 12, total: 30 }),
      new WeaponGranted({ weapon: weaponId }),
      new PickupSpawned({ item: itemA, x: 1, y: 2 }),
      new InventoryRejected({ item: itemA, reason: 'not-held' }),
    ] as const;
    for (const sample of samples) {
      const encoded = Schema.encodeUnknownSync(InventoryResult)(sample);
      expect(Schema.decodeUnknownSync(InventoryResult)(encoded)._tag).toBe(sample._tag);
    }
  });
});

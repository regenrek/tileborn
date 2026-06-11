import type { Uuid } from '@tileborne/core';
import { makeLootTableId } from '@tileborne/core';
import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { vec2 } from './geometry.js';
import {
  makeCombatEntityId,
  makeEquipmentSlotId,
  makeInventoryItemId,
  type CombatEntityId,
} from './ids.js';
import {
  ConsumeCommand,
  DropCommand,
  EquipCommand,
  EquipmentState,
  EquippedSlot,
  InventoryCommand,
  PickupCommand,
  SwapCommand,
  dropOnDefeat,
  emptyEquipment,
  equippedItem,
  makeActorInventory,
  resolveInventoryCommands,
  type ActorInventory,
} from './inventory-ops.js';
import {
  InventoryRejected,
  InventoryState,
  ItemConsumed,
  ItemDropped,
  ItemEquipped,
  ItemGranted,
  ItemUnequipped,
  PickupSpawned,
  makeInventoryState,
} from './inventory.js';
import { makeRuntimeLootTable, type RuntimeLootTable } from './loot.js';
import { createSeededRng } from './rng.js';

const sword = makeInventoryItemId('sword');
const shield = makeInventoryItemId('shield');
const potion = makeInventoryItemId('potion');
const hand = makeEquipmentSlotId('hand');
const back = makeEquipmentSlotId('back');

const actorOne = makeCombatEntityId(1);
const actorTwo = makeCombatEntityId(2);

const inventory = (capacity: number, slots: readonly string[] = []): InventoryState =>
  Result.getOrElse(makeInventoryState({ capacity, slots: slots.map(makeInventoryItemId) }), () => {
    throw new Error('test inventory must be valid');
  });

const actorWith = (
  capacity: number,
  slots: readonly string[] = [],
  equipment: EquipmentState = emptyEquipment(),
): ActorInventory => makeActorInventory({ inventory: inventory(capacity, slots), equipment });

const actorsOf = (
  ...entries: readonly (readonly [CombatEntityId, ActorInventory])[]
): ReadonlyMap<CombatEntityId, ActorInventory> => new Map(entries);

const TABLE_UUID = '550e8400-e29b-41d4-a716-446655440000' as Uuid;

const lootTable = (
  entries: readonly { item: string; weight: number; quantity?: number }[],
): RuntimeLootTable =>
  Result.getOrElse(
    makeRuntimeLootTable({
      id: makeLootTableId(TABLE_UUID),
      entries: entries.map((entry) => ({
        item: makeInventoryItemId(entry.item),
        weight: entry.weight,
        quantity: entry.quantity ?? 1,
      })),
    }),
    () => {
      throw new Error('test loot table must be valid');
    },
  );

describe('EquipmentState', () => {
  it('reads back the equipped item per open slot id', () => {
    const equipment = new EquipmentState({
      slots: [new EquippedSlot({ slot: hand, item: sword })],
    });
    expect(Option.getOrUndefined(equippedItem(equipment, hand))).toBe(sword);
    expect(Option.isNone(equippedItem(equipment, back))).toBe(true);
  });

  it('round-trips through encode/decode', () => {
    const equipment = new EquipmentState({
      slots: [
        new EquippedSlot({ slot: back, item: shield }),
        new EquippedSlot({ slot: hand, item: sword }),
      ],
    });
    const decoded = Schema.decodeUnknownSync(EquipmentState)(
      Schema.encodeUnknownSync(EquipmentState)(equipment),
    );
    expect(decoded.slots).toEqual(equipment.slots);
  });
});

describe('resolveInventoryCommands — command semantics', () => {
  it('pickup grants into a free slot', () => {
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(2)]),
      commands: [new PickupCommand({ actor: actorOne, sequence: 1, item: potion })],
      policy: 'reject',
    });

    expect(actors.get(actorOne)?.inventory.slots).toEqual([potion]);
    expect(actors.get(actorOne)?.lastSequence).toBe(1);
    expect(results).toEqual([new ItemGranted({ item: potion, slot: 0 })]);
  });

  it('pickup at capacity follows the overflow policy, spawning the evicted item at `at`', () => {
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(1, ['sword'])]),
      commands: [new PickupCommand({ actor: actorOne, sequence: 1, item: potion, at: vec2(5, 6) })],
      policy: 'drop-oldest',
    });

    expect(actors.get(actorOne)?.inventory.slots).toEqual([potion]);
    expect(results).toEqual([
      new ItemDropped({ item: sword, reason: 'overflow' }),
      new PickupSpawned({ item: sword, x: 5, y: 6 }),
      new ItemGranted({ item: potion, slot: 0 }),
    ]);
  });

  it('drop removes the item and spawns a pickup at `at`', () => {
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(2, ['sword', 'potion'])]),
      commands: [new DropCommand({ actor: actorOne, sequence: 1, item: sword, at: vec2(1, 2) })],
      policy: 'reject',
    });

    expect(actors.get(actorOne)?.inventory.slots).toEqual([potion]);
    expect(results).toEqual([
      new ItemDropped({ item: sword, reason: 'requested' }),
      new PickupSpawned({ item: sword, x: 1, y: 2 }),
    ]);
  });

  it('consume removes the item and emits ItemConsumed', () => {
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(2, ['potion'])]),
      commands: [new ConsumeCommand({ actor: actorOne, sequence: 1, item: potion })],
      policy: 'reject',
    });

    expect(actors.get(actorOne)?.inventory.slots).toEqual([]);
    expect(results).toEqual([new ItemConsumed({ item: potion })]);
  });

  it('equip moves a held item into an empty slot', () => {
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(2, ['sword', 'potion'])]),
      commands: [new EquipCommand({ actor: actorOne, sequence: 1, item: sword, slot: hand })],
      policy: 'reject',
    });

    const actor = actors.get(actorOne)!;
    expect(actor.inventory.slots).toEqual([potion]);
    expect(Option.getOrUndefined(equippedItem(actor.equipment, hand))).toBe(sword);
    expect(results).toEqual([new ItemEquipped({ item: sword, slot: hand })]);
  });

  it('equip rejects an item that is not held', () => {
    const before = actorWith(2, ['potion']);
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, before]),
      commands: [new EquipCommand({ actor: actorOne, sequence: 1, item: sword, slot: hand })],
      policy: 'reject',
    });

    expect(actors.get(actorOne)?.inventory).toBe(before.inventory);
    // The sequence is still consumed: the input was seen and answered.
    expect(actors.get(actorOne)?.lastSequence).toBe(1);
    expect(results).toEqual([new InventoryRejected({ item: sword, reason: 'not-held' })]);
  });

  it('equip rejects an occupied slot (swap is the explicit exchange)', () => {
    const equipped = new EquipmentState({
      slots: [new EquippedSlot({ slot: hand, item: shield })],
    });
    const { results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(2, ['sword'], equipped)]),
      commands: [new EquipCommand({ actor: actorOne, sequence: 1, item: sword, slot: hand })],
      policy: 'reject',
    });

    expect(results).toEqual([new InventoryRejected({ item: sword, reason: 'slot-occupied' })]);
  });

  it('swap exchanges with the occupied slot, returning the occupant to the vacated position', () => {
    const equipped = new EquipmentState({
      slots: [new EquippedSlot({ slot: hand, item: shield })],
    });
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(3, ['potion', 'sword'], equipped)]),
      commands: [new SwapCommand({ actor: actorOne, sequence: 1, item: sword, slot: hand })],
      policy: 'reject',
    });

    const actor = actors.get(actorOne)!;
    expect(actor.inventory.slots).toEqual([potion, shield]);
    expect(Option.getOrUndefined(equippedItem(actor.equipment, hand))).toBe(sword);
    expect(results).toEqual([
      new ItemUnequipped({ item: shield, slot: hand }),
      new ItemEquipped({ item: sword, slot: hand }),
    ]);
  });

  it('swap rejects an empty slot and an item that is not held', () => {
    const { results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(2, ['sword'])]),
      commands: [
        new SwapCommand({ actor: actorOne, sequence: 1, item: sword, slot: hand }),
        new SwapCommand({ actor: actorOne, sequence: 2, item: potion, slot: hand }),
      ],
      policy: 'reject',
    });

    expect(results).toEqual([
      new InventoryRejected({ item: sword, reason: 'slot-empty' }),
      new InventoryRejected({ item: potion, reason: 'not-held' }),
    ]);
  });

  it('skips commands for unknown actors', () => {
    const { results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(2)]),
      commands: [new PickupCommand({ actor: actorTwo, sequence: 1, item: potion })],
      policy: 'reject',
    });
    expect(results).toEqual([]);
  });
});

describe('resolveInventoryCommands — sequenced-input semantics', () => {
  it('rejects a stale sequence (at or below lastSequence)', () => {
    const actor = makeActorInventory({ inventory: inventory(2), lastSequence: 5 });
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actor]),
      commands: [
        new PickupCommand({ actor: actorOne, sequence: 4, item: potion }),
        new PickupCommand({ actor: actorOne, sequence: 5, item: potion }),
      ],
      policy: 'reject',
    });

    expect(actors.get(actorOne)?.inventory.slots).toEqual([]);
    expect(actors.get(actorOne)?.lastSequence).toBe(5);
    expect(results).toEqual([]);
  });

  it('consumes a duplicated sequence exactly once', () => {
    const { actors, results } = resolveInventoryCommands({
      actors: actorsOf([actorOne, actorWith(3)]),
      commands: [
        new PickupCommand({ actor: actorOne, sequence: 1, item: potion }),
        new PickupCommand({ actor: actorOne, sequence: 1, item: potion }),
      ],
      policy: 'reject',
    });

    expect(actors.get(actorOne)?.inventory.slots).toEqual([potion]);
    expect(results).toEqual([new ItemGranted({ item: potion, slot: 0 })]);
  });

  it('picks a duplicate-sequence winner independent of arrival order (same tag, different payload)', () => {
    const duplicates = [
      new PickupCommand({ actor: actorOne, sequence: 1, item: sword }),
      new PickupCommand({ actor: actorOne, sequence: 1, item: potion }),
    ];
    const run = (stream: readonly InventoryCommand[]) =>
      resolveInventoryCommands({
        actors: actorsOf([actorOne, actorWith(3)]),
        commands: stream,
        policy: 'reject',
      });

    const forward = run(duplicates);
    const reversed = run([...duplicates].reverse());

    expect(reversed.results).toEqual(forward.results);
    expect(reversed.actors).toEqual(forward.actors);
    expect(forward.actors.get(actorOne)?.inventory.slots).toHaveLength(1);
  });

  it('reordered arrival of the same sequence numbers yields an identical outcome', () => {
    const commands = [
      new PickupCommand({ actor: actorOne, sequence: 1, item: sword }),
      new EquipCommand({ actor: actorOne, sequence: 2, item: sword, slot: hand }),
      new PickupCommand({ actor: actorTwo, sequence: 1, item: potion }),
      new ConsumeCommand({ actor: actorTwo, sequence: 2, item: potion }),
      new PickupCommand({ actor: actorOne, sequence: 3, item: shield }),
    ];
    const run = (stream: readonly InventoryCommand[]) =>
      resolveInventoryCommands({
        actors: actorsOf([actorOne, actorWith(3)], [actorTwo, actorWith(3)]),
        commands: stream,
        policy: 'reject',
      });

    const forward = run(commands);
    const reversed = run([...commands].reverse());

    expect(reversed.results).toEqual(forward.results);
    expect(reversed.actors).toEqual(forward.actors);
    expect(forward.actors.get(actorOne)?.inventory.slots).toEqual([shield]);
    expect(Option.getOrUndefined(equippedItem(forward.actors.get(actorOne)!.equipment, hand))).toBe(
      sword,
    );
    expect(forward.actors.get(actorTwo)?.inventory.slots).toEqual([]);
  });

  it('replays bit-identically: same command stream twice yields identical states and results', () => {
    const commands = [
      new PickupCommand({ actor: actorOne, sequence: 1, item: sword }),
      new PickupCommand({ actor: actorOne, sequence: 2, item: potion, at: vec2(1, 1) }),
      new EquipCommand({ actor: actorOne, sequence: 3, item: sword, slot: hand }),
      new DropCommand({ actor: actorOne, sequence: 4, item: potion, at: vec2(2, 2) }),
    ];
    const run = () =>
      resolveInventoryCommands({
        actors: actorsOf([actorOne, actorWith(2)]),
        commands,
        policy: 'drop-oldest',
      });

    const first = run();
    const second = run();
    expect(second.results).toEqual(first.results);
    expect(second.actors).toEqual(first.actors);
  });
});

describe('dropOnDefeat', () => {
  it('drops every held item as ItemDropped(defeat) + PickupSpawned and empties the inventory', () => {
    const { state, results } = dropOnDefeat(inventory(3, ['sword', 'potion']), { x: 7, y: 8 });

    expect(state.slots).toEqual([]);
    expect(state.capacity).toBe(3);
    expect(results).toEqual([
      new ItemDropped({ item: sword, reason: 'defeat' }),
      new PickupSpawned({ item: sword, x: 7, y: 8 }),
      new ItemDropped({ item: potion, reason: 'defeat' }),
      new PickupSpawned({ item: potion, x: 7, y: 8 }),
    ]);
  });

  it('rolls the caller-resolved drop table once and spawns the entry quantity', () => {
    const table = lootTable([{ item: 'gem', weight: 1, quantity: 2 }]);
    const { results } = dropOnDefeat(
      inventory(2, ['sword']),
      { x: 0, y: 0 },
      {
        table,
        rng: createSeededRng(42),
      },
    );

    const gem = makeInventoryItemId('gem');
    expect(results).toEqual([
      new ItemDropped({ item: sword, reason: 'defeat' }),
      new PickupSpawned({ item: sword, x: 0, y: 0 }),
      new PickupSpawned({ item: gem, x: 0, y: 0 }),
      new PickupSpawned({ item: gem, x: 0, y: 0 }),
    ]);
  });

  it('spawns nothing extra when the table has no rollable entry', () => {
    const table = lootTable([{ item: 'gem', weight: 0 }]);
    const { results } = dropOnDefeat(
      inventory(1),
      { x: 0, y: 0 },
      {
        table,
        rng: createSeededRng(42),
      },
    );
    expect(results).toEqual([]);
  });

  it('replays bit-identically for a fixed seed', () => {
    const table = lootTable([
      { item: 'gem', weight: 3 },
      { item: 'coin', weight: 1, quantity: 5 },
    ]);
    const run = () =>
      dropOnDefeat(
        inventory(2, ['sword']),
        { x: 1, y: 2 },
        {
          table,
          rng: createSeededRng(1234),
        },
      );

    const first = run();
    const second = run();
    expect(second.results).toEqual(first.results);
    expect(second.state).toEqual(first.state);
  });
});

describe('schemas', () => {
  it('round-trips every InventoryCommand variant through the union schema', () => {
    const samples = [
      new PickupCommand({ actor: actorOne, sequence: 1, item: potion, at: vec2(1, 2) }),
      new DropCommand({ actor: actorOne, sequence: 2, item: potion }),
      new ConsumeCommand({ actor: actorOne, sequence: 3, item: potion }),
      new EquipCommand({ actor: actorOne, sequence: 4, item: sword, slot: hand }),
      new SwapCommand({ actor: actorOne, sequence: 5, item: sword, slot: hand }),
    ] as const;
    for (const sample of samples) {
      const encoded = Schema.encodeUnknownSync(InventoryCommand)(sample);
      expect(Schema.decodeUnknownSync(InventoryCommand)(encoded)._tag).toBe(sample._tag);
    }
  });
});

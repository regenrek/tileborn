import { Option, Schema } from 'effect';

import { Vec2, type Vec2Like } from './geometry.js';
import { CombatEntityId, EquipmentSlotId, InventoryItemId } from './ids.js';
import {
  InventoryRejected,
  InventoryState,
  ItemDropped,
  ItemEquipped,
  ItemUnequipped,
  PickupSpawned,
  consumeItem,
  dropItem,
  grantItem,
  type InventoryOpResult,
  type InventoryOverflowPolicy,
  type InventoryResult,
} from './inventory.js';
import { rollLootTable, type RuntimeLootTable } from './loot.js';
import type { SeededRng } from './rng.js';

// ---------------------------------------------------------------------------
// Equipment state (the neutral minimum: equipped item per open slot id)
// ---------------------------------------------------------------------------

/** One occupied equipment slot: which item sits in which open slot id. */
export class EquippedSlot extends Schema.Class<EquippedSlot>('EquippedSlot')({
  slot: EquipmentSlotId,
  item: InventoryItemId,
}) {}

/**
 * Neutral per-entity equipment (ADR-0018 inventory/loot addendum, Slice 2):
 * at most one item per open {@link EquipmentSlotId}. Which slots exist — and
 * which item fits which slot (the catalog's `EquippableComponent.slot`) — is
 * caller-resolved content; the engine only moves items between the inventory
 * and a slot. Entries are kept sorted by slot id (code-unit order) so the
 * state has a single canonical, replay-stable representation.
 */
export class EquipmentState extends Schema.Class<EquipmentState>('EquipmentState')({
  slots: Schema.Array(EquippedSlot),
}) {}

/** Equipment with every slot empty. */
export const emptyEquipment = (): EquipmentState => new EquipmentState({ slots: [] });

/** The item equipped in `slot`, when one is. */
export const equippedItem = (
  equipment: EquipmentState,
  slot: EquipmentSlotId,
): Option.Option<InventoryItemId> =>
  Option.map(
    Option.fromUndefinedOr(equipment.slots.find((entry) => entry.slot === slot)),
    (entry) => entry.item,
  );

const compareEquippedSlots = (a: EquippedSlot, b: EquippedSlot): number =>
  a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0;

const withEquippedItem = (
  equipment: EquipmentState,
  slot: EquipmentSlotId,
  item: InventoryItemId,
): EquipmentState => {
  const others = equipment.slots.filter((entry) => entry.slot !== slot);
  return new EquipmentState({
    slots: [...others, new EquippedSlot({ slot, item })].sort(compareEquippedSlots),
  });
};

// ---------------------------------------------------------------------------
// Sequenced commands
// ---------------------------------------------------------------------------

/** Collect a resolved pickup item into the actor's inventory. */
export class PickupCommand extends Schema.TaggedClass<PickupCommand>()('PickupCommand', {
  actor: CombatEntityId,
  sequence: Schema.Int,
  item: InventoryItemId,
  /** Where an overflow-evicted item materializes (typically the actor position). */
  at: Schema.optional(Vec2),
}) {}

/** Drop a held item, optionally materializing it as a world pickup at `at`. */
export class DropCommand extends Schema.TaggedClass<DropCommand>()('DropCommand', {
  actor: CombatEntityId,
  sequence: Schema.Int,
  item: InventoryItemId,
  at: Schema.optional(Vec2),
}) {}

/** Consume (use up) a held item. */
export class ConsumeCommand extends Schema.TaggedClass<ConsumeCommand>()('ConsumeCommand', {
  actor: CombatEntityId,
  sequence: Schema.Int,
  item: InventoryItemId,
}) {}

/** Move a held item from the inventory into an *empty* equipment slot. */
export class EquipCommand extends Schema.TaggedClass<EquipCommand>()('EquipCommand', {
  actor: CombatEntityId,
  sequence: Schema.Int,
  item: InventoryItemId,
  slot: EquipmentSlotId,
}) {}

/**
 * Exchange a held item with the occupant of an equipment slot: the held item
 * equips, the previous occupant returns to the exact inventory position the
 * held item vacated (so the swap can never overflow).
 */
export class SwapCommand extends Schema.TaggedClass<SwapCommand>()('SwapCommand', {
  actor: CombatEntityId,
  sequence: Schema.Int,
  item: InventoryItemId,
  slot: EquipmentSlotId,
}) {}

/**
 * The neutral sequenced player-command union the authoritative host resolves
 * each tick (ADR-0018 addendum Slice 2: pickup + equip/swap/drop/consume).
 * `sequence` is the per-actor monotonically increasing input sequence number —
 * the neutral form of BR's `RuntimePlayerInput.seq` consume-once discipline.
 */
export type InventoryCommand =
  | PickupCommand
  | DropCommand
  | ConsumeCommand
  | EquipCommand
  | SwapCommand;

/** Schema view of the {@link InventoryCommand} union, for wire/replay round-trips. */
export const InventoryCommand = Schema.Union([
  PickupCommand,
  DropCommand,
  ConsumeCommand,
  EquipCommand,
  SwapCommand,
]);

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

/**
 * Per-actor authoritative inventory state the resolver threads between ticks.
 * `lastSequence` is the highest consumed command sequence; commands at or
 * below it are stale and skipped (the strengthened, neutral form of BR's
 * keyed consume-once sequenced input).
 */
export interface ActorInventory {
  readonly inventory: InventoryState;
  readonly equipment: EquipmentState;
  readonly lastSequence: number;
}

/** Construct an {@link ActorInventory}; a fresh actor has consumed nothing. */
export const makeActorInventory = (fields: {
  readonly inventory: InventoryState;
  readonly equipment?: EquipmentState;
  readonly lastSequence?: number;
}): ActorInventory => ({
  inventory: fields.inventory,
  equipment: fields.equipment ?? emptyEquipment(),
  lastSequence: fields.lastSequence ?? -1,
});

/** Everything {@link resolveInventoryCommands} needs for one resolution pass. */
export interface InventoryCommandInput {
  readonly actors: ReadonlyMap<CombatEntityId, ActorInventory>;
  readonly commands: readonly InventoryCommand[];
  /** Overflow behavior for pickups entering an inventory (plugin content data). */
  readonly policy: InventoryOverflowPolicy;
}

/** New per-actor states plus the ordered result values of the pass. */
export interface InventoryCommandOutcome {
  readonly actors: ReadonlyMap<CombatEntityId, ActorInventory>;
  readonly results: readonly InventoryResult[];
}

// Canonical payload key: makes the duplicate-sequence tiebreak below a TOTAL
// order over the full command, so the winner never depends on arrival order
// even for same-tag commands with different payloads.
const commandPayloadKey = (command: InventoryCommand): string => {
  const slot = 'slot' in command ? command.slot : '';
  const at = 'at' in command && command.at !== undefined ? `${command.at.x},${command.at.y}` : '';
  return `${command.item}|${slot}|${at}`;
};

// Commands are resolved per actor in sequence order; the actor-major sort
// mirrors the combat orchestrator's entity-major intent ordering. Tag and
// payload tiebreaks decide which of two *duplicate-sequence* commands wins,
// arrival-order independently.
const compareCommands = (a: InventoryCommand, b: InventoryCommand): number => {
  if (a.actor !== b.actor) {
    return a.actor - b.actor;
  }
  if (a.sequence !== b.sequence) {
    return a.sequence - b.sequence;
  }
  if (a._tag !== b._tag) {
    return a._tag < b._tag ? -1 : 1;
  }
  const aKey = commandPayloadKey(a);
  const bKey = commandPayloadKey(b);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
};

interface CommandApplication {
  readonly actor: ActorInventory;
  readonly results: readonly InventoryResult[];
}

const withInventory = (actor: ActorInventory, op: InventoryOpResult): CommandApplication => ({
  actor: { ...actor, inventory: op.state },
  results: op.results,
});

const rejected = (
  actor: ActorInventory,
  item: InventoryItemId,
  reason: 'not-held' | 'slot-occupied' | 'slot-empty',
): CommandApplication => ({
  actor,
  results: [new InventoryRejected({ item, reason })],
});

const applyEquip = (actor: ActorInventory, command: EquipCommand): CommandApplication => {
  const index = actor.inventory.slots.indexOf(command.item);
  if (index < 0) {
    return rejected(actor, command.item, 'not-held');
  }
  if (Option.isSome(equippedItem(actor.equipment, command.slot))) {
    return rejected(actor, command.item, 'slot-occupied');
  }
  const slots = actor.inventory.slots.filter((_, position) => position !== index);
  return {
    actor: {
      ...actor,
      inventory: new InventoryState({ slots, capacity: actor.inventory.capacity }),
      equipment: withEquippedItem(actor.equipment, command.slot, command.item),
    },
    results: [new ItemEquipped({ item: command.item, slot: command.slot })],
  };
};

const applySwap = (actor: ActorInventory, command: SwapCommand): CommandApplication => {
  const index = actor.inventory.slots.indexOf(command.item);
  if (index < 0) {
    return rejected(actor, command.item, 'not-held');
  }
  const previous = equippedItem(actor.equipment, command.slot);
  if (Option.isNone(previous)) {
    return rejected(actor, command.item, 'slot-empty');
  }
  const slots = actor.inventory.slots.map((held, position) =>
    position === index ? previous.value : held,
  );
  return {
    actor: {
      ...actor,
      inventory: new InventoryState({ slots, capacity: actor.inventory.capacity }),
      equipment: withEquippedItem(actor.equipment, command.slot, command.item),
    },
    results: [
      new ItemUnequipped({ item: previous.value, slot: command.slot }),
      new ItemEquipped({ item: command.item, slot: command.slot }),
    ],
  };
};

const applyCommand = (
  actor: ActorInventory,
  command: InventoryCommand,
  policy: InventoryOverflowPolicy,
): CommandApplication => {
  switch (command._tag) {
    case 'PickupCommand':
      return withInventory(
        actor,
        grantItem(actor.inventory, command.item, {
          policy,
          ...(command.at === undefined ? {} : { dropAt: command.at }),
        }),
      );
    case 'DropCommand':
      return withInventory(actor, dropItem(actor.inventory, command.item, command.at));
    case 'ConsumeCommand':
      return withInventory(actor, consumeItem(actor.inventory, command.item));
    case 'EquipCommand':
      return applyEquip(actor, command);
    case 'SwapCommand':
      return applySwap(actor, command);
  }
};

/**
 * Authoritative, deterministic resolution of sequenced inventory commands
 * (ADR-0018 addendum Slice 2). Commands are sorted by actor, then sequence
 * (then tag, a stable duplicate tiebreak) before application, so the outcome
 * is independent of arrival order — the same command stream replays
 * bit-identically however it was interleaved on the wire.
 *
 * A command whose sequence is at or below the actor's `lastSequence` is stale
 * (a duplicate or out-of-date input) and is skipped without a result —
 * mirroring how BR's `inventory-loot-system` consumes each sequenced
 * drop/interact input exactly once. A processed command consumes its sequence
 * even when the operation itself is declined ({@link InventoryRejected}): the
 * input was seen and answered. Commands for unknown actors are skipped.
 */
export const resolveInventoryCommands = (input: InventoryCommandInput): InventoryCommandOutcome => {
  const actors = new Map<CombatEntityId, ActorInventory>(
    [...input.actors.entries()].sort(([a], [b]) => a - b),
  );
  const results: InventoryResult[] = [];

  for (const command of [...input.commands].sort(compareCommands)) {
    const actor = actors.get(command.actor);
    if (actor === undefined || command.sequence <= actor.lastSequence) {
      continue;
    }
    const applied = applyCommand(actor, command, input.policy);
    actors.set(command.actor, { ...applied.actor, lastSequence: command.sequence });
    results.push(...applied.results);
  }

  return { actors, results };
};

// ---------------------------------------------------------------------------
// Drop on defeat
// ---------------------------------------------------------------------------

/**
 * Empty a defeated entity's inventory onto the world (ADR-0018 addendum
 * Slice 2; the neutral shape of BR's destroyed-crate drop). Every held item
 * leaves as {@link ItemDropped} (`defeat`) + {@link PickupSpawned} at `at`,
 * in slot order. When the defeated entity's catalog `BreakableComponent`
 * names a drop table, the *caller* resolves the `dropTableId` to a
 * {@link RuntimeLootTable} (the simulation never looks up the catalog) and
 * passes it with the injected RNG: one weighted roll is drawn and the winning
 * entry spawns `quantity` pickups. Returns the emptied inventory.
 */
export const dropOnDefeat = (
  inventory: InventoryState,
  at: Vec2Like,
  loot?: { readonly table: RuntimeLootTable; readonly rng: SeededRng },
): InventoryOpResult => {
  const results: InventoryResult[] = [];
  for (const item of inventory.slots) {
    results.push(new ItemDropped({ item, reason: 'defeat' }));
    results.push(new PickupSpawned({ item, x: at.x, y: at.y }));
  }

  if (loot !== undefined) {
    const rolled = rollLootTable(loot.table, loot.rng);
    if (Option.isSome(rolled)) {
      for (let copy = 0; copy < rolled.value.quantity; copy += 1) {
        results.push(new PickupSpawned({ item: rolled.value.item, x: at.x, y: at.y }));
      }
    }
  }

  return {
    state: new InventoryState({ slots: [], capacity: inventory.capacity }),
    results,
  };
};

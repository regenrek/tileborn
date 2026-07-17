import { Result, Schema } from 'effect';

import type { Vec2Like } from './geometry.js';
import { AmmoKind, EquipmentSlotId, InventoryItemId, WeaponDefinitionId } from './ids.js';

/** Raised when an {@link InventoryState} is constructed with invalid fields. */
export class InvalidInventoryStateError extends Schema.TaggedErrorClass<InvalidInventoryStateError>()(
  'InvalidInventoryStateError',
  {
    message: Schema.String,
  },
) {}

/**
 * Neutral capacity-bounded inventory (ADR-0018 inventory/loot addendum).
 * `slots` holds open {@link InventoryItemId}s in acquisition order (oldest
 * first), so the drop-oldest overflow policy is a structural property of the
 * state, not a hidden convention. The capacity is supplied by the caller —
 * plugin content data, never an engine constant.
 */
export class InventoryState extends Schema.Class<InventoryState>('InventoryState')({
  /** Held item ids, oldest first. */
  slots: Schema.Array(InventoryItemId),
  /** Maximum number of held items (`>= 0`); plugin-supplied, no engine default. */
  capacity: Schema.Int,
}) {
  /** Whether a further grant would overflow the inventory. */
  get isFull(): boolean {
    return this.slots.length >= this.capacity;
  }
}

/**
 * Construct a validated {@link InventoryState}. Enforces only *structural*
 * validity (a non-negative integer capacity, no more slots than capacity) —
 * never balance ranges. Returns an {@link InvalidInventoryStateError} rather
 * than throwing so callers stay total.
 */
export const makeInventoryState = (fields: {
  readonly capacity: number;
  readonly slots?: readonly InventoryItemId[];
}): Result.Result<InventoryState, InvalidInventoryStateError> => {
  const slots = fields.slots ?? [];
  if (!Number.isInteger(fields.capacity) || fields.capacity < 0) {
    return Result.fail(
      new InvalidInventoryStateError({
        message: `capacity must be a non-negative integer (got ${fields.capacity})`,
      }),
    );
  }
  if (slots.length > fields.capacity) {
    return Result.fail(
      new InvalidInventoryStateError({
        message: `slots (${slots.length}) exceed capacity (${fields.capacity})`,
      }),
    );
  }
  return Result.succeed(new InventoryState({ slots, capacity: fields.capacity }));
};

/**
 * What a grant does when the inventory is full. An explicit caller input — the
 * engine ships both behaviors and bakes in neither: `drop-oldest` evicts the
 * oldest slot to make room (the behavior the current BR system hardcodes),
 * `reject` declines the grant and leaves the state unchanged.
 */
export const InventoryOverflowPolicy = Schema.Literals(['drop-oldest', 'reject']);
export type InventoryOverflowPolicy = typeof InventoryOverflowPolicy.Type;

// ---------------------------------------------------------------------------
// Result values (mirroring the combat result-value discipline)
// ---------------------------------------------------------------------------

/** An item entered the inventory; `slot` is the index it landed in. */
export class ItemGranted extends Schema.TaggedClass<ItemGranted>()('ItemGranted', {
  item: InventoryItemId,
  slot: Schema.Int,
}) {}

/** Why an {@link ItemDropped} left the inventory. */
export const ItemDroppedReason = Schema.Literals(['overflow', 'requested', 'defeat']);
export type ItemDroppedReason = typeof ItemDroppedReason.Type;

/** An item left the inventory (evicted by overflow, dropped on request, or spilled on defeat). */
export class ItemDropped extends Schema.TaggedClass<ItemDropped>()('ItemDropped', {
  item: InventoryItemId,
  reason: ItemDroppedReason,
}) {}

/** An item was consumed (used up) and removed from the inventory. */
export class ItemConsumed extends Schema.TaggedClass<ItemConsumed>()('ItemConsumed', {
  item: InventoryItemId,
}) {}

/** A held item moved from the inventory into the named equipment slot. */
export class ItemEquipped extends Schema.TaggedClass<ItemEquipped>()('ItemEquipped', {
  item: InventoryItemId,
  slot: EquipmentSlotId,
}) {}

/** A previously equipped item left its slot (returned to the inventory by a swap). */
export class ItemUnequipped extends Schema.TaggedClass<ItemUnequipped>()('ItemUnequipped', {
  item: InventoryItemId,
  slot: EquipmentSlotId,
}) {}

/**
 * Rounds entered the {@link AmmoReserve}. `amount` is what was actually added
 * (after flooring); `total` is the post-grant stack amount, so the caller can
 * project the reserve without re-reading it.
 */
export class AmmoGranted extends Schema.TaggedClass<AmmoGranted>()('AmmoGranted', {
  ammoKind: AmmoKind,
  amount: Schema.Int,
  total: Schema.Int,
}) {}

/**
 * A weapon grant was collected (ADR-0023 §C `weapon-grant`, applied by
 * `applyGrantRef`). The simulation deliberately does NOT own the equipped
 * weapon here — the caller folds this value into its weapon system (resolving
 * the id to a `WeaponDefinition` and minting a `WeaponState` via
 * `initialWeaponState`), exactly as combat results are folded into the
 * plugin's snapshot. Any reserve ammo the grant confers arrives as a separate
 * {@link AmmoGranted}.
 */
export class WeaponGranted extends Schema.TaggedClass<WeaponGranted>()('WeaponGranted', {
  weapon: WeaponDefinitionId,
}) {}

/**
 * A dropped item materialized as a world pickup at the given position. The
 * caller (game-host / playtest host) spawns the actual pickup entity; this is
 * the neutral instruction value, not the spawn itself.
 */
export class PickupSpawned extends Schema.TaggedClass<PickupSpawned>()('PickupSpawned', {
  item: InventoryItemId,
  x: Schema.Number,
  y: Schema.Number,
}) {}

/** Why an {@link InventoryRejected} declined an operation. */
export const InventoryRejectedReason = Schema.Literals([
  'capacity-full',
  'not-held',
  'slot-occupied',
  'slot-empty',
]);
export type InventoryRejectedReason = typeof InventoryRejectedReason.Type;

/** An inventory operation was declined; the state is unchanged. */
export class InventoryRejected extends Schema.TaggedClass<InventoryRejected>()(
  'InventoryRejected',
  {
    item: InventoryItemId,
    reason: InventoryRejectedReason,
  },
) {}

/**
 * The neutral inventory result-value set (ADR-0018 inventory/loot addendum):
 * every observable thing an inventory operation can produce, as a tagged
 * union. The plugin folds these into its existing snapshot path (ADR-0014) —
 * inventory adds no rendering channel.
 */
export type InventoryResult =
  | ItemGranted
  | ItemDropped
  | ItemConsumed
  | ItemEquipped
  | ItemUnequipped
  | AmmoGranted
  | WeaponGranted
  | PickupSpawned
  | InventoryRejected;

/** Schema view of the {@link InventoryResult} union, for wire/replay round-trips. */
export const InventoryResult = Schema.Union([
  ItemGranted,
  ItemDropped,
  ItemConsumed,
  ItemEquipped,
  ItemUnequipped,
  AmmoGranted,
  WeaponGranted,
  PickupSpawned,
  InventoryRejected,
]);

/** New {@link InventoryState} plus the ordered result values of one operation. */
export interface InventoryOpResult {
  readonly state: InventoryState;
  readonly results: readonly InventoryResult[];
}

// ---------------------------------------------------------------------------
// Operations (pure; the original state is never mutated)
// ---------------------------------------------------------------------------

/** How {@link grantItem} behaves at capacity. */
export interface InventoryGrantOptions {
  readonly policy: InventoryOverflowPolicy;
  /**
   * Where an overflow-evicted item materializes as a world pickup (emitting a
   * {@link PickupSpawned}); absent ⇒ the evicted item is dropped without a
   * spawn instruction.
   */
  readonly dropAt?: Vec2Like;
}

/**
 * Grant an item against the inventory. Pure and total: a full inventory either
 * evicts its oldest slot (`drop-oldest`, emitting {@link ItemDropped} — plus
 * {@link PickupSpawned} when `dropAt` is given — before {@link ItemGranted})
 * or declines with {@link InventoryRejected} (`reject`, or a zero-capacity
 * inventory, where eviction cannot make room).
 */
export const grantItem = (
  state: InventoryState,
  item: InventoryItemId,
  options: InventoryGrantOptions,
): InventoryOpResult => {
  if (state.slots.length < state.capacity) {
    return {
      state: new InventoryState({ slots: [...state.slots, item], capacity: state.capacity }),
      results: [new ItemGranted({ item, slot: state.slots.length })],
    };
  }

  if (options.policy === 'reject' || state.capacity <= 0) {
    return { state, results: [new InventoryRejected({ item, reason: 'capacity-full' })] };
  }

  const [oldest, ...rest] = state.slots;
  const results: InventoryResult[] = [new ItemDropped({ item: oldest!, reason: 'overflow' })];
  if (options.dropAt !== undefined) {
    results.push(new PickupSpawned({ item: oldest!, x: options.dropAt.x, y: options.dropAt.y }));
  }
  results.push(new ItemGranted({ item, slot: rest.length }));
  return {
    state: new InventoryState({ slots: [...rest, item], capacity: state.capacity }),
    results,
  };
};

/**
 * Drop a held item on request, optionally materializing it as a world pickup
 * at `at` ({@link PickupSpawned}). An item that is not held yields
 * {@link InventoryRejected} (`not-held`) with the state unchanged. Only the
 * first occurrence is removed.
 */
export const dropItem = (
  state: InventoryState,
  item: InventoryItemId,
  at?: Vec2Like,
): InventoryOpResult => {
  const index = state.slots.indexOf(item);
  if (index < 0) {
    return { state, results: [new InventoryRejected({ item, reason: 'not-held' })] };
  }

  const slots = state.slots.filter((_, slot) => slot !== index);
  const results: InventoryResult[] = [new ItemDropped({ item, reason: 'requested' })];
  if (at !== undefined) {
    results.push(new PickupSpawned({ item, x: at.x, y: at.y }));
  }
  return { state: new InventoryState({ slots, capacity: state.capacity }), results };
};

/**
 * Consume (use up) a held item, removing its first occurrence and emitting
 * {@link ItemConsumed}. An item that is not held yields
 * {@link InventoryRejected} (`not-held`) with the state unchanged.
 */
export const consumeItem = (state: InventoryState, item: InventoryItemId): InventoryOpResult => {
  const index = state.slots.indexOf(item);
  if (index < 0) {
    return { state, results: [new InventoryRejected({ item, reason: 'not-held' })] };
  }

  const slots = state.slots.filter((_, slot) => slot !== index);
  return {
    state: new InventoryState({ slots, capacity: state.capacity }),
    results: [new ItemConsumed({ item })],
  };
};

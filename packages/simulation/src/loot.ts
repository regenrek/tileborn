import { LootTableId } from '@tileborne/core';
import { Option, Result, Schema } from 'effect';

import { distance, type Vec2Like } from './geometry.js';
import { CombatEntityId, InventoryItemId } from './ids.js';
import type { SeededRng } from './rng.js';

/** Raised when a {@link RuntimeLootTable} is constructed with invalid fields. */
export class InvalidRuntimeLootTableError extends Schema.TaggedErrorClass<InvalidRuntimeLootTableError>()(
  'InvalidRuntimeLootTableError',
  {
    message: Schema.String,
  },
) {}

/**
 * One weighted loot outcome: which open item id a winning roll grants and how
 * many. The weight is relative (normalized against the table total at roll
 * time); the values are plugin content data, never engine balance.
 */
export class RuntimeLootTableEntry extends Schema.Class<RuntimeLootTableEntry>(
  'RuntimeLootTableEntry',
)({
  item: InventoryItemId,
  /** Relative roll weight (`>= 0`; `0` = never rolled). */
  weight: Schema.Number,
  /** Items granted by a winning roll (`>= 1`). */
  quantity: Schema.Int,
}) {}

/**
 * The neutral *runtime input* shape of a loot table the simulation rolls
 * against, keyed by the catalog's branded {@link LootTableId} (ADR-0019). The
 * catalog's durable `LootTable` deliberately keeps its `entries` open
 * (`JsonObject[]`, plugin-defined); the plugin decodes its own entry content
 * into this typed shape before handing it to {@link rollLootTable} — the
 * simulation references the catalog by id and never redefines its structure.
 */
export class RuntimeLootTable extends Schema.Class<RuntimeLootTable>('RuntimeLootTable')({
  id: LootTableId,
  /** Entries in authored order (the roll's deterministic scan order). */
  entries: Schema.Array(RuntimeLootTableEntry),
}) {}

/**
 * Construct a validated {@link RuntimeLootTable}. Enforces only *structural*
 * validity (finite non-negative weights, positive integer quantities) — never
 * balance ranges. Returns an {@link InvalidRuntimeLootTableError} rather than
 * throwing so callers stay total.
 */
export const makeRuntimeLootTable = (fields: {
  readonly id: LootTableId;
  readonly entries: readonly {
    readonly item: InventoryItemId;
    readonly weight: number;
    readonly quantity: number;
  }[];
}): Result.Result<RuntimeLootTable, InvalidRuntimeLootTableError> => {
  for (const [index, entry] of fields.entries.entries()) {
    if (!Number.isFinite(entry.weight) || entry.weight < 0) {
      return Result.fail(
        new InvalidRuntimeLootTableError({
          message: `entries[${index}].weight must be a finite, non-negative number (got ${entry.weight})`,
        }),
      );
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
      return Result.fail(
        new InvalidRuntimeLootTableError({
          message: `entries[${index}].quantity must be an integer >= 1 (got ${entry.quantity})`,
        }),
      );
    }
  }
  return Result.succeed(
    new RuntimeLootTable({
      id: fields.id,
      entries: fields.entries.map((entry) => new RuntimeLootTableEntry(entry)),
    }),
  );
};

/**
 * Weighted loot roll. Draws a single float from the injected {@link SeededRng}
 * (the sole entropy source) and scans the entries in authored order, so a
 * fixed seed replays bit-identically. A table with no positive-weight entry
 * yields `None` — the engine ships no fallback item (that would be a brand /
 * balance literal); the caller decides what an empty roll means.
 */
export const rollLootTable = (
  table: RuntimeLootTable,
  rng: SeededRng,
): Option.Option<RuntimeLootTableEntry> => {
  const totalWeight = table.entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return Option.none();
  }

  const target = rng.nextFloat() * totalWeight;
  let cursor = 0;
  let lastRollable: RuntimeLootTableEntry | undefined;
  for (const entry of table.entries) {
    const weight = Math.max(0, entry.weight);
    if (weight <= 0) {
      continue;
    }
    lastRollable = entry;
    cursor += weight;
    if (target < cursor) {
      return Option.some(entry);
    }
  }
  // Floating-point accumulation can leave `target` a hair past the final
  // cursor; the last rollable entry is the deterministic owner of that edge.
  return Option.fromUndefinedOr(lastRollable);
};

/** One world pickup offered to {@link resolvePickupCandidates}. */
export interface PickupSource {
  /** Stable pickup identity (sort tiebreaker). */
  readonly id: CombatEntityId;
  readonly position: Vec2Like;
  /**
   * Caller-precomputed distance to the seeker, preferred over the default
   * center-to-center metric when present. Lets a caller rank by a different
   * neutral metric (e.g. the AABB body-gap distance from `aabbGapDistance`)
   * while keeping a single resolver and its radius/sort semantics.
   */
  readonly distance?: number;
  /**
   * Per-pickup interaction radius; the *larger* of this and the query radius
   * wins (a large object stays collectable from its authored reach). Absent ⇒
   * the query radius alone applies.
   */
  readonly radius?: number;
}

/** A pickup within reach, with its resolved distance to the seeker. */
export class PickupCandidate extends Schema.Class<PickupCandidate>('PickupCandidate')({
  id: CombatEntityId,
  distance: Schema.Number,
}) {}

const effectiveRadius = (queryRadius: number, pickup: PickupSource): number => {
  const base = Number.isFinite(queryRadius) ? Math.max(0, queryRadius) : 0;
  const own =
    pickup.radius !== undefined && Number.isFinite(pickup.radius)
      ? Math.max(0, pickup.radius)
      : base;
  return Math.max(base, own);
};

/**
 * Deterministic pickup-candidate resolution: every pickup whose distance to
 * `seeker` is within the effective radius, sorted nearest-first with ties
 * broken by ascending id — so the result is independent of the input order
 * and `candidates[0]` is the canonical "nearest pickup" the current BR system
 * selects. The radius is an explicit caller input (plugin content data, e.g.
 * the value BR hardcodes as `LOOT_PICKUP_RADIUS`); the engine has no default.
 * A pickup carrying a caller-precomputed `distance` is ranked by that value
 * instead of the center metric.
 */
export const resolvePickupCandidates = (
  seeker: Vec2Like,
  pickups: readonly PickupSource[],
  queryRadius: number,
): readonly PickupCandidate[] => {
  const candidates: PickupCandidate[] = [];
  for (const pickup of pickups) {
    const reach = pickup.distance ?? distance(seeker, pickup.position);
    if (reach <= effectiveRadius(queryRadius, pickup)) {
      candidates.push(new PickupCandidate({ id: pickup.id, distance: reach }));
    }
  }
  return candidates.sort((a, b) =>
    a.distance !== b.distance ? a.distance - b.distance : a.id - b.id,
  );
};

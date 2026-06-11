import type { Uuid } from '@tileborne/core';
import { makeLootTableId } from '@tileborne/core';
import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeCombatEntityId, makeInventoryItemId } from './ids.js';
import {
  InvalidRuntimeLootTableError,
  RuntimeLootTable,
  PickupCandidate,
  makeRuntimeLootTable,
  resolvePickupCandidates,
  rollLootTable,
  type PickupSource,
} from './loot.js';
import { createSeededRng } from './rng.js';

const TABLE_UUID = '550e8400-e29b-41d4-a716-446655440000' as Uuid;
const tableId = makeLootTableId(TABLE_UUID);

const table = (
  entries: readonly { item: string; weight: number; quantity?: number }[],
): RuntimeLootTable =>
  Result.getOrElse(
    makeRuntimeLootTable({
      id: tableId,
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

describe('makeRuntimeLootTable', () => {
  it('accepts a structurally valid table', () => {
    const result = makeRuntimeLootTable({
      id: tableId,
      entries: [{ item: makeInventoryItemId('a'), weight: 2.5, quantity: 3 }],
    });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('rejects negative or non-finite weights', () => {
    const negative = makeRuntimeLootTable({
      id: tableId,
      entries: [{ item: makeInventoryItemId('a'), weight: -1, quantity: 1 }],
    });
    expect(Result.isFailure(negative)).toBe(true);
    if (Result.isFailure(negative)) {
      expect(negative.failure).toBeInstanceOf(InvalidRuntimeLootTableError);
    }
    expect(
      Result.isFailure(
        makeRuntimeLootTable({
          id: tableId,
          entries: [{ item: makeInventoryItemId('a'), weight: Number.NaN, quantity: 1 }],
        }),
      ),
    ).toBe(true);
  });

  it('rejects a non-positive or non-integer quantity', () => {
    expect(
      Result.isFailure(
        makeRuntimeLootTable({
          id: tableId,
          entries: [{ item: makeInventoryItemId('a'), weight: 1, quantity: 0 }],
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        makeRuntimeLootTable({
          id: tableId,
          entries: [{ item: makeInventoryItemId('a'), weight: 1, quantity: 1.5 }],
        }),
      ),
    ).toBe(true);
  });
});

describe('rollLootTable', () => {
  it('replays an identical roll sequence for the same seed', () => {
    const weighted = table([
      { item: 'a', weight: 1 },
      { item: 'b', weight: 3 },
      { item: 'c', weight: 6 },
    ]);
    const roll = (seed: number, count: number): readonly string[] => {
      const rng = createSeededRng(seed);
      return Array.from({ length: count }, () =>
        Option.getOrThrow(rollLootTable(weighted, rng)).item.toString(),
      );
    };
    expect(roll(1234, 64)).toEqual(roll(1234, 64));
    expect(roll(1, 64)).not.toEqual(roll(2, 64));
  });

  it('pins the seeded distribution: heavier entries win proportionally more often', () => {
    const weighted = table([
      { item: 'a', weight: 1 },
      { item: 'b', weight: 3 },
      { item: 'c', weight: 6 },
    ]);
    const rng = createSeededRng(1234);
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i += 1) {
      const item = Option.getOrThrow(rollLootTable(weighted, rng)).item.toString();
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    // Exact counts for seed 1234 — any change to the roll algorithm or RNG
    // consumption order is a determinism regression and must fail here.
    expect(Object.fromEntries(counts)).toEqual({ a: 40, b: 222, c: 738 });
    expect(counts.get('a')!).toBeLessThan(counts.get('b')!);
    expect(counts.get('b')!).toBeLessThan(counts.get('c')!);
  });

  it('never selects a zero-weight entry', () => {
    const weighted = table([
      { item: 'never', weight: 0 },
      { item: 'always', weight: 2 },
    ]);
    const rng = createSeededRng(7);
    for (let i = 0; i < 200; i += 1) {
      expect(Option.getOrThrow(rollLootTable(weighted, rng)).item).toBe(
        makeInventoryItemId('always'),
      );
    }
  });

  it('yields None for an empty table or an all-zero-weight table (no engine fallback item)', () => {
    const rng = createSeededRng(7);
    expect(Option.isNone(rollLootTable(table([]), rng))).toBe(true);
    expect(
      Option.isNone(
        rollLootTable(
          table([
            { item: 'a', weight: 0 },
            { item: 'b', weight: 0 },
          ]),
          rng,
        ),
      ),
    ).toBe(true);
    // A no-roll table consumes no entropy, so a subsequent roll is unaffected.
    const reference = createSeededRng(7);
    expect(rng.nextUint32()).toBe(reference.nextUint32());
  });

  it('round-trips RuntimeLootTable through encode/decode', () => {
    const weighted = table([{ item: 'a', weight: 2, quantity: 3 }]);
    const encoded = Schema.encodeUnknownSync(RuntimeLootTable)(weighted);
    const decoded = Schema.decodeUnknownSync(RuntimeLootTable)(encoded);
    expect(decoded.id).toBe(weighted.id);
    expect(decoded.entries).toEqual(weighted.entries);
  });
});

describe('resolvePickupCandidates', () => {
  const pickup = (id: number, x: number, y: number, radius?: number): PickupSource => ({
    id: makeCombatEntityId(id),
    position: { x, y },
    ...(radius === undefined ? {} : { radius }),
  });

  it('returns in-range pickups sorted nearest-first', () => {
    const candidates = resolvePickupCandidates(
      { x: 0, y: 0 },
      [pickup(1, 5, 0), pickup(2, 3, 0), pickup(3, 100, 0)],
      10,
    );
    expect(candidates).toEqual([
      new PickupCandidate({ id: makeCombatEntityId(2), distance: 3 }),
      new PickupCandidate({ id: makeCombatEntityId(1), distance: 5 }),
    ]);
  });

  it('breaks distance ties by ascending id, independent of input order', () => {
    const tied = [pickup(9, 0, 4), pickup(2, 4, 0), pickup(5, -4, 0)];
    const forward = resolvePickupCandidates({ x: 0, y: 0 }, tied, 6);
    const reversed = resolvePickupCandidates({ x: 0, y: 0 }, [...tied].reverse(), 6);
    expect(forward.map((candidate) => candidate.id)).toEqual([2, 5, 9]);
    expect(forward).toEqual(reversed);
  });

  it('honors a larger per-pickup radius without shrinking the query radius', () => {
    const candidates = resolvePickupCandidates(
      { x: 0, y: 0 },
      [pickup(1, 8, 0, 9), pickup(2, 8, 0, 2), pickup(3, 8, 0)],
      4,
    );
    // Pickup 1 reaches further via its own radius; 2's smaller radius cannot
    // undercut the query radius, but 8 > max(4, 2) still excludes it.
    expect(candidates.map((candidate) => candidate.id)).toEqual([1]);
  });

  it('prefers a caller-precomputed distance over the center metric', () => {
    // Center distance would exclude id 1 (8 > 4) and rank id 2 nearer; the
    // precomputed gap metric inverts both.
    const candidates = resolvePickupCandidates(
      { x: 0, y: 0 },
      [
        { ...pickup(1, 8, 0), distance: 1 },
        { ...pickup(2, 3, 0), distance: 3.5 },
      ],
      4,
    );
    expect(candidates).toEqual([
      new PickupCandidate({ id: makeCombatEntityId(1), distance: 1 }),
      new PickupCandidate({ id: makeCombatEntityId(2), distance: 3.5 }),
    ]);
  });

  it('mixes precomputed and center metrics across pickups deterministically', () => {
    const candidates = resolvePickupCandidates(
      { x: 0, y: 0 },
      [pickup(1, 2, 0), { ...pickup(2, 9, 0), distance: 0 }],
      4,
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual([2, 1]);
  });

  it('treats the boundary as inclusive and a non-finite radius as zero reach', () => {
    expect(resolvePickupCandidates({ x: 0, y: 0 }, [pickup(1, 4, 0)], 4)).toHaveLength(1);
    expect(resolvePickupCandidates({ x: 0, y: 0 }, [pickup(1, 4, 0)], Number.NaN)).toHaveLength(0);
    expect(resolvePickupCandidates({ x: 0, y: 0 }, [pickup(1, 0, 0)], Number.NaN)).toHaveLength(1);
  });
});

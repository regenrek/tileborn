import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeTileId, type Uuid } from '@tileborne/core';

import { VariantFilter, VariantFilterId, TerrainClass } from '../../schemas/index.js';
import { mixSeed, selectVariant, type VariantContext } from '../index.js';

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const decodeVariantFilterId = (value: string) => Schema.decodeUnknownSync(VariantFilterId)(value);
const decodeTerrainClass = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const filterId = decodeVariantFilterId('variant-filter:62656465-0000-4000-8000-000000000005');

const makeFilter = (weights: readonly number[]) =>
  new VariantFilter({
    id: filterId,
    terrainClass: Option.some(decodeTerrainClass('grass')),
    tileIds: [tileId('1'), tileId('2'), tileId('3')],
    weights: [...weights],
    seedSalt: 'layer-0',
    stableAcrossAnimationFrames: true,
  });

const baseContext = (overrides: Partial<VariantContext> = {}): VariantContext => ({
  mapSeed: 42,
  layerId: 'terrain',
  cellX: 0,
  cellY: 0,
  terrainClass: decodeTerrainClass('grass'),
  ...overrides,
});

const selectSequence = (filter: VariantFilter, mapSeed: number | string, cellCount: number) => {
  const sequence: ReturnType<typeof selectVariant>[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    sequence.push(
      selectVariant(filter, {
        mapSeed,
        layerId: 'terrain',
        cellX: index % 32,
        cellY: Math.floor(index / 32),
        terrainClass: decodeTerrainClass('grass'),
      }),
    );
  }
  return sequence;
};

describe('mixSeed', () => {
  it('is stable for the same inputs', () => {
    const terrain = decodeTerrainClass('grass');
    const first = mixSeed(42, 'terrain', 3, 7, terrain, 'layer-0');
    const second = mixSeed(42, 'terrain', 3, 7, terrain, 'layer-0');
    expect(first).toBe(second);
  });

  it('changes when seed salt or coordinates change', () => {
    const terrain = decodeTerrainClass('grass');
    const base = mixSeed(42, 'terrain', 3, 7, terrain, 'layer-0');
    expect(mixSeed(43, 'terrain', 3, 7, terrain, 'layer-0')).not.toBe(base);
    expect(mixSeed(42, 'terrain', 4, 7, terrain, 'layer-0')).not.toBe(base);
    expect(mixSeed(42, 'terrain', 3, 7, terrain, 'layer-1')).not.toBe(base);
  });
});

describe('selectVariant', () => {
  it('replays an identical 1000-cell sequence across two runs', () => {
    const filter = makeFilter([1, 1, 1]);
    const firstRun = selectSequence(filter, 1337, 1000);
    const secondRun = selectSequence(filter, 1337, 1000);

    expect(secondRun).toEqual(firstRun);
  });

  it('produces a different distribution for a different map seed', () => {
    const filter = makeFilter([1, 1, 1]);
    const firstCounts = countByIndex(selectSequence(filter, 111, 900));
    const secondCounts = countByIndex(selectSequence(filter, 222, 900));

    expect(firstCounts).not.toEqual(secondCounts);
    expectBucketSpread(firstCounts, 3, 900);
    expectBucketSpread(secondCounts, 3, 900);
  });

  it('ignores animation time for the same cell', () => {
    const filter = makeFilter([2, 3, 5]);
    const context = baseContext({ cellX: 5, cellY: 9 });

    const withoutTime = selectVariant(filter, context);
    const earlyTime = selectVariant(filter, { ...context, timeMs: 0 });
    const lateTime = selectVariant(filter, { ...context, timeMs: 999_999 });

    expect(earlyTime.tileId).toBe(withoutTime.tileId);
    expect(lateTime.tileId).toBe(withoutTime.tileId);
    expect(earlyTime.index).toBe(withoutTime.index);
    expect(lateTime.weight).toBe(withoutTime.weight);
  });

  it('never selects a zero-weight variant', () => {
    const filter = makeFilter([0, 5, 0]);
    const counts = countByIndex(selectSequence(filter, 9001, 500));

    expect(counts.get(0)).toBeUndefined();
    expect(counts.get(2)).toBeUndefined();
    expect(counts.get(1)).toBe(500);
  });

  it('reports negative weights and excludes them from selection', () => {
    const filter = makeFilter([1, -2, 4]);
    const result = selectVariant(filter, baseContext());

    expect(result.diagnostics.some((d) => d._tag === 'VariantWeightOutOfRange')).toBe(true);
    expect(result.index).not.toBe(1);

    const counts = countByIndex(selectSequence(filter, 77, 200));
    expect(counts.get(1)).toBeUndefined();
  });

  it('falls back with a diagnostic when all weights are zero', () => {
    const filter = makeFilter([0, 0, 0]);
    const result = selectVariant(filter, baseContext());

    expect(result.tileId).toBe(tileId('1'));
    expect(result.index).toBe(0);
    expect(result.weight).toBe(0);
    expect(result.diagnostics.some((d) => d._tag === 'EmptyVariantSelection')).toBe(true);
  });
});

const countByIndex = (results: ReturnType<typeof selectVariant>[]) => {
  const counts = new Map<number, number>();
  for (const result of results) {
    counts.set(result.index, (counts.get(result.index) ?? 0) + 1);
  }
  return counts;
};

const expectBucketSpread = (counts: Map<number, number>, bucketCount: number, total: number) => {
  expect(counts.size).toBe(bucketCount);
  const expected = total / bucketCount;
  const tolerance = expected * 0.35;
  for (const count of counts.values()) {
    expect(count).toBeGreaterThan(expected - tolerance);
    expect(count).toBeLessThan(expected + tolerance);
  }
};

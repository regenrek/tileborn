import { describe, expect, it } from 'vitest';

import { SnapshotEntityStore, type SnapshotFrameMerger } from './snapshot-entity-store.js';

type TestEntity = {
  readonly id: string;
  readonly x: number;
};

type TestFullState = {
  readonly serverTimestampMs: number;
  readonly entities: readonly TestEntity[];
};

type TestFrame =
  | {
      readonly kind: 'welcome';
      readonly serverTimestampMs: number;
      readonly entities: readonly TestEntity[];
    }
  | {
      readonly kind: 'delta';
      readonly serverTimestampMs: number;
      readonly updated: readonly TestEntity[];
      readonly removed: readonly string[];
    };

const isTestFullState = (value: unknown): value is TestFullState =>
  typeof value === 'object' &&
  value !== null &&
  'entities' in value &&
  Array.isArray(value.entities);

const isTestFrame = (value: unknown): value is TestFrame =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  (value.kind === 'welcome' || value.kind === 'delta');

const mergeFrame: SnapshotFrameMerger = (previous, frame): TestFullState | undefined => {
  if (!isTestFrame(frame)) {
    return isTestFullState(previous) ? previous : undefined;
  }
  if (frame.kind === 'welcome') {
    return {
      serverTimestampMs: frame.serverTimestampMs,
      entities: frame.entities,
    };
  }

  const entities = new Map(
    isTestFullState(previous) ? previous.entities.map((entity) => [entity.id, entity]) : [],
  );
  for (const id of frame.removed) {
    entities.delete(id);
  }
  for (const entity of frame.updated) {
    entities.set(entity.id, entity);
  }
  return {
    serverTimestampMs: frame.serverTimestampMs,
    entities: [...entities.values()],
  };
};

describe('SnapshotEntityStore', () => {
  it('merges frames into previous/current full states without re-projecting', () => {
    const store = new SnapshotEntityStore(mergeFrame);

    store.apply({
      kind: 'welcome',
      serverTimestampMs: 100,
      entities: [
        { id: 'player-1', x: 10 },
        { id: 'player-2', x: 20 },
      ],
    });
    const firstFullState = store.getCurrentFullState();

    store.apply({
      kind: 'delta',
      serverTimestampMs: 150,
      updated: [{ id: 'player-1', x: 11 }],
      removed: ['player-2'],
    });

    expect(store.getPreviousFullState()).toBe(firstFullState);
    expect(store.getPreviousServerTimestamp()).toBe(100);
    expect(store.getCurrentServerTimestamp()).toBe(150);
    expect(store.previousById().get('player-2')).toMatchObject({ id: 'player-2', x: 20 });
    expect(store.getCurrentFullState()).toMatchObject({
      entities: [{ id: 'player-1', x: 11 }],
    });
  });

  it('keeps expected previous/current deltas across welcome, update, and removal', () => {
    const store = new SnapshotEntityStore(mergeFrame);

    store.apply({
      kind: 'welcome',
      serverTimestampMs: 0,
      entities: [
        { id: 'player-1', x: 0 },
        { id: 'player-2', x: 10 },
      ],
    });
    store.apply({
      kind: 'delta',
      serverTimestampMs: 50,
      updated: [{ id: 'player-1', x: 5 }],
      removed: [],
    });
    store.apply({
      kind: 'delta',
      serverTimestampMs: 100,
      updated: [],
      removed: ['player-2'],
    });

    expect(store.getPreviousFullState()).toMatchObject({
      entities: [
        { id: 'player-1', x: 5 },
        { id: 'player-2', x: 10 },
      ],
    });
    expect(store.getCurrentFullState()).toMatchObject({
      entities: [{ id: 'player-1', x: 5 }],
    });
    expect(store.previousById().has('player-2')).toBe(true);
  });

  it('samples opt-in interpolation using the same delayed alpha contract', () => {
    const store = new SnapshotEntityStore(mergeFrame, { enableInterpolation: true });
    store.apply({ kind: 'welcome', serverTimestampMs: 1000, entities: [{ id: 'a', x: 1 }] }, 10);
    store.apply(
      {
        kind: 'delta',
        serverTimestampMs: 1050,
        updated: [{ id: 'a', x: 2 }],
        removed: [],
      },
      60,
    );

    expect(store.sampleInterpolatedFullState(135)).toEqual({
      previous: { serverTimestampMs: 1000, entities: [{ id: 'a', x: 1 }] },
      current: { serverTimestampMs: 1050, entities: [{ id: 'a', x: 2 }] },
      alpha: 0.5,
    });
  });

  it('translates client sample time into server time before interpolation', () => {
    const store = new SnapshotEntityStore(mergeFrame, { enableInterpolation: true });
    for (const serverTimestampMs of [0, 50, 100, 150]) {
      store.apply(
        {
          kind: serverTimestampMs === 0 ? 'welcome' : 'delta',
          serverTimestampMs,
          ...(serverTimestampMs === 0
            ? { entities: [{ id: 'player-1', x: 0 }] }
            : { updated: [{ id: 'player-1', x: serverTimestampMs }], removed: [] }),
        },
        1000 + serverTimestampMs,
      );
    }

    expect(store.sampleInterpolatedFullState(1225)).toMatchObject({
      previous: { serverTimestampMs: 100, entities: [{ id: 'player-1', x: 100 }] },
      current: { serverTimestampMs: 150, entities: [{ id: 'player-1', x: 150 }] },
      alpha: 0.5,
    });
  });
});

import { describe, expect, it } from 'vitest';

import { SnapshotEntityStore } from './snapshot-entity-store.js';
import { SnapshotInterpolator } from './snapshot-interpolator.js';

const snapshots = [
  { id: 'snapshot-1000' },
  { id: 'snapshot-1050' },
  { id: 'snapshot-1100' },
  { id: 'snapshot-1150' },
] as const;

describe('SnapshotInterpolator', () => {
  it('samples the two snapshots surrounding the delayed target time', () => {
    const interpolator = new SnapshotInterpolator();
    interpolator.push(1000, snapshots[0]);
    interpolator.push(1050, snapshots[1]);
    interpolator.push(1100, snapshots[2]);
    interpolator.push(1150, snapshots[3]);

    expect(interpolator.sample(1125)).toEqual({
      previous: snapshots[0],
      current: snapshots[1],
      alpha: 0.5,
    });
    expect(interpolator.sample(1200)).toEqual({
      previous: snapshots[1],
      current: snapshots[2],
      alpha: 1,
    });
    expect(interpolator.sample(1225)).toEqual({
      previous: snapshots[2],
      current: snapshots[3],
      alpha: 0.5,
    });
  });

  it('clamps alpha at the retained buffer edges', () => {
    const interpolator = new SnapshotInterpolator();
    interpolator.push(1000, snapshots[0]);
    interpolator.push(1050, snapshots[1]);
    interpolator.push(1100, snapshots[2]);
    interpolator.push(1150, snapshots[3]);

    expect(interpolator.sample(1075)).toEqual({
      previous: snapshots[0],
      current: snapshots[1],
      alpha: 0,
    });
    expect(interpolator.sample(1300)).toEqual({
      previous: snapshots[2],
      current: snapshots[3],
      alpha: 1,
    });
  });

  it('supports custom interpolation delay', () => {
    const interpolator = new SnapshotInterpolator();
    interpolator.setInterpolationDelayMs(50);
    interpolator.push(1000, snapshots[0]);
    interpolator.push(1050, snapshots[1]);
    interpolator.push(1100, snapshots[2]);
    interpolator.push(1150, snapshots[3]);

    expect(interpolator.sample(1125)).toEqual({
      previous: snapshots[1],
      current: snapshots[2],
      alpha: 0.5,
    });
  });

  it('returns undefined until two snapshots are buffered and after clear', () => {
    const interpolator = new SnapshotInterpolator();
    expect(interpolator.sample(1125)).toBeUndefined();

    interpolator.push(1000, snapshots[0]);
    expect(interpolator.sample(1125)).toBeUndefined();

    interpolator.push(1050, snapshots[1]);
    expect(interpolator.sample(1125)).toBeDefined();

    interpolator.clear();
    expect(interpolator.sample(1125)).toBeUndefined();
  });
});

describe('SnapshotEntityStore interpolation opt-in', () => {
  it('samples timestamped merged full states without changing previousById semantics', () => {
    const store = new SnapshotEntityStore((_previous, frame) => frame, {
      enableInterpolation: true,
      getFrameTimestamp: (frame) =>
        typeof frame === 'object' && frame !== null && 'serverTimestampMs' in frame
          ? (frame.serverTimestampMs as number)
          : undefined,
    });
    store.apply({ serverTimestampMs: 1000, players: [{ id: 'player-1', x: 1 }] }, 10);
    store.apply({ serverTimestampMs: 1050, players: [{ id: 'player-1', x: 2 }] }, 60);

    expect(store.sampleInterpolatedFullState(135)).toEqual({
      previous: { serverTimestampMs: 1000, players: [{ id: 'player-1', x: 1 }] },
      current: { serverTimestampMs: 1050, players: [{ id: 'player-1', x: 2 }] },
      alpha: 0.5,
    });
    expect(store.previousById().get('player-1')).toEqual({ id: 'player-1', x: 1 });
  });
});

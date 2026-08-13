import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { buildScriptedInputLog, REPLAY_SEED, runReplayScenario } from './replay-harness.js';
import { MAX_DELTA_SNAPSHOT_BYTES } from '../server/snapshot-emitter.js';

const REPLAY_TICK_COUNT = 300;
const SNAPSHOT_INTERVAL = 30;
const SCRIPTED_INPUT_LOG = buildScriptedInputLog(REPLAY_TICK_COUNT);

describe('deterministic replay', () => {
  it('produces byte-identical periodic and final snapshots across consecutive runs', () => {
    const first = runReplayScenario({
      seed: REPLAY_SEED,
      inputLog: SCRIPTED_INPUT_LOG,
      tickCount: REPLAY_TICK_COUNT,
      snapshotInterval: SNAPSHOT_INTERVAL,
    });
    const second = runReplayScenario({
      seed: REPLAY_SEED,
      inputLog: SCRIPTED_INPUT_LOG,
      tickCount: REPLAY_TICK_COUNT,
      snapshotInterval: SNAPSHOT_INTERVAL,
    });

    expect(first.snapshots).toHaveLength(REPLAY_TICK_COUNT / SNAPSHOT_INTERVAL);
    expect(Buffer.from(first.snapshotBytes)).toEqual(Buffer.from(second.snapshotBytes));
    expect(first.snapshotHashes).toEqual(second.snapshotHashes);
    expect(Buffer.from(first.finalSnapshotBytes)).toEqual(Buffer.from(second.finalSnapshotBytes));
    expect(first.finalSnapshotHash).toBe(second.finalSnapshotHash);
  });

  it('emits byte-identical WelcomeSnapshot and DeltaSnapshot frames across consecutive runs', () => {
    const first = runReplayScenario({
      seed: REPLAY_SEED,
      inputLog: SCRIPTED_INPUT_LOG,
      tickCount: REPLAY_TICK_COUNT,
      snapshotInterval: SNAPSHOT_INTERVAL,
    });
    const second = runReplayScenario({
      seed: REPLAY_SEED,
      inputLog: SCRIPTED_INPUT_LOG,
      tickCount: REPLAY_TICK_COUNT,
      snapshotInterval: SNAPSHOT_INTERVAL,
    });

    const decoded = first.wireSnapshotFrames.map((frame) =>
      BattleRoyaleProtocol.decodeServerMessage(frame),
    );
    const deltaSizes = first.wireSnapshotFrames
      .map((frame, index) => ({ frame, message: decoded[index]! }))
      .filter(({ message }) => message._tag === 'DeltaSnapshot')
      .map(({ frame }) => frame.byteLength);

    expect(decoded[0]?._tag).toBe('WelcomeSnapshot');
    expect(decoded.filter((message) => message._tag === 'DeltaSnapshot')).toHaveLength(
      REPLAY_TICK_COUNT,
    );
    expect(Math.max(...deltaSizes)).toBeLessThan(MAX_DELTA_SNAPSHOT_BYTES);
    expect(Buffer.from(first.wireSnapshotBytes)).toEqual(Buffer.from(second.wireSnapshotBytes));
    expect(first.wireSnapshotFrameSizes).toEqual(second.wireSnapshotFrameSizes);
  });
});

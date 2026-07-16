import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  decodeHostClientFrameView,
  decodeHostServerLifecycleFrame,
} from './host-protocol-bridge.js';

describe('host protocol bridge', () => {
  it('projects GameOver into the plugin-neutral host lifecycle view', () => {
    const bytes = BattleRoyaleProtocol.encodeServerMessage(
      new BattleRoyaleProtocol.GameOver({ winner: BattleRoyaleProtocol.makePlayerId('player-2') }),
    );

    expect(decodeHostServerLifecycleFrame(bytes)).toEqual({
      kind: 'game-over',
      winnerPlayerId: 'player-2',
    });
  });
  it('decodes reload and interact action flags into runtime input', () => {
    const bytes = BattleRoyaleProtocol.encodeClientMessage(
      new BattleRoyaleProtocol.PlayerInput({
        tick: 21,
        seq: 4,
        dir: Option.some(0),
        shoot: false,
        reload: true,
        interact: true,
        drop: false,
        abilities: [BattleRoyaleProtocol.BattleRoyaleAbility.dash],
        aimDeg: Option.none(),
        swapSlot: Option.none(),
      }),
    );

    expect(decodeHostClientFrameView(bytes)).toEqual({
      kind: 'input',
      input: {
        tick: 21,
        seq: 4,
        dir: 0,
        shoot: false,
        reload: true,
        interact: true,
        drop: false,
        abilities: [BattleRoyaleProtocol.BattleRoyaleAbility.dash],
      },
      sortKey: { tick: 21, seq: 4 },
    });
  });

  it('decodes aim and weapon slot fields into runtime input', () => {
    const bytes = BattleRoyaleProtocol.encodeClientMessage(
      new BattleRoyaleProtocol.PlayerInput({
        tick: 22,
        seq: 5,
        dir: Option.none(),
        shoot: true,
        reload: false,
        interact: false,
        drop: true,
        abilities: [BattleRoyaleProtocol.BattleRoyaleAbility.trap],
        aimDeg: Option.some(180),
        swapSlot: Option.some(2),
      }),
    );

    expect(decodeHostClientFrameView(bytes)).toEqual({
      kind: 'input',
      input: {
        tick: 22,
        seq: 5,
        shoot: true,
        reload: false,
        interact: false,
        drop: true,
        abilities: [BattleRoyaleProtocol.BattleRoyaleAbility.trap],
        aimDeg: 180,
        swapSlot: 2,
      },
      sortKey: { tick: 22, seq: 5 },
    });
  });

  it('decodes snapshot acks into transport frames', () => {
    const bytes = BattleRoyaleProtocol.encodeClientMessage(
      new BattleRoyaleProtocol.SnapshotAck({
        tick: 44,
        receivedAtMs: 1_234,
      }),
    );

    expect(decodeHostClientFrameView(bytes)).toEqual({
      kind: 'ack',
      tick: 44,
      receivedAtMs: 1_234,
    });
  });
});

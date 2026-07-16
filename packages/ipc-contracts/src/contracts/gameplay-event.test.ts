import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { GameplayEvent } from './gameplay-event.js';

const WEAPON_ID = 'weapon:550e8400-e29b-41d4-a716-446655440000';
const STATUS_ID = 'status:550e8400-e29b-41d4-a716-446655440001';

describe('GameplayEvent', () => {
  it('round-trips every canonical ADR-0029 variant', () => {
    const samples = [
      {
        _tag: 'WeaponFired',
        tick: 1,
        sourceId: 'player-1',
        weaponId: WEAPON_ID,
        damage: 25,
        ammoRemaining: 4,
      },
      {
        _tag: 'DamageApplied',
        tick: 2,
        targetId: 'player-2',
        sourceId: 'player-1',
        amount: 25,
        healthBefore: 100,
        healthAfter: 75,
      },
      {
        _tag: 'EntityDefeated',
        tick: 3,
        targetId: 'player-2',
        sourceId: 'player-1',
        amount: 75,
        healthBefore: 75,
      },
      {
        _tag: 'ItemGranted',
        tick: 4,
        targetId: 'player-1',
        itemId: 'ammo-box:common',
        slot: 0,
        quantity: 1,
      },
      {
        _tag: 'ItemDropped',
        tick: 5,
        sourceId: 'player-1',
        itemId: 'ammo-box:common',
        reason: 'requested',
      },
      {
        _tag: 'ItemConsumed',
        tick: 6,
        sourceId: 'player-1',
        itemId: 'health-pack:common',
      },
      {
        _tag: 'StatusApplied',
        tick: 7,
        targetId: 'player-2',
        effectId: STATUS_ID,
        sourceId: 'player-1',
      },
      {
        _tag: 'StatusExpired',
        tick: 8,
        targetId: 'player-2',
        effectId: STATUS_ID,
      },
      {
        _tag: 'ZonePhaseChanged',
        tick: 9,
        previousPhase: 'stable',
        phase: 'shrinking',
        secondsRemaining: 30,
      },
      {
        _tag: 'MatchPhaseChanged',
        tick: 10,
        previousPhase: 'running',
        phase: 'finished',
        winnerId: 'player-1',
      },
    ] as const;

    for (const sample of samples) {
      const decoded = Schema.decodeUnknownSync(GameplayEvent)(sample);
      expect(Schema.encodeSync(GameplayEvent)(decoded)).toEqual(sample);
    }
  });
});

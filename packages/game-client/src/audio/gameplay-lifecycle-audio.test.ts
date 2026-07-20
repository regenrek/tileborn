import { describe, expect, it, vi } from 'vitest';

import {
  dispatchGameplayLifecycleAudioEvents,
  runtimeAudioEventsForGameplayEvent,
} from './gameplay-lifecycle-audio.js';

const entityId = (id: string) => id as never;
const itemId = (id: string) => id as never;

describe('gameplay lifecycle audio', () => {
  it('maps neutral gameplay events to runtime audio bindings', () => {
    expect(
      runtimeAudioEventsForGameplayEvent({
        _tag: 'DamageApplied',
        targetId: entityId('player-1'),
        sourceId: entityId('player-2'),
        amount: 12,
        healthBefore: 100,
        healthAfter: 88,
        tick: 4,
      }),
    ).toEqual(['player.hit']);
    expect(
      runtimeAudioEventsForGameplayEvent({
        _tag: 'EntityDefeated',
        targetId: entityId('player-2'),
        sourceId: entityId('player-1'),
        tick: 5,
      }),
    ).toEqual(['player.eliminated']);
    expect(
      runtimeAudioEventsForGameplayEvent({
        _tag: 'ItemGranted',
        targetId: entityId('player-1'),
        itemId: itemId('health-pack:rare'),
        quantity: 1,
        tick: 6,
      }),
    ).toEqual(['item.collect']);
    expect(
      runtimeAudioEventsForGameplayEvent({
        _tag: 'ZonePhaseChanged',
        phase: 'shrinking',
        previousPhase: 'countdown',
        tick: 7,
      }),
    ).toEqual(['environment.zoneWarning']);
    expect(
      runtimeAudioEventsForGameplayEvent({
        _tag: 'MatchPhaseChanged',
        phase: 'finished',
        winnerId: entityId('player-1'),
        tick: 8,
      }),
    ).toEqual(['match.end']);
  });

  it('dispatches each gameplay event once by canonical event key', () => {
    const engine = { playCue: vi.fn() };
    const cues = [
      { id: 'cue:hit', label: 'Hit', busId: 'sfx', defaultVolume: 1, binding: 'player.hit' },
      {
        id: 'cue:zone',
        label: 'Zone',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'environment.zoneWarning',
      },
    ];
    const events = [
      {
        _tag: 'DamageApplied',
        targetId: entityId('player-1'),
        sourceId: entityId('player-2'),
        amount: 12,
        healthBefore: 100,
        healthAfter: 88,
        tick: 4,
      },
      { _tag: 'ZonePhaseChanged', phase: 'countdown', secondsRemaining: 10, tick: 5 },
    ];
    const seenKeys = new Set<string>();

    expect(dispatchGameplayLifecycleAudioEvents({ engine, cues, events, seenKeys })).toEqual([
      'cue:hit',
      'cue:zone',
    ]);
    expect(dispatchGameplayLifecycleAudioEvents({ engine, cues, events, seenKeys })).toEqual([]);
    expect(engine.playCue).toHaveBeenCalledTimes(2);
  });
});

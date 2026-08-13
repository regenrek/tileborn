import { describe, expect, it, vi } from 'vitest';

import {
  dispatchGameplayLifecycleAudioEvents,
  GAMEPLAY_AUDIO_EVENT_KEY_WINDOW,
  runtimeAudioEventsForGameplayEvent,
} from './gameplay-lifecycle-audio.js';

const entityId = (id: string) => id as never;
const itemId = (id: string) => id as never;
const sequenced = <Event extends { readonly tick: number }>(
  events: readonly Event[],
): readonly { readonly sequence: number; readonly event: Event }[] =>
  events.map((event, sequence) => ({ sequence, event }));

describe('gameplay lifecycle audio', () => {
  it('maps neutral gameplay events to runtime audio bindings', () => {
    expect(
      runtimeAudioEventsForGameplayEvent({
        _tag: 'WeaponFired',
        sourceId: entityId('player-1'),
        weaponId: 'weapon:rifle' as never,
        origin: { x: 1, y: 2 },
        direction: { x: 1, y: 0 },
        damage: 25,
        ammoRemaining: 11,
        tick: 3,
      }),
    ).toEqual(['weapon.fire']);
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
      {
        id: 'cue:fire',
        label: 'Fire',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'weapon.fire',
      },
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
        _tag: 'WeaponFired',
        sourceId: entityId('player-1'),
        weaponId: 'weapon:rifle' as never,
        origin: { x: 1, y: 2 },
        direction: { x: 1, y: 0 },
        damage: 25,
        ammoRemaining: 11,
        tick: 3,
      },
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

    expect(
      dispatchGameplayLifecycleAudioEvents({ engine, cues, events: sequenced(events), seenKeys }),
    ).toEqual(['cue:fire', 'cue:hit', 'cue:zone']);
    expect(
      dispatchGameplayLifecycleAudioEvents({ engine, cues, events: sequenced(events), seenKeys }),
    ).toEqual([]);
    expect(engine.playCue).toHaveBeenCalledTimes(3);
  });

  it('does not collapse multiple accepted shots that share one tick', () => {
    const engine = { playCue: vi.fn() };
    const cues = [
      {
        id: 'cue:fire',
        label: 'Fire',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'weapon.fire',
      },
    ];
    const events = [
      {
        _tag: 'WeaponFired',
        sourceId: entityId('player-1'),
        weaponId: 'weapon:rifle' as never,
        origin: { x: 1, y: 2 },
        direction: { x: 1, y: 0 },
        damage: 25,
        ammoRemaining: 11,
        tick: 3,
      },
      {
        _tag: 'WeaponFired',
        sourceId: entityId('player-1'),
        weaponId: 'weapon:rifle' as never,
        origin: { x: 1, y: 2 },
        direction: { x: 1, y: 0 },
        damage: 25,
        ammoRemaining: 10,
        tick: 3,
      },
    ];

    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: sequenced(events),
        seenKeys: new Set<string>(),
      }),
    ).toEqual(['cue:fire', 'cue:fire']);
    expect(engine.playCue).toHaveBeenCalledTimes(2);
  });

  it('dispatches authoritative sequence zero after a synthesized HUD event', () => {
    const engine = { playCue: vi.fn() };
    const cues = [
      {
        id: 'cue:item',
        label: 'Item',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'item.collect',
      },
      {
        id: 'cue:fire',
        label: 'Fire',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'weapon.fire',
      },
    ];
    const seenKeys = new Set<string>();
    const syntheticPickup = {
      _tag: 'ItemGranted' as const,
      targetId: entityId('player-1'),
      itemId: itemId('health-pack:rare'),
      quantity: 1,
      tick: 1,
    };
    const acceptedFire = {
      _tag: 'WeaponFired' as const,
      sourceId: entityId('player-1'),
      weaponId: 'weapon:rifle' as never,
      origin: { x: 1, y: 2 },
      direction: { x: 1, y: 0 },
      damage: 25,
      ammoRemaining: 11,
      tick: 2,
    };

    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: [{ sequence: -1, event: syntheticPickup }],
        seenKeys,
      }),
    ).toEqual(['cue:item']);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: [
          { sequence: -1, event: syntheticPickup },
          { sequence: 0, event: acceptedFire },
        ],
        seenKeys,
      }),
    ).toEqual(['cue:fire']);
    expect(engine.playCue).toHaveBeenCalledTimes(2);
  });

  it('bounds same-tick accepted event keys and suppresses completed-tick replays', () => {
    const engine = { playCue: vi.fn() };
    const cues = [
      {
        id: 'cue:fire',
        label: 'Fire',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'weapon.fire',
      },
    ];
    const events = Array.from({ length: GAMEPLAY_AUDIO_EVENT_KEY_WINDOW * 4 + 2 }, (_, index) => ({
      _tag: 'WeaponFired' as const,
      sourceId: entityId('player-1'),
      weaponId: 'weapon:rifle' as never,
      origin: { x: 1, y: 2 },
      direction: { x: 1, y: 0 },
      damage: 25,
      ammoRemaining: 100 - index,
      tick: 3,
    }));
    const seenKeys = new Set<string>();

    expect(
      dispatchGameplayLifecycleAudioEvents({ engine, cues, events: sequenced(events), seenKeys }),
    ).toEqual(Array.from({ length: events.length }, () => 'cue:fire'));
    expect(seenKeys.size).toBeLessThanOrEqual(GAMEPLAY_AUDIO_EVENT_KEY_WINDOW);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: [{ sequence: 0, event: events[0]! }],
        seenKeys,
      }),
    ).toEqual([]);
    expect(seenKeys.size).toBeLessThanOrEqual(GAMEPLAY_AUDIO_EVENT_KEY_WINDOW);
    expect(engine.playCue).toHaveBeenCalledTimes(events.length);
  });

  it('dispatches distinct same-tick updates by sequence and suppresses old sequences', () => {
    const engine = { playCue: vi.fn() };
    const cues = [
      {
        id: 'cue:fire',
        label: 'Fire',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'weapon.fire',
      },
    ];
    const seenKeys = new Set<string>();
    const firstTickEvents = Array.from(
      { length: GAMEPLAY_AUDIO_EVENT_KEY_WINDOW + 1 },
      (_, index) => ({
        _tag: 'WeaponFired' as const,
        sourceId: entityId('player-1'),
        weaponId: 'weapon:rifle' as never,
        origin: { x: 1, y: 2 },
        direction: { x: 1, y: 0 },
        damage: 25,
        ammoRemaining: 100 - index,
        tick: 7,
      }),
    );
    const completedTickEvent = {
      _tag: 'WeaponFired' as const,
      sourceId: entityId('player-1'),
      weaponId: 'weapon:rifle' as never,
      origin: { x: 3, y: 2 },
      direction: { x: 1, y: 0 },
      damage: 25,
      ammoRemaining: 1,
      tick: 7,
    };
    const laterTickEvent = {
      ...completedTickEvent,
      ammoRemaining: 0,
      tick: 8,
    };

    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: sequenced(firstTickEvents),
        seenKeys,
      }),
    ).toEqual(Array.from({ length: firstTickEvents.length }, () => 'cue:fire'));
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: [{ sequence: firstTickEvents.length, event: completedTickEvent }],
        seenKeys,
      }),
    ).toEqual(['cue:fire']);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: [{ sequence: 0, event: completedTickEvent }],
        seenKeys,
      }),
    ).toEqual([]);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: [{ sequence: firstTickEvents.length + 1, event: laterTickEvent }],
        seenKeys,
      }),
    ).toEqual(['cue:fire']);
    expect(seenKeys.size).toBeLessThanOrEqual(GAMEPLAY_AUDIO_EVENT_KEY_WINDOW);
    expect(engine.playCue).toHaveBeenCalledTimes(firstTickEvents.length + 2);
  });
});

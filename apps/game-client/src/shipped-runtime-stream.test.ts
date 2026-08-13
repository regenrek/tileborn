import { describe, expect, it, vi } from 'vitest';
import { Option } from 'effect';
import { BattleRoyaleProtocol, GameplayWeaponFired } from '@tileborne/ipc-contracts';
import {
  dispatchGameplayLifecycleAudioEvents,
  GAMEPLAY_AUDIO_EVENT_KEY_WINDOW,
} from '@tileborne/game-client';

import {
  applyShippedRuntimeServerFrame,
  decodeShippedRuntimeServerFrame,
  initialShippedRuntimeState,
  SHIPPED_GAMEPLAY_EVENT_WINDOW,
  SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW,
} from './shipped-runtime-stream.js';
import { acceptedBattleRoyaleFireEvents } from './test/accepted-br-fire-events.js';

describe('shipped runtime stream', () => {
  const emptyDeltaOptions = {
    team: Option.none<string>(),
    x: Option.none<number>(),
    y: Option.none<number>(),
    health: Option.none<number>(),
    shield: Option.none<number>(),
    armor: Option.none<BattleRoyaleProtocol.PlayerArmorSnapshot>(),
    weapon: Option.none<BattleRoyaleProtocol.PlayerWeaponSnapshot>(),
    inventory: Option.none<BattleRoyaleProtocol.PlayerInventorySnapshot>(),
    pickupPrompt: Option.none<BattleRoyaleProtocol.PlayerPickupPromptSnapshot>(),
    pickupToast: Option.none<BattleRoyaleProtocol.PlayerPickupToastSnapshot>(),
    damageIndicator: Option.none<BattleRoyaleProtocol.PlayerDamageIndicatorSnapshot>(),
    stats: Option.none<BattleRoyaleProtocol.PlayerStatsSnapshot>(),
    statusEffects: Option.none<readonly BattleRoyaleProtocol.PlayerStatusSnapshot[]>(),
    abilityCooldowns: Option.none<readonly BattleRoyaleProtocol.PlayerAbilityCooldownSnapshot[]>(),
    animation: Option.none<BattleRoyaleProtocol.PlayerAnimationState>(),
  } as const;

  const deltaFrame = (input: {
    readonly tick: number;
    readonly updated?: readonly BattleRoyaleProtocol.PlayerUpdate[];
  }): BattleRoyaleProtocol.DeltaSnapshot =>
    new BattleRoyaleProtocol.DeltaSnapshot({
      tick: input.tick,
      serverTimestampMs: input.tick * 50,
      removed: [],
      updated: [...(input.updated ?? [])],
      projectilesUpdated: [],
      projectilesRemoved: [],
      deployablesUpdated: [],
      deployablesRemoved: [],
      objectsUpdated: [],
      objectsRemoved: [],
      zone: Option.none(),
    });

  it('appends accepted BR weapon fire gameplay events from server frames', () => {
    const base = initialShippedRuntimeState('player-1');
    const acceptedEvents = acceptedBattleRoyaleFireEvents();
    expect(acceptedEvents).toHaveLength(2);
    const wireFrames = acceptedEvents.map((event, sequence) =>
      BattleRoyaleProtocol.encodeServerMessage(
        new BattleRoyaleProtocol.GameplayEventFrame({ sequence, event }),
      ),
    );
    const decodedFrames = wireFrames.map((frame) => decodeShippedRuntimeServerFrame(frame));
    expect(decodedFrames).toEqual([
      expect.objectContaining({ kind: 'gameplay-event', sequence: 0, event: acceptedEvents[0] }),
      expect.objectContaining({ kind: 'gameplay-event', sequence: 1, event: acceptedEvents[1] }),
    ]);

    const first = applyShippedRuntimeServerFrame(base, decodedFrames[0]!);
    const second = applyShippedRuntimeServerFrame(first, decodedFrames[1]!);
    const replay = applyShippedRuntimeServerFrame(second, decodedFrames[1]!);

    expect(replay.events).toEqual([
      expect.objectContaining({
        _tag: 'WeaponFired',
        sourceId: 'player-1',
        origin: acceptedEvents[0]!.origin,
        direction: acceptedEvents[0]!.direction,
      }),
      expect.objectContaining({
        _tag: 'WeaponFired',
        sourceId: 'player-2',
        origin: acceptedEvents[1]!.origin,
        direction: acceptedEvents[1]!.direction,
      }),
    ]);
  });

  it('plays distinct same-tick accepted gameplay frames arriving across retained updates', () => {
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
    const [firstShot, secondShot] = acceptedBattleRoyaleFireEvents();
    expect(firstShot?.tick).toBe(8);
    expect(secondShot?.tick).toBe(8);

    let state = initialShippedRuntimeState('player-1');
    state = applyShippedRuntimeServerFrame(state, {
      kind: 'gameplay-event',
      sequence: 0,
      event: firstShot!,
    });
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: state.sequencedEvents,
        seenKeys,
      }),
    ).toEqual(['cue:fire']);

    state = applyShippedRuntimeServerFrame(state, {
      kind: 'gameplay-event',
      sequence: 1,
      event: secondShot!,
    });
    expect(state.sequencedEvents.map((entry) => entry.event)).toEqual([firstShot, secondShot]);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: state.sequencedEvents,
        seenKeys,
      }),
    ).toEqual(['cue:fire']);
    expect(engine.playCue).toHaveBeenCalledTimes(2);
  });

  it('keeps sustained accepted fire events bounded while dispatching each shot once', () => {
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
    const acceptedShots = Array.from(
      { length: SHIPPED_GAMEPLAY_EVENT_WINDOW * 3 },
      (_, index) =>
        new GameplayWeaponFired({
          tick: index + 1,
          sourceId: 'player-1' as never,
          weaponId: 'weapon:550e8400-e29b-41d4-a716-446655440000' as never,
          origin: { x: 1, y: 2 },
          direction: { x: 1, y: 0 },
          damage: 25,
          ammoRemaining: 200 - index,
        }),
    );

    let state = initialShippedRuntimeState('player-1');
    for (const [sequence, event] of acceptedShots.entries()) {
      const frame = decodeShippedRuntimeServerFrame(
        BattleRoyaleProtocol.encodeServerMessage(
          new BattleRoyaleProtocol.GameplayEventFrame({ sequence, event }),
        ),
      );
      expect(frame).toEqual(expect.objectContaining({ kind: 'gameplay-event', sequence, event }));
      state = applyShippedRuntimeServerFrame(state, frame!);
      expect(state.events.length).toBeLessThanOrEqual(SHIPPED_GAMEPLAY_EVENT_WINDOW);
      expect(
        dispatchGameplayLifecycleAudioEvents({
          engine,
          cues,
          events: state.sequencedEvents,
          seenKeys,
        }),
      ).toEqual(['cue:fire']);
      expect(seenKeys.size).toBeLessThanOrEqual(GAMEPLAY_AUDIO_EVENT_KEY_WINDOW);
    }

    const staleReplay = decodeShippedRuntimeServerFrame(
      BattleRoyaleProtocol.encodeServerMessage(
        new BattleRoyaleProtocol.GameplayEventFrame({ sequence: 0, event: acceptedShots[0]! }),
      ),
    );
    state = applyShippedRuntimeServerFrame(state, staleReplay!);

    expect(state.events).toHaveLength(SHIPPED_GAMEPLAY_EVENT_WINDOW);
    expect(state.events[0]).toEqual(acceptedShots.at(-SHIPPED_GAMEPLAY_EVENT_WINDOW));
    expect(state.events.at(-1)).toEqual(acceptedShots.at(-1));
    expect(seenKeys.size).toBeLessThanOrEqual(GAMEPLAY_AUDIO_EVENT_KEY_WINDOW);
    expect(engine.playCue).toHaveBeenCalledTimes(acceptedShots.length);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: state.sequencedEvents,
        seenKeys,
      }),
    ).toEqual([]);
  });

  it('keeps the newest synthetic pickup event after the sequenced window fills', () => {
    const engine = { playCue: vi.fn() };
    const cues = [
      {
        id: 'cue:item',
        label: 'Item',
        busId: 'sfx',
        defaultVolume: 1,
        binding: 'item.collect',
      },
    ];
    let state = applyShippedRuntimeServerFrame(initialShippedRuntimeState('player-1'), {
      kind: 'initial',
      tick: 1,
      players: [
        {
          playerId: 'player-1',
          health: 100,
        },
      ],
      zone: { cx: 0, cy: 0, radius: 100 },
    });

    for (let index = 0; index <= SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW; index += 1) {
      const tick = index + 2;
      const frame = decodeShippedRuntimeServerFrame(
        BattleRoyaleProtocol.encodeServerMessage(
          deltaFrame({
            tick,
            updated: [
              {
                id: BattleRoyaleProtocol.makePlayerId('player-1'),
                ...emptyDeltaOptions,
                pickupToast: Option.some({
                  itemKind: `ammo-box-${index}`,
                  tier: 'common',
                  quantity: 1,
                  tick,
                }),
              },
            ],
          }),
        ),
      );
      state = applyShippedRuntimeServerFrame(state, frame!);
    }

    expect(state.sequencedEvents).toHaveLength(SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW);
    expect(state.nextSyntheticGameplayEventSequence).toBe(
      -(SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW + 3),
    );
    expect(state.sequencedEvents.at(-1)).toEqual(
      expect.objectContaining({
        sequence: -(SHIPPED_SEQUENCED_GAMEPLAY_EVENT_WINDOW + 2),
        event: expect.objectContaining({
          _tag: 'ItemGranted',
          itemId: 'ammo-box-80',
        }),
      }),
    );
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: [state.sequencedEvents.at(-1)!],
        seenKeys: new Set<string>(),
      }),
    ).toEqual(['cue:item']);
    expect(engine.playCue).toHaveBeenCalledTimes(1);
  });

  it('rejects stale deltas so evicted gameplay event replays stay behind the watermark', () => {
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
    const firstShot = new GameplayWeaponFired({
      tick: 1,
      sourceId: 'player-1' as never,
      weaponId: 'weapon:550e8400-e29b-41d4-a716-446655440000' as never,
      origin: { x: 1, y: 2 },
      direction: { x: 1, y: 0 },
      damage: 25,
      ammoRemaining: 30,
    });
    let state = initialShippedRuntimeState('player-1');
    state = applyShippedRuntimeServerFrame(state, {
      kind: 'initial',
      tick: 1,
      players: [
        {
          playerId: 'player-1',
          health: 100,
        },
      ],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    state = applyShippedRuntimeServerFrame(state, {
      kind: 'gameplay-event',
      sequence: 0,
      event: firstShot,
    });
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: state.sequencedEvents,
        seenKeys,
      }),
    ).toEqual(['cue:fire']);

    for (let index = 0; index < SHIPPED_GAMEPLAY_EVENT_WINDOW; index += 1) {
      state = applyShippedRuntimeServerFrame(state, {
        kind: 'gameplay-event',
        sequence: index + 1,
        event: new GameplayWeaponFired({
          tick: index + 2,
          sourceId: 'player-1' as never,
          weaponId: 'weapon:550e8400-e29b-41d4-a716-446655440000' as never,
          origin: { x: 1 + index, y: 2 },
          direction: { x: 1, y: 0 },
          damage: 25,
          ammoRemaining: 29 - index,
        }),
      });
    }
    expect(state.events).toHaveLength(SHIPPED_GAMEPLAY_EVENT_WINDOW);
    expect(state.events).not.toContain(firstShot);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: state.sequencedEvents,
        seenKeys,
      }),
    ).toHaveLength(SHIPPED_GAMEPLAY_EVENT_WINDOW);

    const laterDelta = decodeShippedRuntimeServerFrame(
      BattleRoyaleProtocol.encodeServerMessage(
        deltaFrame({
          tick: SHIPPED_GAMEPLAY_EVENT_WINDOW + 5,
          updated: [
            {
              id: BattleRoyaleProtocol.makePlayerId('player-1'),
              ...emptyDeltaOptions,
              health: Option.some(80),
            },
          ],
        }),
      ),
    );
    state = applyShippedRuntimeServerFrame(state, laterDelta!);
    expect(state.tickCount).toBe(SHIPPED_GAMEPLAY_EVENT_WINDOW + 5);
    expect(state.events).not.toContain(firstShot);

    const staleDelta = decodeShippedRuntimeServerFrame(
      BattleRoyaleProtocol.encodeServerMessage(
        deltaFrame({
          tick: 1,
          updated: [
            {
              id: BattleRoyaleProtocol.makePlayerId('player-1'),
              ...emptyDeltaOptions,
              health: Option.some(60),
            },
          ],
        }),
      ),
    );
    const afterStaleDelta = applyShippedRuntimeServerFrame(state, staleDelta!);
    expect(afterStaleDelta).toBe(state);
    expect(afterStaleDelta.tickCount).toBe(SHIPPED_GAMEPLAY_EVENT_WINDOW + 5);

    const staleReplay = decodeShippedRuntimeServerFrame(
      BattleRoyaleProtocol.encodeServerMessage(
        new BattleRoyaleProtocol.GameplayEventFrame({ sequence: 0, event: firstShot }),
      ),
    );
    state = applyShippedRuntimeServerFrame(afterStaleDelta, staleReplay!);
    expect(state.events).not.toContain(firstShot);
    expect(
      dispatchGameplayLifecycleAudioEvents({
        engine,
        cues,
        events: state.sequencedEvents,
        seenKeys,
      }),
    ).toEqual([]);
    expect(engine.playCue).toHaveBeenCalledTimes(SHIPPED_GAMEPLAY_EVENT_WINDOW + 1);
  });
});

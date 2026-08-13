// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  BattleRoyaleProtocol,
  GameplayItemGranted,
  GameplayWeaponFired,
} from '@tileborne/ipc-contracts';

import {
  createPlaytestRuntimeHudTracker,
  type PlaytestHudWorldStateDeriver,
} from './playtest-runtime-hud.js';
import type { PlaytestPluginWorld } from './playtest-plugin-world.js';

const world = {} as PlaytestPluginWorld;

describe('playtest runtime HUD lifecycle events', () => {
  it('ingests accepted weapon fire events from plugin runtime frames', () => {
    const deriveWorldState: PlaytestHudWorldStateDeriver = (_world, tickCount) => ({
      totalPlayers: 1,
      localPlayer: {
        playerId: 'player-1',
        displayName: 'Player 1',
        health: 100,
        maxHealth: 100,
        weapon: {
          weaponId: 'weapon:00000000-0000-4000-8000-000000000001',
          slot: 1,
          ammoInMagazine: tickCount >= 4 ? 10 : tickCount >= 2 ? 11 : 12,
          magazineSize: 12,
          cooldownRemainingTicks: tickCount >= 2 ? 8 : 0,
        },
      },
      minimap: { players: [], objects: [] },
    });
    const tracker = createPlaytestRuntimeHudTracker(deriveWorldState);
    const weaponId = 'weapon:00000000-0000-4000-8000-000000000001';
    const first = BattleRoyaleProtocol.encodeServerMessage(
      new BattleRoyaleProtocol.GameplayEventFrame({
        sequence: 0,
        event: new GameplayWeaponFired({
          tick: 2,
          sourceId: 'player-1' as never,
          weaponId: weaponId as never,
          origin: { x: 1, y: 2 },
          direction: { x: 1, y: 0 },
          damage: 25,
          ammoRemaining: 11,
        }),
      }),
    );
    const second = BattleRoyaleProtocol.encodeServerMessage(
      new BattleRoyaleProtocol.GameplayEventFrame({
        sequence: 1,
        event: new GameplayWeaponFired({
          tick: 2,
          sourceId: 'player-1' as never,
          weaponId: weaponId as never,
          origin: { x: 1, y: 2 },
          direction: { x: 1, y: 0 },
          damage: 25,
          ammoRemaining: 10,
        }),
      }),
    );

    expect(tracker.snapshot(world, 1).gameplayEvents).toEqual([]);
    expect(tracker.snapshot(world, 4).gameplayEvents).toEqual([]);
    tracker.ingestFrames([first, second]);
    expect(tracker.snapshot(world, 4).gameplayEvents.map((event) => event._tag)).toEqual([
      'WeaponFired',
      'WeaponFired',
    ]);
    expect(
      tracker
        .snapshot(world, 4)
        .gameplayEvents.map((event) =>
          event._tag === 'WeaponFired'
            ? [event.damage, event.ammoRemaining, event.origin, event.direction]
            : [],
        ),
    ).toEqual([
      [25, 11, { x: 1, y: 2 }, { x: 1, y: 0 }],
      [25, 10, { x: 1, y: 2 }, { x: 1, y: 0 }],
    ]);
  });

  it('keeps synthesized lifecycle event sequences disjoint from authoritative frames', () => {
    const deriveWorldState: PlaytestHudWorldStateDeriver = (_world, tickCount) => ({
      totalPlayers: 1,
      localPlayer: {
        playerId: 'player-1',
        displayName: 'Player 1',
        health: 100,
        maxHealth: 100,
        ...(tickCount >= 1
          ? {
              pickupToast: {
                itemKind: 'health-pack',
                tier: 'rare',
                quantity: 1,
                tick: 1,
              },
            }
          : {}),
      },
      minimap: { players: [], objects: [] },
    });
    const tracker = createPlaytestRuntimeHudTracker(deriveWorldState);
    const acceptedFireFrame = BattleRoyaleProtocol.encodeServerMessage(
      new BattleRoyaleProtocol.GameplayEventFrame({
        sequence: 0,
        event: new GameplayWeaponFired({
          tick: 2,
          sourceId: 'player-1' as never,
          weaponId: 'weapon:00000000-0000-4000-8000-000000000001' as never,
          origin: { x: 1, y: 2 },
          direction: { x: 1, y: 0 },
          damage: 25,
          ammoRemaining: 11,
        }),
      }),
    );

    expect(tracker.snapshot(world, 1).sequencedGameplayEvents).toMatchObject([
      {
        sequence: -1,
        event: new GameplayItemGranted({
          targetId: 'player-1' as never,
          itemId: 'health-pack:rare' as never,
          quantity: 1,
          tick: 1,
        }),
      },
    ]);

    tracker.ingestFrames([acceptedFireFrame]);

    expect(
      tracker
        .snapshot(world, 2)
        .sequencedGameplayEvents.map(({ sequence, event }) => [sequence, event._tag]),
    ).toEqual([
      [-1, 'ItemGranted'],
      [0, 'WeaponFired'],
    ]);
  });

  it('derives neutral audio-ready lifecycle events from authoritative HUD world state', () => {
    const deriveWorldState: PlaytestHudWorldStateDeriver = (_world, tickCount) => ({
      totalPlayers: 2,
      localPlayer: {
        playerId: 'player-1',
        displayName: 'Player 1',
        health: tickCount >= 2 ? 75 : 100,
        maxHealth: 100,
        ...(tickCount >= 2
          ? {
              damageIndicator: {
                sourceId: 'player-2',
                amount: 25,
                angleDeg: 180,
                tick: 2,
              },
            }
          : {}),
        ...(tickCount >= 3
          ? {
              pickupToast: {
                itemKind: 'health-pack',
                tier: 'rare',
                quantity: 1,
                tick: 3,
              },
            }
          : {}),
      },
      zoneStatus:
        tickCount >= 4
          ? { phase: 'shrinking' }
          : tickCount >= 1
            ? { phase: 'countdown', secondsRemaining: 10 }
            : { phase: 'stable' },
      scoreboard: [
        {
          playerId: 'player-1',
          displayName: 'Player 1',
          health: tickCount >= 2 ? 75 : 100,
          alive: true,
          kills: 0,
          deaths: 0,
        },
      ],
      minimap: { players: [], objects: [] },
    });
    const tracker = createPlaytestRuntimeHudTracker(deriveWorldState);

    expect(tracker.snapshot(world, 0).gameplayEvents).toEqual([]);
    expect(tracker.snapshot(world, 1).gameplayEvents.map((event) => event._tag)).toEqual([
      'ZonePhaseChanged',
    ]);
    expect(tracker.snapshot(world, 2).gameplayEvents.map((event) => event._tag)).toEqual([
      'ZonePhaseChanged',
      'DamageApplied',
    ]);
    expect(tracker.snapshot(world, 3).gameplayEvents.map((event) => event._tag)).toEqual([
      'ZonePhaseChanged',
      'DamageApplied',
      'ItemGranted',
    ]);
    expect(tracker.snapshot(world, 4).gameplayEvents.map((event) => event._tag)).toEqual([
      'ZonePhaseChanged',
      'DamageApplied',
      'ItemGranted',
      'ZonePhaseChanged',
    ]);
  });
});

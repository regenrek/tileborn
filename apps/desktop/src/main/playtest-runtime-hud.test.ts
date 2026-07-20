// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createPlaytestRuntimeHudTracker,
  type PlaytestHudWorldStateDeriver,
} from './playtest-runtime-hud.js';
import type { PlaytestPluginWorld } from './playtest-plugin-world.js';

const world = {} as PlaytestPluginWorld;

describe('playtest runtime HUD lifecycle events', () => {
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

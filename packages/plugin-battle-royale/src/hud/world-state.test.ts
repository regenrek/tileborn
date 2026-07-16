import { describe, expect, it } from 'vitest';

import { MOVEMENT, ZONE } from '../constants.js';
import { derivePlaytestHudWorldState, type HudWorldView } from './world-state.js';

const makeWorld = (components: Record<string, ReadonlyMap<number, object>>): HudWorldView => ({
  getComponent: <T extends object>(name: string) => {
    const store = components[name];
    if (store === undefined) {
      throw new Error(`unknown component ${name}`);
    }
    return {
      get: (entity: number) => store.get(entity) as T | undefined,
      entries: () => store.entries() as Iterable<[number, T]>,
    };
  },
});

describe('derivePlaytestHudWorldState', () => {
  it('derives local player, scoreboard, and minimap from the plugin world', () => {
    const world = makeWorld({
      Player: new Map([
        [1, { playerId: 'player-1', health: 80, alive: 1 }],
        [2, { playerId: 'player-2', health: 0, alive: 0 }],
      ]),
      Position: new Map([
        [1, { x: 4, y: 5 }],
        [2, { x: 10, y: 12 }],
      ]),
    });

    const state = derivePlaytestHudWorldState(world, 10);
    expect(state.totalPlayers).toBe(2);
    expect(state.localPlayer).toMatchObject({
      playerId: 'player-1',
      displayName: 'Player 1',
      health: 80,
      position: { x: 4, y: 5 },
    });
    expect(state.scoreboard.map((entry) => entry.playerId)).toEqual(['player-1', 'player-2']);
    expect(state.minimap.players).toHaveLength(2);
    expect(state.minimap.players.find((player) => player.playerId === 'player-1')?.local).toBe(
      true,
    );
  });

  it("computes the zone countdown from the plugin's own schedule constants", () => {
    const world = makeWorld({
      Player: new Map(),
      Zone: new Map([
        [
          9,
          {
            cx: 16,
            cy: 16,
            currentRadius: 20,
            targetRadius: 10,
            shrinkStartTick: -1,
            shrinkDurationTicks: 0,
            shrinkFromRadius: 20,
            damagePerSecOutside: 5,
            schedulePhaseIndex: 0,
            phaseStartTick: 0,
          },
        ],
      ]),
    });

    const tick = MOVEMENT.tickRate; // one second elapsed
    const state = derivePlaytestHudWorldState(world, tick);
    expect(state.zoneStatus).toEqual({
      phase: 'countdown',
      secondsRemaining: ZONE.schedule.waitSec - 1,
    });
    expect(state.minimap.zone).toEqual({ cx: 16, cy: 16, radius: 20 });
  });

  it('returns an empty slice when the world has no plugin components', () => {
    const world = makeWorld({});
    const state = derivePlaytestHudWorldState(world, 0);
    expect(state.totalPlayers).toBe(0);
    expect(state.scoreboard).toEqual([]);
    expect(state.minimap.players).toEqual([]);
    expect(state.zoneStatus).toBeUndefined();
  });
});

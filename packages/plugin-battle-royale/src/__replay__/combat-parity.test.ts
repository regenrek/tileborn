import { MapObject, gameObjectTypeIdForKey, makeTileborneMap } from '@tileborne/core';
import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { DAMAGE, MOVEMENT, SPAWN_POINT_KIND } from '../constants.js';
import { PLAYER_COMPONENT, type Player } from '../ecs/components.js';
import { resetZoneSingleton } from '../ecs/zone.js';
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from '../id-utils.js';
import { TEST_PLAYER_MODELS } from '../test-player-model.js';
import { createRuntimeAdapter } from '../runtime-adapter.js';
import { buildTestMapPackage } from '../test-map-package.js';
import type { RuntimePlayerInput } from '../types/runtime-plugin.js';
import { createTestPluginWorld } from '../test-plugin-world.js';

const DT = 1 / MOVEMENT.tickRate;
const PARITY_SEED = 1337;
const TICK_COUNT = 30;

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kind),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties: {},
  });

/** Two players on the same row so player-1's east shot reaches player-2. */
const makeDuelMapPackage = (): unknown =>
  buildTestMapPackage({
    map: makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 10, 16),
        makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 40, 16),
        makeTestObject(TEST_OBJECT_IDS[3], 'shrink-zone-anchor', 16, 16),
      ],
      properties: { maxPlayers: 2 },
    }),
    playerModels: TEST_PLAYER_MODELS,
  });

interface PlayerState {
  readonly playerId: string;
  readonly health: number;
  readonly alive: 0 | 1;
}

interface TickState {
  readonly tick: number;
  readonly players: readonly PlayerState[];
}

interface RunResult {
  readonly states: readonly TickState[];
  readonly killEvents: readonly { readonly killer: string; readonly victim: string }[];
}

const captureState = (world: ReturnType<typeof createTestPluginWorld>, tick: number): TickState => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const out: PlayerState[] = [];
  for (const [, player] of players.entries()) {
    out.push({ playerId: player.playerId, health: player.health, alive: player.alive });
  }
  out.sort((left, right) => left.playerId.localeCompare(right.playerId));
  return { tick, players: out };
};

const runDuel = (): RunResult => {
  resetZoneSingleton();
  const world = createTestPluginWorld();
  const mapPackage = makeDuelMapPackage();
  const frames: Uint8Array[] = [];
  let currentTick = 0;

  // player-1 shoots east toward the stationary player-2 every tick.
  const inputForTick: ReadonlyMap<string, RuntimePlayerInput> = new Map([
    [
      'player-1',
      {
        tick: 0,
        seq: 0,
        dir: 0,
        shoot: true,
        reload: false,
        interact: false,
        drop: false,
        abilities: [],
      },
    ],
  ]);

  const plugin = createRuntimeAdapter({
    getMapPackage: () => mapPackage,
    seed: PARITY_SEED,
    config: {
      // Isolate combat: the zone deals no damage so only weapon hits can kill.
      zone: { damagePerSecOutside: 0 },
      // One-shot kill makes the damage-application outcome crisp.
      projectile: { damage: DAMAGE.playerHealth },
    },
    getPlayerInput: (playerId) => (currentTick >= 1 ? inputForTick.get(playerId) : undefined),
    msgOut: {
      push: (frame) => {
        const copy = new Uint8Array(frame.byteLength);
        copy.set(frame);
        frames.push(copy);
      },
    },
  });

  plugin.onInit?.({ pluginId: plugin.id }, world);

  const states: TickState[] = [captureState(world, 0)];
  for (let tick = 1; tick <= TICK_COUNT; tick += 1) {
    currentTick = tick;
    plugin.onTick?.(world, DT, tick);
    states.push(captureState(world, tick));
  }

  const killEvents: { readonly killer: string; readonly victim: string }[] = [];
  for (const frame of frames) {
    const message = BattleRoyaleProtocol.decodeMessage(frame);
    if (message._tag === 'PlayerKilled') {
      killEvents.push({ killer: String(message.killer), victim: String(message.victim) });
    }
  }

  resetZoneSingleton();
  return { states, killEvents };
};

describe('combat migration parity (neutral engine)', () => {
  it("preserves BR's observable combat outcome: player-1 hits and defeats player-2", () => {
    const result = runDuel();

    const finalState = result.states.at(-1)!;
    const winner = finalState.players.find((player) => player.playerId === 'player-1');
    const loser = finalState.players.find((player) => player.playerId === 'player-2');

    expect(winner).toMatchObject({ health: DAMAGE.playerHealth, alive: 1 });
    expect(loser).toMatchObject({ health: 0, alive: 0 });

    expect(result.killEvents).toContainEqual({
      killer: String(BattleRoyaleProtocol.makePlayerId('player-1')),
      victim: String(BattleRoyaleProtocol.makePlayerId('player-2')),
    });
  });

  it('applies exact projectile damage: health steps straight to zero on a lethal hit', () => {
    const result = runDuel();
    const loserSeries = result.states.map(
      (state) => state.players.find((player) => player.playerId === 'player-2')!.health,
    );

    // BR clamps damage at 0 (no negative health); a one-shot hit moves 100 -> 0
    // with no intermediate value (proves the neutral damage core matches applyDamage).
    const distinctHealths = [...new Set(loserSeries)];
    expect(distinctHealths.sort((a, b) => b - a)).toEqual([DAMAGE.playerHealth, 0]);
  });
});

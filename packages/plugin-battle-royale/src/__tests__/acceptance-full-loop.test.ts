import { MapObject, gameObjectTypeIdForKey, makeTileborneMap } from '@tileborne/core';
import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { DAMAGE, MOVEMENT, PROJECTILE, SPAWN_POINT_KIND } from '../constants.js';
import {
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  type Player,
  type PlayerStats,
  type Position,
} from '../ecs/components.js';
import { getZone, resetZoneSingleton } from '../ecs/zone.js';
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from '../id-utils.js';
import { buildTestMapPackage } from '../test-map-package.js';
import { TEST_PLAYER_MODELS } from '../test-player-model.js';
import { createRuntimeAdapter } from '../runtime-adapter.js';
import type { RuntimePlayerInput } from '../types/runtime-plugin.js';
import { createTestPluginWorld } from '../test-plugin-world.js';
import {
  buildScriptedInputLog,
  makeReplayMapPackage,
  type InputLogEntry,
  type WorldSnapshot,
  REPLAY_SEED,
  runReplayScenario,
} from '../__replay__/replay-harness.js';

const TICK_DT = 1 / MOVEMENT.tickRate;
const ACCEPTANCE_SEED = REPLAY_SEED;

const FAST_ZONE_SCHEDULE = {
  waitSec: 0,
  shrinkSec: 2,
  holdSec: 2,
  shrinkPhases: 1,
  radiusFactor: 0.5,
} as const;

const ACCEPTANCE_TICK_COUNT = 120;

const EXPECTED_SPAWN_POSITIONS = [
  { playerId: 'player-1', x: 10, y: 16 },
  { playerId: 'player-2', x: 22, y: 16 },
  { playerId: 'player-3', x: 50, y: 50 },
] as const;

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
  properties: Record<string, number> = {},
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kind),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties,
  });

export const makeAcceptanceFixtureMap = () =>
  makeTileborneMap({
    id: TEST_MAP_ID,
    width: 32,
    height: 32,
    tileWidth: 32,
    tileHeight: 32,
    objects: [
      makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 10, 16),
      makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 22, 16),
      makeTestObject(TEST_OBJECT_IDS[2], SPAWN_POINT_KIND, 50, 50),
      // The wider start radius is authored on the anchor (initialRadiusTiles)
      // so the package-derived shrink schedule matches the scenario's needs.
      makeTestObject(TEST_OBJECT_IDS[3], 'shrink-zone-anchor', 16, 16, {
        initialRadiusTiles: 20,
      }),
    ],
    properties: { maxPlayers: 3 },
  });

export const makeAcceptanceMapPackage = (): unknown =>
  buildTestMapPackage({ map: makeAcceptanceFixtureMap(), playerModels: TEST_PLAYER_MODELS });

const createMsgCollector = () => {
  const frames: Uint8Array[] = [];
  return {
    msgOut: {
      push: (frame: Uint8Array) => {
        frames.push(frame);
      },
    },
    decodeAll: () => frames.map((frame) => BattleRoyaleProtocol.decodeMessage(frame)),
  };
};

const buildInputLookup = (
  inputLog: readonly InputLogEntry[],
): ReadonlyMap<number, ReadonlyMap<string, RuntimePlayerInput>> => {
  const byTick = new Map<number, Map<string, RuntimePlayerInput>>();
  for (const entry of inputLog) {
    const tickInputs = byTick.get(entry.tick) ?? new Map<string, RuntimePlayerInput>();
    tickInputs.set(entry.playerId, {
      tick: entry.tick,
      seq: 0,
      dir: entry.dir,
      shoot: entry.shoot,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
    byTick.set(entry.tick, tickInputs);
  }
  return byTick;
};

const captureWorldSnapshot = (
  world: ReturnType<typeof createTestPluginWorld>,
  tick: number,
): WorldSnapshot => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
  const zone = getZone(world);

  const playerSnapshots = [];
  for (const [entity, player] of players.entries()) {
    const position = positions.get(entity);
    const playerStats = stats.get(entity);
    playerSnapshots.push({
      playerId: player.playerId,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      health: player.health,
      alive: player.alive,
      kills: playerStats?.kills ?? 0,
    });
  }

  playerSnapshots.sort((left, right) => left.playerId.localeCompare(right.playerId));

  return {
    tick,
    zoneRadius: zone?.currentRadius ?? 0,
    players: playerSnapshots,
  };
};

export const buildAcceptanceInputLog = (): InputLogEntry[] => {
  const log: InputLogEntry[] = [];

  for (let tick = 1; tick <= ACCEPTANCE_TICK_COUNT; tick += 1) {
    if (tick === 1) {
      log.push({
        tick,
        playerId: 'player-1',
        dir: 0,
        shoot: true,
      });
    }
  }

  return log;
};

export const buildMissProjectileInputLog = (): InputLogEntry[] => [
  { tick: 1, playerId: 'player-1', dir: 4, shoot: true },
];

interface AcceptanceRunResult {
  readonly spawnSnapshot: WorldSnapshot;
  readonly snapshots: readonly WorldSnapshot[];
  readonly finalSnapshot: WorldSnapshot;
  readonly gameOverSnapshot: WorldSnapshot | undefined;
  readonly messages: ReturnType<ReturnType<typeof createMsgCollector>['decodeAll']>;
  readonly maxProjectileCount: number;
  readonly finalProjectileCount: number;
  readonly initialZoneRadius: number;
  readonly zoneRadiusAtTick60: number;
}

export const runAcceptanceScenario = (
  inputLog: readonly InputLogEntry[] = buildAcceptanceInputLog(),
  tickCount = ACCEPTANCE_TICK_COUNT,
): AcceptanceRunResult => {
  resetZoneSingleton();

  const world = createTestPluginWorld();
  const mapPackage = makeAcceptanceMapPackage();
  const inputByTick = buildInputLookup(inputLog);
  const collector = createMsgCollector();
  let currentTick = 0;
  let maxProjectileCount = 0;
  let zoneRadiusAtTick60 = 0;
  let gameOverSnapshot: WorldSnapshot | undefined;
  let gameOverSeen = false;

  const plugin = createRuntimeAdapter({
    getMapPackage: () => mapPackage,
    config: {
      tickRate: MOVEMENT.tickRate,
      projectile: {
        damage: DAMAGE.playerHealth,
      },
      zone: {
        damagePerSecOutside: 50,
        schedule: FAST_ZONE_SCHEDULE,
      },
    },
    getPlayerInput: (playerId) => inputByTick.get(currentTick)?.get(playerId),
    msgOut: collector.msgOut,
  });

  plugin.onInit?.({ pluginId: plugin.id }, world);
  const spawnSnapshot = captureWorldSnapshot(world, 0);
  const initialZoneRadius = getZone(world)?.currentRadius ?? 0;

  const snapshots: WorldSnapshot[] = [];
  const projectileCount = (): number => {
    try {
      return world.getComponent(PROJECTILE_COMPONENT).entries().length;
    } catch {
      return 0;
    }
  };

  for (let tick = 1; tick <= tickCount; tick += 1) {
    currentTick = tick;
    plugin.onTick?.(world, TICK_DT, tick);

    maxProjectileCount = Math.max(maxProjectileCount, projectileCount());

    if (tick === 60) {
      zoneRadiusAtTick60 = getZone(world)?.currentRadius ?? 0;
    }

    if (tick === 1 || tick === 5 || tick === 60 || tick === tickCount) {
      snapshots.push(captureWorldSnapshot(world, tick));
    }

    if (!gameOverSeen && collector.decodeAll().some((message) => message._tag === 'GameOver')) {
      gameOverSeen = true;
      gameOverSnapshot = captureWorldSnapshot(world, tick);
    }
  }

  const finalSnapshot = captureWorldSnapshot(world, tickCount);
  const finalProjectileCount = projectileCount();
  resetZoneSingleton();

  return {
    spawnSnapshot,
    snapshots,
    finalSnapshot,
    gameOverSnapshot,
    messages: collector.decodeAll(),
    maxProjectileCount,
    finalProjectileCount,
    initialZoneRadius,
    zoneRadiusAtTick60,
  };
};

const findPlayer = (snapshot: WorldSnapshot, playerId: string) =>
  snapshot.players.find((player) => player.playerId === playerId);

afterEach(() => {
  resetZoneSingleton();
});

describe('acceptance: full BR loop', () => {
  it('spawns players at artifact spawn positions', () => {
    const result = runAcceptanceScenario([], 0);

    for (const expected of EXPECTED_SPAWN_POSITIONS) {
      const player = findPlayer(result.spawnSnapshot, expected.playerId);
      expect(player).toBeDefined();
      expect(player?.x).toBe(expected.x);
      expect(player?.y).toBe(expected.y);
      expect(player?.health).toBe(DAMAGE.playerHealth);
      expect(player?.alive).toBe(1);
    }
  });

  it('integrates player-1 movement from directional input', () => {
    const inputLog: InputLogEntry[] = [
      { tick: 1, playerId: 'player-1', dir: 0, shoot: false },
      { tick: 2, playerId: 'player-1', dir: 0, shoot: false },
    ];
    const result = runAcceptanceScenario(inputLog, 2);

    expect(findPlayer(result.spawnSnapshot, 'player-1')).toMatchObject({ x: 10, y: 16 });
    expect(findPlayer(result.finalSnapshot, 'player-1')?.x).toBeCloseTo(
      10 + 2 * MOVEMENT.speed * TICK_DT,
    );
    expect(findPlayer(result.finalSnapshot, 'player-1')?.y).toBeCloseTo(16);
  });

  it('shrinks the zone per schedule and damages out-of-zone players', () => {
    const result = runAcceptanceScenario();

    expect(result.initialZoneRadius).toBe(20);
    expect(result.zoneRadiusAtTick60).toBeLessThan(result.initialZoneRadius);

    const player3 = findPlayer(result.finalSnapshot, 'player-3');
    expect(player3?.alive).toBe(0);
    expect(
      result.messages.some(
        (message) =>
          message._tag === 'PlayerKilled' &&
          message.killer === BattleRoyaleProtocol.makePlayerId('zone'),
      ),
    ).toBe(true);
  });

  it('damages on projectile hit and despawns projectiles after lifetime', () => {
    const result = runAcceptanceScenario();

    const player2 = findPlayer(result.finalSnapshot, 'player-2');
    expect(player2?.alive).toBe(0);

    const projectileKills = result.messages.filter(
      (message) =>
        message._tag === 'PlayerKilled' &&
        message.killer === BattleRoyaleProtocol.makePlayerId('player-1'),
    );
    expect(projectileKills.length).toBeGreaterThan(0);

    const missResult = runAcceptanceScenario(
      buildMissProjectileInputLog(),
      PROJECTILE.ttlTicks + 5,
    );
    expect(missResult.maxProjectileCount).toBeGreaterThan(0);
    expect(missResult.finalProjectileCount).toBe(0);
  });

  it('emits GameOver with the last standing winner', () => {
    const result = runAcceptanceScenario();

    const gameOvers = result.messages.filter((message) => message._tag === 'GameOver');
    expect(gameOvers).toHaveLength(1);
    expect(gameOvers[0]).toMatchObject({
      winner: BattleRoyaleProtocol.makePlayerId('player-1'),
    });

    expect(result.gameOverSnapshot).toBeDefined();
    const winner = findPlayer(result.gameOverSnapshot!, 'player-1');
    expect(winner?.alive).toBe(1);
  });

  it('replays identically for the same seed and input log', () => {
    const inputLog = buildAcceptanceInputLog();
    const first = runAcceptanceScenario(inputLog);
    const second = runAcceptanceScenario(inputLog);

    expect(first.finalSnapshot).toEqual(second.finalSnapshot);
    expect(first.snapshots).toEqual(second.snapshots);
  });

  it('matches existing replay harness byte-identical snapshots', () => {
    const inputLog = buildScriptedInputLog(300);
    const first = runReplayScenario({
      seed: ACCEPTANCE_SEED,
      inputLog,
      tickCount: 300,
      snapshotInterval: 30,
      mapPackage: makeReplayMapPackage(),
    });
    const second = runReplayScenario({
      seed: ACCEPTANCE_SEED,
      inputLog,
      tickCount: 300,
      snapshotInterval: 30,
      mapPackage: makeReplayMapPackage(),
    });

    expect(Buffer.from(first.snapshotBytes)).toEqual(Buffer.from(second.snapshotBytes));
    expect(first.finalSnapshotHash).toBe(second.finalSnapshotHash);
  });
});

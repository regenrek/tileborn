import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { DAMAGE, PROJECTILE, RESPAWN } from '../constants.js';
import {
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  TEAM_COMPONENT,
  type Player,
  type PlayerStats,
  type Position,
  type Team,
} from './components.js';
import {
  createDamageSystemState,
  recordMatchStarters,
  runDamageSystem,
  type DamageSystemContext,
  type DamageSystemState,
} from './damage-system.js';
import { createTestPluginWorld } from '../test-plugin-world.js';

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

const registerStores = (world: ReturnType<typeof createTestPluginWorld>): void => {
  world.registerComponent(POSITION_COMPONENT);
  world.registerComponent(PLAYER_COMPONENT);
  world.registerComponent(PLAYER_STATS_COMPONENT);
  world.registerComponent<Team>(TEAM_COMPONENT);
};

const spawnPlayer = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerId: string,
  x: number,
  y: number,
  health = DAMAGE.playerHealth,
  team = 'solo',
): number => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, { x, y });
  world.getComponent<Player>(PLAYER_COMPONENT).set(entity, {
    playerId,
    health,
    alive: 1,
    team,
  });
  world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT).set(entity, { kills: 0, deaths: 0 });
  world.getComponent<Team>(TEAM_COMPONENT).set(entity, { team });
  return entity;
};

/**
 * Mirror what the neutral combat path does on a lethal hit: the engine's damage
 * core has already zeroed the victim's health, and the plugin enqueues a pending
 * kill attributed to `killerId`. These tests then exercise the kill/respawn/
 * game-over emission that stays plugin-owned (`runDamageSystem`).
 */
const eliminate = (
  world: ReturnType<typeof createTestPluginWorld>,
  state: DamageSystemState,
  victimEntity: number,
  killerId: string,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const player = players.get(victimEntity);
  if (!player) {
    return;
  }
  players.set(victimEntity, { ...player, health: 0, alive: 0 });
  state.pendingKills.push({ victimEntity, victimPlayerId: player.playerId, killerId });
};

const runDamageTick = (
  world: ReturnType<typeof createTestPluginWorld>,
  tick: number,
  ctx: DamageSystemContext,
  state: ReturnType<typeof createDamageSystemState>,
): void => {
  runDamageSystem(world, tick, ctx, state);
};

describe('damage system', () => {
  it('emits exactly one PlayerKilled when two damage sources defeat a victim in the same tick', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const victim = spawnPlayer(world, 'player-victim', 0, 0, PROJECTILE.damage);
    const state = createDamageSystemState();
    const collector = createMsgCollector();

    eliminate(world, state, victim, 'player-1');
    eliminate(world, state, victim, 'zone');
    runDamageTick(world, 1, { msgOut: collector.msgOut }, state);

    const kills = collector.decodeAll().filter((message) => message._tag === 'PlayerKilled');
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({
      victim: BattleRoyaleProtocol.makePlayerId('player-victim'),
      tick: 1,
    });
  });

  it('emits GameOver once when the last opponent dies', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-winner', 0, 0);
    const loser = spawnPlayer(world, 'player-loser', 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    recordMatchStarters(world, state);
    const collector = createMsgCollector();
    const ctx: DamageSystemContext = { msgOut: collector.msgOut };

    eliminate(world, state, loser, 'player-winner');
    runDamageTick(world, 5, ctx, state);
    runDamageTick(world, 6, ctx, state);

    const gameOvers = collector.decodeAll().filter((message) => message._tag === 'GameOver');
    expect(gameOvers).toHaveLength(1);
    expect(gameOvers[0]).toMatchObject({
      winner: BattleRoyaleProtocol.makePlayerId('player-winner'),
    });
  });

  it('emits a deterministic GameOver when the zone eliminates all remaining players together', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const first = spawnPlayer(world, 'player-a', 0, 0, PROJECTILE.damage);
    const second = spawnPlayer(world, 'player-b', 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    recordMatchStarters(world, state);
    const collector = createMsgCollector();
    const ctx: DamageSystemContext = { msgOut: collector.msgOut };

    eliminate(world, state, first, 'zone');
    eliminate(world, state, second, 'zone');
    runDamageTick(world, 5, ctx, state);

    const gameOvers = collector.decodeAll().filter((message) => message._tag === 'GameOver');
    expect(gameOvers).toHaveLength(1);
    expect(gameOvers[0]).toMatchObject({
      winner: BattleRoyaleProtocol.makePlayerId('player-a'),
    });
  });

  it('ends a squad match when one team remains even while multiple teammates survive', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'alpha-1', 0, 0, DAMAGE.playerHealth, 'alpha');
    spawnPlayer(world, 'alpha-2', 2, 0, DAMAGE.playerHealth, 'alpha');
    const beta1 = spawnPlayer(world, 'beta-1', 10, 10, DAMAGE.playerHealth, 'beta');
    const beta2 = spawnPlayer(world, 'beta-2', 12, 10, DAMAGE.playerHealth, 'beta');
    const state = createDamageSystemState();
    recordMatchStarters(world, state);
    const collector = createMsgCollector();

    eliminate(world, state, beta1, 'alpha-1');
    eliminate(world, state, beta2, 'alpha-2');
    runDamageTick(world, 5, {
      msgOut: collector.msgOut,
      roomRules: { matchMode: 'squad', matchEndPolicy: 'last-standing' },
    }, state);

    const gameOvers = collector.decodeAll().filter((message) => message._tag === 'GameOver');
    expect(gameOvers).toHaveLength(1);
    expect(gameOvers[0]).toMatchObject({ winner: BattleRoyaleProtocol.makePlayerId('alpha-1') });
  });

  it('does not end while an eliminated opponent is scheduled to respawn', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-winner-for-now', 0, 0);
    const victim = spawnPlayer(world, 'player-respawning', 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    recordMatchStarters(world, state);
    const collector = createMsgCollector();
    const ctx: DamageSystemContext = {
      msgOut: collector.msgOut,
      roomRules: {
        respawnEnabled: true,
        matchEndPolicy: 'continuous',
        matchMode: 'solo',
      },
      respawnDelayTicks: 4,
    };

    eliminate(world, state, victim, 'player-winner-for-now');
    runDamageTick(world, 1, ctx, state);
    runDamageTick(world, 5, ctx, state);

    expect(collector.decodeAll().filter((message) => message._tag === 'GameOver')).toHaveLength(0);
    expect(world.getComponent<Player>(PLAYER_COMPONENT).get(victim)).toMatchObject({ alive: 1 });
  });

  it('supports continuous matches without respawn or victory emission', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-standing', 0, 0);
    const victim = spawnPlayer(world, 'player-eliminated', 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    recordMatchStarters(world, state);
    const collector = createMsgCollector();

    eliminate(world, state, victim, 'player-standing');
    runDamageTick(world, 1, {
      msgOut: collector.msgOut,
      roomRules: { respawnEnabled: false, matchEndPolicy: 'continuous' },
    }, state);

    expect(collector.decodeAll().filter((message) => message._tag === 'GameOver')).toHaveLength(0);
  });

  it('increments killer kills and victim deaths', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const killer = spawnPlayer(world, 'player-killer', 0, 0);
    const victim = spawnPlayer(world, 'player-victim', 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);

    eliminate(world, state, victim, 'player-killer');
    runDamageTick(world, 1, { msgOut: { push: () => undefined } }, state);

    expect(stats.get(killer)).toMatchObject({ kills: 1, deaths: 0 });
    expect(stats.get(victim)).toMatchObject({ kills: 0, deaths: 1 });
  });

  it('does not respawn eliminated players when respawn is disabled', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const victim = spawnPlayer(world, 'player-victim', 0, 0, PROJECTILE.damage);
    const state = createDamageSystemState();
    const players = world.getComponent<Player>(PLAYER_COMPONENT);

    eliminate(world, state, victim, 'player-killer');
    runDamageTick(
      world,
      1,
      { msgOut: { push: () => undefined }, roomRules: { respawnEnabled: false } },
      state,
    );
    runDamageTick(
      world,
      1 + RESPAWN.delayTicks,
      { msgOut: { push: () => undefined }, roomRules: { respawnEnabled: false } },
      state,
    );

    expect(players.get(victim)).toMatchObject({ alive: 0, health: 0 });
    expect(state.scheduledRespawns).toHaveLength(0);
  });

  it('respawns eliminated players at a spawn marker when respawn is enabled', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const victim = spawnPlayer(world, 'player-victim', 0, 0, PROJECTILE.damage);
    const state = createDamageSystemState();
    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const respawnDelayTicks = 4;

    eliminate(world, state, victim, 'player-killer');
    runDamageTick(
      world,
      1,
      {
        msgOut: { push: () => undefined },
        roomRules: { respawnEnabled: true },
        spawnSlots: [{ x: 32, y: 48 }],
        respawnDelayTicks,
      },
      state,
    );

    expect(players.get(victim)).toMatchObject({ alive: 0, health: 0 });

    runDamageTick(
      world,
      1 + respawnDelayTicks,
      {
        msgOut: { push: () => undefined },
        roomRules: { respawnEnabled: true },
        spawnSlots: [{ x: 32, y: 48 }],
        respawnDelayTicks,
      },
      state,
    );

    expect(players.get(victim)).toMatchObject({ alive: 1, health: DAMAGE.playerHealth });
    expect(positions.get(victim)).toMatchObject({ x: 32, y: 48 });
  });
});

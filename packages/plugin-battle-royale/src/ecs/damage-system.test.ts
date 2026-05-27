import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
import { describe, expect, it } from "vitest";

import { DAMAGE, MOVEMENT, PROJECTILE, RESPAWN } from "../constants.js";
import {
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  type Player,
  type PlayerStats,
  type Position,
} from "./components.js";
import {
  applyDamage,
  createDamageSystemState,
  recordMatchStarters,
  runDamageSystem,
  type DamageSystemContext,
} from "./damage-system.js";
import { createTestPluginWorld } from "../test-plugin-world.js";

const DT = 1 / MOVEMENT.tickRate;

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
};

const spawnPlayer = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerId: string,
  x: number,
  y: number,
  health = DAMAGE.playerHealth,
  team = "solo",
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
  return entity;
};

const runDamageTick = (
  world: ReturnType<typeof createTestPluginWorld>,
  tick: number,
  ctx: DamageSystemContext,
  state: ReturnType<typeof createDamageSystemState>,
): void => {
  runDamageSystem(world, tick, ctx, state);
};

describe("damage system", () => {
  it("emits exactly one PlayerKilled when zone and projectile damage land in the same tick", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const victim = spawnPlayer(world, "player-victim", 0, 0, PROJECTILE.damage);
    const state = createDamageSystemState();
    const collector = createMsgCollector();

    applyDamage(world, victim, PROJECTILE.damage, "player-1", state);
    applyDamage(world, victim, PROJECTILE.damage, "zone", state);
    runDamageTick(world, 1, { msgOut: collector.msgOut }, state);

    const kills = collector.decodeAll().filter((message) => message._tag === "PlayerKilled");
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({
      victim: BattleRoyaleProtocol.makePlayerId("player-victim"),
      tick: 1,
    });
  });

  it("emits GameOver once when the last opponent dies", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-winner", 0, 0);
    const loser = spawnPlayer(world, "player-loser", 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    recordMatchStarters(world, state);
    const collector = createMsgCollector();
    const ctx: DamageSystemContext = { msgOut: collector.msgOut };

    applyDamage(world, loser, PROJECTILE.damage, "player-winner", state);
    runDamageTick(world, 5, ctx, state);
    runDamageTick(world, 6, ctx, state);

    const gameOvers = collector.decodeAll().filter((message) => message._tag === "GameOver");
    expect(gameOvers).toHaveLength(1);
    expect(gameOvers[0]).toMatchObject({
      winner: BattleRoyaleProtocol.makePlayerId("player-winner"),
    });
  });

  it("emits a deterministic GameOver when the zone eliminates all remaining players together", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const first = spawnPlayer(world, "player-a", 0, 0, PROJECTILE.damage);
    const second = spawnPlayer(world, "player-b", 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    recordMatchStarters(world, state);
    const collector = createMsgCollector();
    const ctx: DamageSystemContext = { msgOut: collector.msgOut };

    applyDamage(world, first, PROJECTILE.damage, "zone", state);
    applyDamage(world, second, PROJECTILE.damage, "zone", state);
    runDamageTick(world, 5, ctx, state);

    const gameOvers = collector.decodeAll().filter((message) => message._tag === "GameOver");
    expect(gameOvers).toHaveLength(1);
    expect(gameOvers[0]).toMatchObject({
      winner: BattleRoyaleProtocol.makePlayerId("player-a"),
    });
  });

  it("increments killer kills and victim deaths", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const killer = spawnPlayer(world, "player-killer", 0, 0);
    const victim = spawnPlayer(world, "player-victim", 10, 10, PROJECTILE.damage);
    const state = createDamageSystemState();
    const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);

    applyDamage(world, victim, PROJECTILE.damage, "player-killer", state);
    runDamageTick(world, 1, { msgOut: { push: () => undefined } }, state);

    expect(stats.get(killer)).toMatchObject({ kills: 1, deaths: 0 });
    expect(stats.get(victim)).toMatchObject({ kills: 0, deaths: 1 });
  });

  it("does not respawn eliminated players when respawn is disabled", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const victim = spawnPlayer(world, "player-victim", 0, 0, PROJECTILE.damage);
    const state = createDamageSystemState();
    const players = world.getComponent<Player>(PLAYER_COMPONENT);

    applyDamage(world, victim, PROJECTILE.damage, "player-killer", state);
    runDamageTick(world, 1, { msgOut: { push: () => undefined }, roomRules: { respawnEnabled: false } }, state);
    runDamageTick(
      world,
      1 + RESPAWN.delayTicks,
      { msgOut: { push: () => undefined }, roomRules: { respawnEnabled: false } },
      state,
    );

    expect(players.get(victim)).toMatchObject({ alive: 0, health: 0 });
    expect(state.scheduledRespawns).toHaveLength(0);
  });

  it("respawns eliminated players at a spawn marker when respawn is enabled", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const victim = spawnPlayer(world, "player-victim", 0, 0, PROJECTILE.damage);
    const state = createDamageSystemState();
    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const respawnDelayTicks = 4;

    applyDamage(world, victim, PROJECTILE.damage, "player-killer", state);
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

export { DT };

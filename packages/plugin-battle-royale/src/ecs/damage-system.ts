import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';

const { encodeMessage, GameOver, makePlayerId, PlayerKilled } = BattleRoyaleProtocol;

import { DAMAGE, RESPAWN } from '../constants.js';
import type { PluginWorld } from '../types/runtime-plugin.js';
import {
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  type Player,
  type PlayerStats,
  type Position,
} from './components.js';
import type { SpawnSlot } from './spawn-players.js';
import { countAllPlayers } from './spawn-players.js';

export interface RoomRulesConfig {
  readonly respawnEnabled: boolean;
  readonly friendlyFire: boolean;
  readonly matchMode: 'solo' | 'duo' | 'squad';
}

export const DEFAULT_ROOM_RULES: RoomRulesConfig = {
  respawnEnabled: false,
  friendlyFire: false,
  matchMode: 'solo',
};

export interface DamageSystemContext {
  readonly msgOut: { readonly push: (frame: Uint8Array) => void };
  readonly roomRules?: Partial<RoomRulesConfig>;
  readonly spawnSlots?: readonly SpawnSlot[];
  readonly respawnDelayTicks?: number;
  readonly playerHealth?: number;
}

export interface PendingKill {
  readonly victimEntity: number;
  readonly victimPlayerId: string;
  readonly killerId: string;
}

export interface ScheduledRespawn {
  readonly entity: number;
  readonly atTick: number;
}

export interface DamageSystemState {
  pendingKills: PendingKill[];
  scheduledRespawns: ScheduledRespawn[];
  gameOverEmitted: boolean;
  starterCount: number | undefined;
  componentsRegistered: boolean;
  lastEliminatedPlayerIds: string[];
}

export const createDamageSystemState = (): DamageSystemState => ({
  pendingKills: [],
  scheduledRespawns: [],
  gameOverEmitted: false,
  starterCount: undefined,
  componentsRegistered: false,
  lastEliminatedPlayerIds: [],
});

export const resolveRoomRules = (partial: Partial<RoomRulesConfig> = {}): RoomRulesConfig => ({
  ...DEFAULT_ROOM_RULES,
  ...partial,
});

const registerDamageComponents = (world: PluginWorld): void => {
  world.registerComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
};

const findPlayerEntityById = (world: PluginWorld, playerId: string): number | undefined => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  for (const [entity, player] of players.entries()) {
    if (player.playerId === playerId) {
      return entity;
    }
  }
  return undefined;
};

const ensurePlayerStats = (world: PluginWorld, entity: number): void => {
  const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
  if (!stats.has(entity)) {
    stats.set(entity, { kills: 0, deaths: 0 });
  }
};

const pickRespawnSlot = (
  spawnSlots: readonly SpawnSlot[] | undefined,
  entity: number,
  tick: number,
): SpawnSlot | undefined => {
  if (!spawnSlots || spawnSlots.length === 0) {
    return undefined;
  }
  const index = (entity + tick) % spawnSlots.length;
  return spawnSlots[index];
};

export const recordMatchStarters = (world: PluginWorld, state: DamageSystemState): void => {
  if (state.starterCount !== undefined) {
    return;
  }

  state.starterCount = countAllPlayers(world);
};

const incrementPlayerStats = (
  world: PluginWorld,
  entity: number,
  field: 'kills' | 'deaths',
): void => {
  ensurePlayerStats(world, entity);
  const stats = world.getComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
  const current = stats.get(entity)!;
  stats.set(entity, {
    ...current,
    [field]: current[field] + 1,
  });
};

const emitPendingKills = (
  world: PluginWorld,
  tick: number,
  ctx: DamageSystemContext,
  state: DamageSystemState,
  roomRules: RoomRulesConfig,
): void => {
  const seenVictims = new Set<number>();
  const respawnDelayTicks = ctx.respawnDelayTicks ?? RESPAWN.delayTicks;
  const eliminatedThisTick: string[] = [];

  for (const kill of state.pendingKills) {
    if (seenVictims.has(kill.victimEntity)) {
      continue;
    }
    seenVictims.add(kill.victimEntity);
    eliminatedThisTick.push(kill.victimPlayerId);

    ctx.msgOut.push(
      encodeMessage(
        new PlayerKilled({
          killer: makePlayerId(kill.killerId),
          victim: makePlayerId(kill.victimPlayerId),
          tick,
        }),
      ),
    );

    incrementPlayerStats(world, kill.victimEntity, 'deaths');

    if (kill.killerId !== 'zone') {
      const killerEntity = findPlayerEntityById(world, kill.killerId);
      if (killerEntity !== undefined) {
        incrementPlayerStats(world, killerEntity, 'kills');
      }
    }

    if (roomRules.respawnEnabled) {
      state.scheduledRespawns.push({
        entity: kill.victimEntity,
        atTick: tick + respawnDelayTicks,
      });
    }
  }

  if (eliminatedThisTick.length > 0) {
    state.lastEliminatedPlayerIds = eliminatedThisTick;
  }
  state.pendingKills = [];
};

const processScheduledRespawns = (
  world: PluginWorld,
  tick: number,
  ctx: DamageSystemContext,
  state: DamageSystemState,
): void => {
  if (state.scheduledRespawns.length === 0) {
    return;
  }

  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const remaining: ScheduledRespawn[] = [];

  for (const respawn of state.scheduledRespawns) {
    if (respawn.atTick > tick) {
      remaining.push(respawn);
      continue;
    }

    const player = players.get(respawn.entity);
    if (!player) {
      continue;
    }

    const slot = pickRespawnSlot(ctx.spawnSlots, respawn.entity, tick);
    if (slot) {
      positions.set(respawn.entity, { x: slot.x, y: slot.y });
    }

    players.set(respawn.entity, {
      ...player,
      health: ctx.playerHealth ?? DAMAGE.playerHealth,
      alive: 1,
    });
  }

  state.scheduledRespawns = remaining;
};

const emitGameOverIfNeeded = (
  world: PluginWorld,
  ctx: DamageSystemContext,
  state: DamageSystemState,
): void => {
  if (state.gameOverEmitted) {
    return;
  }

  recordMatchStarters(world, state);
  if (state.starterCount === undefined || state.starterCount < 2) {
    return;
  }

  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  let lastAlivePlayerId: string | undefined;
  let aliveCount = 0;

  for (const [, player] of players.entries()) {
    if (player.alive !== 1) {
      continue;
    }
    aliveCount += 1;
    lastAlivePlayerId = player.playerId;
  }

  if (aliveCount !== 1 || lastAlivePlayerId === undefined) {
    if (
      aliveCount !== 0 ||
      state.lastEliminatedPlayerIds.length === 0 ||
      state.scheduledRespawns.length > 0
    ) {
      return;
    }
    lastAlivePlayerId = [...state.lastEliminatedPlayerIds].sort((left, right) =>
      left.localeCompare(right),
    )[0];
    if (lastAlivePlayerId === undefined) {
      return;
    }
  }

  state.gameOverEmitted = true;
  ctx.msgOut.push(
    encodeMessage(
      new GameOver({
        winner: makePlayerId(lastAlivePlayerId),
      }),
    ),
  );
};

export const runDamageSystem = (
  world: PluginWorld,
  tick: number,
  ctx: DamageSystemContext,
  state: DamageSystemState,
): void => {
  if (!state.componentsRegistered) {
    registerDamageComponents(world);
    state.componentsRegistered = true;
  }

  const roomRules = resolveRoomRules(ctx.roomRules);
  processScheduledRespawns(world, tick, ctx, state);
  emitPendingKills(world, tick, ctx, state, roomRules);
  emitGameOverIfNeeded(world, ctx, state);
};

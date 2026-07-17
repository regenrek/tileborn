import { HealthComponent, makeCombatEntityId } from '@tileborne/simulation';
import { describe, expect, it } from 'vitest';

import { ABILITY, DAMAGE, STATUS_EFFECT } from '../constants.js';
import { createTestPluginWorld } from '../test-plugin-world.js';
import type { RuntimePlayerInput } from '../types/runtime-plugin.js';
import {
  ABILITY_STATE_COMPONENT,
  AIM_COMPONENT,
  COLLISION_BODY_COMPONENT,
  DEPLOYABLE_COMPONENT,
  FACING_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  SHIELD_COMPONENT,
  STATUS_EFFECTS_COMPONENT,
  TEAM_COMPONENT,
  type AbilityState,
  type Aim,
  type Deployable,
  type Facing,
  type Player,
  type Position,
  type Shield,
  type StatusEffects,
  type Team,
} from './components.js';
import { createAbilityStatusSystemState, runAbilityStatusSystem } from './ability-status-system.js';
import { createBattleRoyaleCombatWorldView } from './combat-world-view.js';
import { createDamageSystemState } from './damage-system.js';

const registerBaseComponents = (world: ReturnType<typeof createTestPluginWorld>): void => {
  world.registerComponent<Player>(PLAYER_COMPONENT);
  world.registerComponent<Position>(POSITION_COMPONENT);
  world.registerComponent<Team>(TEAM_COMPONENT);
  world.registerComponent<Facing>(FACING_COMPONENT);
  world.registerComponent<Aim>(AIM_COMPONENT);
};

const spawnPlayer = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerId: string,
  position: Position,
): number => {
  const entity = world.createEntity();
  world.getComponent<Player>(PLAYER_COMPONENT).set(entity, {
    playerId,
    health: DAMAGE.playerHealth,
    alive: 1,
    team: 'solo',
  });
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, position);
  world.getComponent<Team>(TEAM_COMPONENT).set(entity, { team: 'solo' });
  world.getComponent<Facing>(FACING_COMPONENT).set(entity, { dir: 0 });
  world.getComponent<Aim>(AIM_COMPONENT).set(entity, { deg: 0 });
  return entity;
};

const baseInput = (overrides: Partial<RuntimePlayerInput>): RuntimePlayerInput => ({
  tick: overrides.tick ?? 1,
  seq: overrides.seq ?? 1,
  shoot: false,
  reload: false,
  interact: false,
  drop: false,
  abilities: [],
  ...overrides,
});

const runSystem = (
  world: ReturnType<typeof createTestPluginWorld>,
  inputByPlayerId: ReadonlyMap<string, RuntimePlayerInput>,
  tick: number,
  state = createAbilityStatusSystemState(),
) => {
  const damageState = createDamageSystemState();
  runAbilityStatusSystem(
    world,
    {
      tick,
      getPlayerInput: (playerId) => inputByPlayerId.get(playerId),
      roomRules: { respawnEnabled: false, friendlyFire: false, matchMode: 'solo' },
    },
    state,
    damageState,
  );
  return { state, damageState };
};

describe('Battle Royale ability and status system', () => {
  it('dashes once per input sequence and arms the dash cooldown', () => {
    const world = createTestPluginWorld();
    registerBaseComponents(world);
    const player = spawnPlayer(world, 'player-1', { x: 0, y: 0 });
    const state = createAbilityStatusSystemState();
    const input = baseInput({ abilities: [ABILITY.dash.id] });

    runSystem(world, new Map([['player-1', input]]), 1, state);
    expect(world.getComponent<Position>(POSITION_COMPONENT).get(player)?.x).toBe(
      ABILITY.dash.distance,
    );
    expect(
      world.getComponent<AbilityState>(ABILITY_STATE_COMPONENT).get(player)?.cooldowns,
    ).toEqual([{ abilityId: ABILITY.dash.id, remainingTicks: ABILITY.dash.cooldownTicks }]);

    runSystem(world, new Map([['player-1', input]]), 2, state);
    expect(world.getComponent<Position>(POSITION_COMPONENT).get(player)?.x).toBe(
      ABILITY.dash.distance,
    );
  });

  it('shield burst absorbs canonical combat damage through the world view', () => {
    const world = createTestPluginWorld();
    registerBaseComponents(world);
    const player = spawnPlayer(world, 'player-1', { x: 0, y: 0 });

    runSystem(
      world,
      new Map([['player-1', baseInput({ abilities: [ABILITY.shieldBurst.id] })]]),
      1,
    );
    expect(world.getComponent<Shield>(SHIELD_COMPONENT).get(player)).toEqual({
      current: ABILITY.shieldBurst.shieldAmount,
      max: ABILITY.shieldBurst.shieldAmount,
    });

    const worldView = createBattleRoyaleCombatWorldView(
      world,
      {
        maxHealth: DAMAGE.playerHealth,
        footprintOffsetY: 0,
      },
      [],
    );
    worldView.setHealth(makeCombatEntityId(player), new HealthComponent({ current: 70, max: 100 }));

    expect(world.getComponent<Player>(PLAYER_COMPONENT).get(player)?.health).toBe(
      DAMAGE.playerHealth,
    );
    expect(world.getComponent<Shield>(SHIELD_COMPONENT).get(player)?.current).toBe(20);
  });

  it('scan pulse reveals hostile players in radius', () => {
    const world = createTestPluginWorld();
    registerBaseComponents(world);
    spawnPlayer(world, 'player-1', { x: 0, y: 0 });
    const target = spawnPlayer(world, 'player-2', { x: 40, y: 0 });

    runSystem(world, new Map([['player-1', baseInput({ abilities: [ABILITY.scanPulse.id] })]]), 1);

    expect(
      world.getComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT).get(target)?.effects,
    ).toContainEqual({
      effectId: STATUS_EFFECT.reveal.id,
      remainingTicks: ABILITY.scanPulse.revealTicks,
      stacks: 1,
      sourcePlayerId: 'player-1',
    });
  });

  it('trap deployables arm, trigger, and apply slow stun and damage-over-time', () => {
    const world = createTestPluginWorld();
    registerBaseComponents(world);
    spawnPlayer(world, 'player-1', { x: 0, y: 0 });
    const target = spawnPlayer(world, 'player-2', { x: ABILITY.trap.deployDistance, y: 0 });
    const state = createAbilityStatusSystemState();

    runSystem(
      world,
      new Map([['player-1', baseInput({ abilities: [ABILITY.trap.id] })]]),
      1,
      state,
    );
    for (let tick = 2; tick <= ABILITY.trap.armTicks + 2; tick += 1) {
      runSystem(world, new Map(), tick, state);
    }

    const statuses =
      world.getComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT).get(target)?.effects ?? [];
    expect(statuses.map((status) => status.effectId).sort()).toEqual([
      STATUS_EFFECT.damageOverTime.id,
      STATUS_EFFECT.slow.id,
      STATUS_EFFECT.stun.id,
    ]);
    expect(
      [...world.getComponent<Deployable>(DEPLOYABLE_COMPONENT).entries()][0]?.[1].triggered,
    ).toBe(true);
  });

  it('decoys create projectile-blocking deployable collision', () => {
    const world = createTestPluginWorld();
    registerBaseComponents(world);
    spawnPlayer(world, 'player-1', { x: 0, y: 0 });

    runSystem(world, new Map([['player-1', baseInput({ abilities: [ABILITY.decoy.id] })]]), 1);

    const deployable = [...world.getComponent<Deployable>(DEPLOYABLE_COMPONENT).entries()][0];
    expect(deployable?.[1]).toMatchObject({ kind: 'decoy', ownerId: 'player-1' });
    expect(world.getComponent(COLLISION_BODY_COMPONENT).get(deployable![0])).toMatchObject({
      blocksProjectiles: true,
      blocksMovement: false,
    });
  });
});

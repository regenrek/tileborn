import { ABILITY, STATUS_EFFECT } from "../constants.js";
import type { PluginWorld, RuntimePlayerInput } from "../types/runtime-plugin.js";
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
  type AbilityState,
  type Aim,
  type CollisionBody,
  type Deployable,
  type Direction8,
  type Facing,
  type Player,
  type Position,
  type Shield,
  type StatusEffects,
} from "./components.js";
import { type PluginCollisionEnvironment, resolvePlayerCollision } from "./collision.js";
import type { DamageSystemState, RoomRulesConfig } from "./damage-system.js";
import { direction8ToUnitVector } from "./movement.js";
import {
  DEFAULT_PLAYER_PHYSICS,
  physicsForPlayer,
  type PlayerPhysicsProfile,
} from "./player-physics.js";

type AbilityId = RuntimePlayerInput["abilities"][number];

export interface AbilityStatusSystemState {
  componentsRegistered: boolean;
  readonly consumedInputByPlayerAbility: Map<string, string>;
}

export interface AbilityStatusSystemContext {
  readonly tick: number;
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly collisionEnvironment?: PluginCollisionEnvironment;
  readonly roomRules: RoomRulesConfig;
  readonly bodyByModelId?: ReadonlyMap<string, PlayerPhysicsProfile>;
  readonly defaultPlayerPhysics?: PlayerPhysicsProfile;
}

export const createAbilityStatusSystemState = (): AbilityStatusSystemState => ({
  componentsRegistered: false,
  consumedInputByPlayerAbility: new Map(),
});

const registerAbilityStatusComponents = (world: PluginWorld): void => {
  world.registerComponent<AbilityState>(ABILITY_STATE_COMPONENT);
  world.registerComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT);
  world.registerComponent<Shield>(SHIELD_COMPONENT);
  world.registerComponent<Deployable>(DEPLOYABLE_COMPONENT);
  world.registerComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
};

const abilityStateFor = (state: AbilityState | undefined): AbilityState => ({
  activeAbilityId: state?.activeAbilityId,
  charges: state?.charges ?? 0,
  cooldownTicks: state?.cooldownTicks ?? 0,
  cooldowns: state?.cooldowns ?? [],
});

const cooldownRemaining = (state: AbilityState, abilityId: AbilityId): number =>
  state.cooldowns.find((cooldown) => cooldown.abilityId === abilityId)?.remainingTicks ?? 0;

const setCooldown = (state: AbilityState, abilityId: AbilityId, ticks: number): AbilityState => {
  const nextCooldowns = [
    ...state.cooldowns.filter((cooldown) => cooldown.abilityId !== abilityId),
    { abilityId, remainingTicks: Math.max(0, Math.floor(ticks)) },
  ]
    .filter((cooldown) => cooldown.remainingTicks > 0)
    .sort((left, right) => left.abilityId.localeCompare(right.abilityId));
  return {
    ...state,
    activeAbilityId: abilityId,
    cooldownTicks: nextCooldowns.reduce((max, cooldown) => Math.max(max, cooldown.remainingTicks), 0),
    cooldowns: nextCooldowns,
  };
};

const tickCooldowns = (state: AbilityState): AbilityState => {
  const cooldowns = state.cooldowns
    .map((cooldown) => ({ ...cooldown, remainingTicks: Math.max(0, cooldown.remainingTicks - 1) }))
    .filter((cooldown) => cooldown.remainingTicks > 0)
    .sort((left, right) => left.abilityId.localeCompare(right.abilityId));
  return {
    ...state,
    activeAbilityId: undefined,
    cooldownTicks: cooldowns.reduce((max, cooldown) => Math.max(max, cooldown.remainingTicks), 0),
    cooldowns,
  };
};

const hasStatus = (status: StatusEffects | undefined, effectId: string): boolean =>
  status?.effects.some((effect) => effect.effectId === effectId && effect.remainingTicks > 0) ?? false;

const statusEffectsFor = (world: PluginWorld, entity: number): StatusEffects | undefined => {
  try {
    return world.getComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT).get(entity);
  } catch (cause) {
    if (cause instanceof Error && cause.message === `component not registered: ${STATUS_EFFECTS_COMPONENT}`) {
      return undefined;
    }
    throw cause;
  }
};

export const isBlockedByStun = (world: PluginWorld, entity: number): boolean =>
  hasStatus(statusEffectsFor(world, entity), STATUS_EFFECT.stun.id);

export const movementMultiplierForStatus = (world: PluginWorld, entity: number): number =>
  hasStatus(statusEffectsFor(world, entity), STATUS_EFFECT.slow.id)
    ? STATUS_EFFECT.slow.movementMultiplier
    : 1;

const addStatus = (
  world: PluginWorld,
  entity: number,
  effectId: string,
  remainingTicks: number,
  sourcePlayerId?: string,
): void => {
  if (remainingTicks <= 0) {
    return;
  }
  const statuses = world.getComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT);
  const current = statuses.get(entity)?.effects ?? [];
  const existing = current.find((effect) => effect.effectId === effectId);
  const nextEffect = {
    effectId,
    remainingTicks: Math.max(existing?.remainingTicks ?? 0, Math.floor(remainingTicks)),
    stacks: Math.min(9, (existing?.stacks ?? 0) + 1),
    ...(sourcePlayerId === undefined ? {} : { sourcePlayerId }),
  };
  statuses.set(entity, {
    effects: [
      ...current.filter((effect) => effect.effectId !== effectId),
      nextEffect,
    ].sort((left, right) => left.effectId.localeCompare(right.effectId)),
  });
};

const applyDamageWithShield = (
  world: PluginWorld,
  entity: number,
  damage: number,
  sourcePlayerId: string,
  damageState: DamageSystemState,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const player = players.get(entity);
  if (!player || player.alive !== 1 || damage <= 0) {
    return;
  }
  const shields = world.getComponent<Shield>(SHIELD_COMPONENT);
  const shield = shields.get(entity);
  const absorbed = Math.min(shield?.current ?? 0, damage);
  if (shield) {
    shields.set(entity, { ...shield, current: Math.max(0, shield.current - absorbed) });
  }
  const nextHealth = Math.max(0, player.health - (damage - absorbed));
  players.set(entity, { ...player, health: nextHealth, alive: nextHealth > 0 ? 1 : 0 });
  if (nextHealth <= 0) {
    damageState.pendingKills.push({
      victimEntity: entity,
      victimPlayerId: player.playerId,
      killerId: sourcePlayerId,
    });
  }
};

const tickStatuses = (
  world: PluginWorld,
  damageState: DamageSystemState,
): void => {
  const statuses = world.getComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT);
  const shields = world.getComponent<Shield>(SHIELD_COMPONENT);
  for (const [entity, status] of [...statuses.entries()].sort(([left], [right]) => left - right)) {
    for (const effect of status.effects) {
      if (effect.effectId === STATUS_EFFECT.damageOverTime.id && effect.remainingTicks > 0) {
        applyDamageWithShield(
          world,
          entity,
          STATUS_EFFECT.damageOverTime.damagePerTick,
          effect.sourcePlayerId ?? "damage-over-time",
          damageState,
        );
      }
    }
    const nextEffects = status.effects
      .map((effect) => ({ ...effect, remainingTicks: Math.max(0, effect.remainingTicks - 1) }))
      .filter((effect) => effect.remainingTicks > 0)
      .sort((left, right) => left.effectId.localeCompare(right.effectId));
    statuses.set(entity, { effects: nextEffects });
    if (!nextEffects.some((effect) => effect.effectId === STATUS_EFFECT.shield.id)) {
      const shield = shields.get(entity);
      if (shield && (shield.current > 0 || shield.max > 0)) {
        shields.set(entity, { current: 0, max: 0 });
      }
    }
  }
};

const isHostilePlayer = (
  world: PluginWorld,
  source: Player,
  target: Player,
  ctx: AbilityStatusSystemContext,
): boolean => {
  if (source.playerId === target.playerId) {
    return false;
  }
  if (ctx.roomRules.matchMode === "solo" || ctx.roomRules.friendlyFire) {
    return true;
  }
  return source.team !== target.team;
};

const aimDirection = (
  aim: Aim | undefined,
  facing: Facing | undefined,
): { readonly x: number; readonly y: number } => {
  if (aim) {
    const radians = (aim.deg * Math.PI) / 180;
    return { x: Math.cos(radians), y: Math.sin(radians) };
  }
  return direction8ToUnitVector((facing?.dir ?? 0) as Direction8);
};

const moveWithCollision = (
  position: Position,
  body: PlayerPhysicsProfile,
  dx: number,
  dy: number,
  collisionEnvironment: PluginCollisionEnvironment | undefined,
): Position => {
  const next = { ...position };
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, body.radius / 2)));
  for (let step = 0; step < steps; step += 1) {
    next.x += dx / steps;
    next.y += dy / steps;
    if (collisionEnvironment) {
      resolvePlayerCollision(next, collisionEnvironment, body.radius, { x: body.offsetX, y: body.offsetY });
    }
  }
  return next;
};

const deployPosition = (
  playerPosition: Position,
  direction: { readonly x: number; readonly y: number },
  distance: number,
): Position => ({
  x: playerPosition.x + direction.x * distance,
  y: playerPosition.y + direction.y * distance,
});

const activateDash = (
  world: PluginWorld,
  entity: number,
  player: Player,
  ctx: AbilityStatusSystemContext,
): void => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const position = positions.get(entity);
  if (!position) {
    return;
  }
  const direction = aimDirection(
    world.getComponent<Aim>(AIM_COMPONENT).get(entity),
    world.getComponent<Facing>(FACING_COMPONENT).get(entity),
  );
  const body = physicsForPlayer(player, ctx.bodyByModelId, ctx.defaultPlayerPhysics ?? DEFAULT_PLAYER_PHYSICS);
  positions.set(
    entity,
    moveWithCollision(
      position,
      body,
      direction.x * ABILITY.dash.distance,
      direction.y * ABILITY.dash.distance,
      ctx.collisionEnvironment,
    ),
  );
};

const activateShield = (world: PluginWorld, entity: number): void => {
  world.getComponent<Shield>(SHIELD_COMPONENT).set(entity, {
    current: ABILITY.shieldBurst.shieldAmount,
    max: ABILITY.shieldBurst.shieldAmount,
  });
  addStatus(world, entity, STATUS_EFFECT.shield.id, ABILITY.shieldBurst.durationTicks);
};

const createDeployable = (
  world: PluginWorld,
  kind: Deployable["kind"],
  ownerId: string,
  position: Position,
  radius: number,
  remainingTicks: number,
  armedTicks: number,
): number => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, position);
  world.getComponent<Deployable>(DEPLOYABLE_COMPONENT).set(entity, {
    kind,
    ownerId,
    radius,
    remainingTicks,
    armedTicks,
    triggered: false,
  });
  return entity;
};

const activateScan = (
  world: PluginWorld,
  entity: number,
  player: Player,
  ctx: AbilityStatusSystemContext,
): void => {
  const position = world.getComponent<Position>(POSITION_COMPONENT).get(entity);
  if (!position) {
    return;
  }
  createDeployable(
    world,
    "scan-pulse",
    player.playerId,
    position,
    ABILITY.scanPulse.radius,
    ABILITY.scanPulse.durationTicks,
    0,
  );
  applyRevealInRadius(world, player, position, ABILITY.scanPulse.radius, ABILITY.scanPulse.revealTicks, ctx);
};

const activateTrapOrDecoy = (
  world: PluginWorld,
  entity: number,
  player: Player,
  kind: "trap" | "decoy",
): void => {
  const position = world.getComponent<Position>(POSITION_COMPONENT).get(entity);
  if (!position) {
    return;
  }
  const direction = aimDirection(
    world.getComponent<Aim>(AIM_COMPONENT).get(entity),
    world.getComponent<Facing>(FACING_COMPONENT).get(entity),
  );
  const config = kind === "trap" ? ABILITY.trap : ABILITY.decoy;
  const deployedEntity = createDeployable(
    world,
    kind,
    player.playerId,
    deployPosition(position, direction, config.deployDistance),
    config.radius,
    config.durationTicks,
    kind === "trap" ? ABILITY.trap.armTicks : 0,
  );
  if (kind === "decoy") {
    const deployedPosition = world.getComponent<Position>(POSITION_COMPONENT).get(deployedEntity)!;
    world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT).set(deployedEntity, {
      objectId: `deployable:${deployedEntity}`,
      x: deployedPosition.x - ABILITY.decoy.radius,
      y: deployedPosition.y - ABILITY.decoy.radius,
      width: ABILITY.decoy.radius * 2,
      height: ABILITY.decoy.radius * 2,
      blocksMovement: false,
      blocksProjectiles: true,
      blocksVision: false,
    });
  }
};

const applyRevealInRadius = (
  world: PluginWorld,
  source: Player,
  center: Position,
  radius: number,
  remainingTicks: number,
  ctx: AbilityStatusSystemContext,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  for (const [entity, target] of players.entries()) {
    const position = positions.get(entity);
    if (!position || target.alive !== 1 || !isHostilePlayer(world, source, target, ctx)) {
      continue;
    }
    if (Math.hypot(position.x - center.x, position.y - center.y) <= radius) {
      addStatus(world, entity, STATUS_EFFECT.reveal.id, remainingTicks, source.playerId);
    }
  }
};

const triggerTrap = (
  world: PluginWorld,
  trapEntity: number,
  trap: Deployable,
  trapPosition: Position,
  source: Player | undefined,
  ctx: AbilityStatusSystemContext,
): boolean => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  for (const [entity, target] of [...players.entries()].sort(([, left], [, right]) => left.playerId.localeCompare(right.playerId))) {
    const position = positions.get(entity);
    if (!position || target.alive !== 1 || (source !== undefined && !isHostilePlayer(world, source, target, ctx))) {
      continue;
    }
    if (Math.hypot(position.x - trapPosition.x, position.y - trapPosition.y) > trap.radius) {
      continue;
    }
    addStatus(world, entity, STATUS_EFFECT.slow.id, ABILITY.trap.slowTicks, source?.playerId);
    addStatus(world, entity, STATUS_EFFECT.stun.id, ABILITY.trap.stunTicks, source?.playerId);
    addStatus(world, entity, STATUS_EFFECT.damageOverTime.id, ABILITY.trap.damageTicks, source?.playerId);
    world.getComponent<Deployable>(DEPLOYABLE_COMPONENT).set(trapEntity, {
      ...trap,
      triggered: true,
      remainingTicks: Math.min(trap.remainingTicks, 20),
    });
    return true;
  }
  return false;
};

const playerById = (world: PluginWorld, playerId: string): Player | undefined => {
  for (const [, player] of world.getComponent<Player>(PLAYER_COMPONENT).entries()) {
    if (player.playerId === playerId) {
      return player;
    }
  }
  return undefined;
};

const tickDeployables = (world: PluginWorld, ctx: AbilityStatusSystemContext): void => {
  const deployables = world.getComponent<Deployable>(DEPLOYABLE_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  for (const [entity, deployable] of [...deployables.entries()].sort(([left], [right]) => left - right)) {
    const remainingTicks = deployable.remainingTicks - 1;
    const armedTicks = Math.max(0, deployable.armedTicks - 1);
    const position = positions.get(entity);
    const owner = playerById(world, deployable.ownerId);
    if (remainingTicks <= 0 || !position) {
      world.destroyEntity(entity);
      continue;
    }
    const next = { ...deployable, remainingTicks, armedTicks };
    deployables.set(entity, next);
    if (next.kind === "trap" && !next.triggered && next.armedTicks === 0) {
      triggerTrap(world, entity, next, position, owner, ctx);
    }
  }
};

const triggeredAbilities = (input: RuntimePlayerInput): readonly AbilityId[] => input.abilities;

const cooldownForAbility = (abilityId: AbilityId): number => {
  switch (abilityId) {
    case ABILITY.dash.id:
      return ABILITY.dash.cooldownTicks;
    case ABILITY.shieldBurst.id:
      return ABILITY.shieldBurst.cooldownTicks;
    case ABILITY.scanPulse.id:
      return ABILITY.scanPulse.cooldownTicks;
    case ABILITY.trap.id:
      return ABILITY.trap.cooldownTicks;
    case ABILITY.decoy.id:
      return ABILITY.decoy.cooldownTicks;
  }
};

const activateAbility = (
  world: PluginWorld,
  entity: number,
  player: Player,
  abilityId: AbilityId,
  ctx: AbilityStatusSystemContext,
): void => {
  switch (abilityId) {
    case ABILITY.dash.id:
      activateDash(world, entity, player, ctx);
      break;
    case ABILITY.shieldBurst.id:
      activateShield(world, entity);
      break;
    case ABILITY.scanPulse.id:
      activateScan(world, entity, player, ctx);
      break;
    case ABILITY.trap.id:
      activateTrapOrDecoy(world, entity, player, "trap");
      break;
    case ABILITY.decoy.id:
      activateTrapOrDecoy(world, entity, player, "decoy");
      break;
  }
};

const processAbilityInputs = (
  world: PluginWorld,
  ctx: AbilityStatusSystemContext,
  state: AbilityStatusSystemState,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const abilityStates = world.getComponent<AbilityState>(ABILITY_STATE_COMPONENT);
  for (const [entity, player] of [...players.entries()].sort(([, left], [, right]) => left.playerId.localeCompare(right.playerId))) {
    const current = abilityStateFor(abilityStates.get(entity));
    abilityStates.set(entity, tickCooldowns(current));
    if (player.alive !== 1 || isBlockedByStun(world, entity)) {
      continue;
    }
    const input = ctx.getPlayerInput?.(player.playerId);
    if (!input) {
      continue;
    }
    for (const abilityId of triggeredAbilities(input)) {
      const inputKey = `${input.tick}:${input.seq}`;
      const consumedKey = `${player.playerId}:${abilityId}`;
      if (state.consumedInputByPlayerAbility.get(consumedKey) === inputKey) {
        continue;
      }
      state.consumedInputByPlayerAbility.set(consumedKey, inputKey);
      const refreshed = abilityStateFor(abilityStates.get(entity));
      if (cooldownRemaining(refreshed, abilityId) > 0) {
        continue;
      }
      activateAbility(world, entity, player, abilityId, ctx);
      abilityStates.set(entity, setCooldown(refreshed, abilityId, cooldownForAbility(abilityId)));
    }
  }
};

export const runAbilityStatusSystem = (
  world: PluginWorld,
  ctx: AbilityStatusSystemContext,
  state: AbilityStatusSystemState,
  damageState: DamageSystemState,
): void => {
  if (!state.componentsRegistered) {
    registerAbilityStatusComponents(world);
    state.componentsRegistered = true;
  }
  tickStatuses(world, damageState);
  tickDeployables(world, ctx);
  processAbilityInputs(world, ctx, state);
};

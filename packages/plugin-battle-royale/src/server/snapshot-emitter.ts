import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';
import { Option } from 'effect';

import { MOVEMENT } from '../constants.js';
import {
  ANIMATION_STATE_COMPONENT,
  ABILITY_STATE_COMPONENT,
  AMMO_RESERVE_COMPONENT,
  ARMOR_COMPONENT,
  BREAKABLE_COMPONENT,
  DAMAGE_INDICATOR_COMPONENT,
  DEPLOYABLE_COMPONENT,
  EQUIPPED_WEAPON_COMPONENT,
  HAZARD_COMPONENT,
  INTERACTABLE_COMPONENT,
  INVENTORY_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  PICKUP_TOAST_COMPONENT,
  PROJECTILE_COMPONENT,
  RELOAD_STATE_COMPONENT,
  SHIELD_COMPONENT,
  STATUS_EFFECTS_COMPONENT,
  WEAPON_RUNTIME_STATE_COMPONENT,
  type AbilityState,
  type AmmoReserve,
  type AnimationState,
  type Armor,
  type Breakable,
  type DamageIndicator,
  type Deployable,
  type EquippedWeapon,
  type Hazard,
  type Interactable,
  type Inventory,
  type LootSource,
  type Player,
  type PlayerStats,
  type Pickup,
  type PickupPrompt,
  type PickupToast,
  type Position,
  type Projectile,
  type ReloadState,
  type Shield,
  type StatusEffects,
  type WeaponRuntimeState,
} from '../ecs/components.js';
import { getZone } from '../ecs/zone.js';
import type { ComponentStore, PluginWorld, RuntimeMessageOut } from '../types/runtime-plugin.js';

const {
  DeltaSnapshot,
  DeployableSnapshot,
  DeployableUpdate,
  ObjectSnapshot,
  ProjectileSnapshot,
  ProjectileUpdate,
  WelcomeSnapshot,
  encodeServerMessage,
  makeDeployableId,
  makeDeployableOwnerId,
  makeObjectId,
  makePlayerId,
  makeProjectileId,
} = BattleRoyaleProtocol;

export const MAX_DELTA_SNAPSHOT_BYTES = 1536;

export type SnapshotSeed = string | number;

interface CapturedPlayerSnapshot {
  readonly id: string;
  readonly team?: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly shield?: number;
  readonly armor?: BattleRoyaleProtocol.PlayerArmorSnapshot;
  readonly weapon?: BattleRoyaleProtocol.PlayerWeaponSnapshot;
  readonly inventory?: BattleRoyaleProtocol.PlayerInventorySnapshot;
  readonly pickupPrompt?: BattleRoyaleProtocol.PlayerPickupPromptSnapshot;
  readonly pickupToast?: BattleRoyaleProtocol.PlayerPickupToastSnapshot;
  readonly damageIndicator?: BattleRoyaleProtocol.PlayerDamageIndicatorSnapshot;
  readonly stats?: BattleRoyaleProtocol.PlayerStatsSnapshot;
  readonly statusEffects?: readonly BattleRoyaleProtocol.PlayerStatusSnapshot[];
  readonly abilityCooldowns?: readonly BattleRoyaleProtocol.PlayerAbilityCooldownSnapshot[];
  readonly modelId?: string;
  readonly animation?: BattleRoyaleProtocol.PlayerAnimationState;
}

interface CapturedProjectileSnapshot {
  readonly id: string;
  readonly ownerPlayerId: string;
  readonly weaponSlot: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly rotation: number;
  readonly ttlMs: number;
}

interface CapturedDeployableSnapshot {
  readonly id: string;
  readonly kind: BattleRoyaleProtocol.DeployableKind;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly remainingTicks: number;
  readonly armedTicks: number;
  readonly triggered: boolean;
}

interface CapturedObjectSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly pickup?: BattleRoyaleProtocol.ObjectPickupSnapshot;
  readonly lootSource?: BattleRoyaleProtocol.ObjectLootSourceSnapshot;
  readonly interactable?: BattleRoyaleProtocol.ObjectInteractableSnapshot;
  readonly breakable?: BattleRoyaleProtocol.ObjectBreakableSnapshot;
  readonly hazard?: BattleRoyaleProtocol.ObjectHazardSnapshot;
}

interface CapturedSnapshot {
  readonly serverTimestampMs: number;
  readonly players: readonly CapturedPlayerSnapshot[];
  readonly projectiles: readonly CapturedProjectileSnapshot[];
  readonly deployables: readonly CapturedDeployableSnapshot[];
  readonly objects: readonly CapturedObjectSnapshot[];
  readonly zone: BattleRoyaleProtocol.ZoneState;
}

const emptyZone = (): BattleRoyaleProtocol.ZoneState => ({
  cx: 0,
  cy: 0,
  radius: 0,
});

const protocolHealth = (health: number): number => Math.max(0, Math.round(health));

const protocolProjectileTtlMs = (ttlTicks: number): number => Math.max(0, Math.round(ttlTicks));

const serverTimestampForTick = (tick: number): number => tick * (1000 / MOVEMENT.tickRate);

const projectileEntries = (world: PluginWorld): Iterable<[number, Projectile]> => {
  try {
    return world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries();
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message === `component not registered: ${PROJECTILE_COMPONENT}`
    ) {
      return [];
    }
    throw cause;
  }
};

const deployableEntries = (world: PluginWorld): Iterable<[number, Deployable]> => {
  try {
    return world.getComponent<Deployable>(DEPLOYABLE_COMPONENT).entries();
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message === `component not registered: ${DEPLOYABLE_COMPONENT}`
    ) {
      return [];
    }
    throw cause;
  }
};

const optionalComponent = <Value extends object>(world: PluginWorld, componentName: string) => {
  try {
    return world.getComponent<Value>(componentName);
  } catch (cause) {
    if (cause instanceof Error && cause.message === `component not registered: ${componentName}`) {
      return undefined;
    }
    throw cause;
  }
};

const playerStatusEffects = (
  status: StatusEffects | undefined,
): readonly BattleRoyaleProtocol.PlayerStatusSnapshot[] =>
  (status?.effects ?? [])
    .filter((effect) => effect.remainingTicks > 0)
    .map((effect) => ({
      effectId: effect.effectId,
      remainingTicks: effect.remainingTicks,
      stacks: effect.stacks,
    }))
    .sort((left, right) => left.effectId.localeCompare(right.effectId));

const playerAbilityCooldowns = (
  abilityState: AbilityState | undefined,
): readonly BattleRoyaleProtocol.PlayerAbilityCooldownSnapshot[] =>
  (abilityState?.cooldowns ?? [])
    .filter((cooldown) => cooldown.remainingTicks > 0)
    .map((cooldown) => ({
      abilityId: cooldown.abilityId,
      remainingTicks: cooldown.remainingTicks,
    }))
    .sort((left, right) => left.abilityId.localeCompare(right.abilityId));

const reserveAmount = (reserve: AmmoReserve | undefined, weaponId: string): number | undefined =>
  reserve?.stacks.find((stack) => stack.ammoKind === weaponId)?.amount;

const playerWeaponSnapshot = (
  equipped: EquippedWeapon | undefined,
  reserve: AmmoReserve | undefined,
  reload: ReloadState | undefined,
  runtime: WeaponRuntimeState | undefined,
): BattleRoyaleProtocol.PlayerWeaponSnapshot | undefined => {
  if (runtime !== undefined) {
    const reserveAmmo = reserveAmount(reserve, runtime.weaponId);
    return {
      weaponId: runtime.weaponId,
      slot: runtime.slot,
      ammoInMagazine: runtime.ammoInMagazine,
      magazineSize: runtime.magazineSize,
      ...(reserveAmmo === undefined ? {} : { reserveAmmo }),
      cooldownRemainingTicks: runtime.cooldownRemainingTicks,
      reloadRemainingTicks: runtime.reloadRemainingTicks,
      reloadTotalTicks: runtime.reloadTotalTicks,
    };
  }
  if (equipped === undefined) {
    return undefined;
  }
  const reserveAmmo = reserveAmount(reserve, equipped.weaponId);
  return {
    weaponId: equipped.weaponId,
    slot: equipped.slot,
    ...(reserveAmmo === undefined ? {} : { reserveAmmo }),
    ...(reload?.remainingTicks === undefined
      ? {}
      : { reloadRemainingTicks: reload.remainingTicks }),
  };
};

const playerPickupPrompt = (
  prompt: PickupPrompt | undefined,
): BattleRoyaleProtocol.PlayerPickupPromptSnapshot | undefined =>
  prompt === undefined
    ? undefined
    : {
        ...(prompt.itemKind === undefined ? {} : { itemKind: prompt.itemKind }),
        ...(prompt.tier === undefined ? {} : { tier: prompt.tier }),
        ...(prompt.distance === undefined ? {} : { distance: prompt.distance }),
        action: prompt.action,
        available: prompt.available,
      };

const captureObjects = (
  world: PluginWorld,
  positions: ComponentStore<Position>,
): readonly CapturedObjectSnapshot[] => {
  const pickups = optionalComponent<Pickup>(world, PICKUP_COMPONENT);
  const lootSources = optionalComponent<LootSource>(world, LOOT_SOURCE_COMPONENT);
  const interactables = optionalComponent<Interactable>(world, INTERACTABLE_COMPONENT);
  const breakables = optionalComponent<Breakable>(world, BREAKABLE_COMPONENT);
  const hazards = optionalComponent<Hazard>(world, HAZARD_COMPONENT);
  const objectEntities = new Set<number>();

  for (const store of [pickups, lootSources, interactables, breakables, hazards]) {
    for (const [entity] of store?.entries() ?? []) {
      objectEntities.add(entity);
    }
  }

  return [...objectEntities]
    .sort((left, right) => left - right)
    .flatMap((entity): readonly CapturedObjectSnapshot[] => {
      const position = positions.get(entity);
      if (!position) {
        return [];
      }
      const pickup = pickups?.get(entity);
      const lootSource = lootSources?.get(entity);
      const interactable = interactables?.get(entity);
      const breakable = breakables?.get(entity);
      const hazard = hazards?.get(entity);
      return [
        {
          id: String(entity),
          x: position.x,
          y: position.y,
          ...(pickup === undefined ? {} : { pickup }),
          ...(lootSource === undefined ? {} : { lootSource }),
          ...(interactable === undefined ? {} : { interactable }),
          ...(breakable === undefined ? {} : { breakable }),
          ...(hazard === undefined ? {} : { hazard }),
        },
      ];
    });
};

const captureSnapshot = (world: PluginWorld, tick: number): CapturedSnapshot => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const animations = world.registerComponent<AnimationState>(ANIMATION_STATE_COMPONENT);
  const abilityStates = optionalComponent<AbilityState>(world, ABILITY_STATE_COMPONENT);
  const armors = optionalComponent<Armor>(world, ARMOR_COMPONENT);
  const equippedWeapons = optionalComponent<EquippedWeapon>(world, EQUIPPED_WEAPON_COMPONENT);
  const inventories = optionalComponent<Inventory>(world, INVENTORY_COMPONENT);
  const damageIndicators = optionalComponent<DamageIndicator>(world, DAMAGE_INDICATOR_COMPONENT);
  const playerStats = optionalComponent<PlayerStats>(world, PLAYER_STATS_COMPONENT);
  const pickupPrompts = optionalComponent<PickupPrompt>(world, PICKUP_PROMPT_COMPONENT);
  const pickupToasts = optionalComponent<PickupToast>(world, PICKUP_TOAST_COMPONENT);
  const reserves = optionalComponent<AmmoReserve>(world, AMMO_RESERVE_COMPONENT);
  const reloadStates = optionalComponent<ReloadState>(world, RELOAD_STATE_COMPONENT);
  const shields = optionalComponent<Shield>(world, SHIELD_COMPONENT);
  const statuses = optionalComponent<StatusEffects>(world, STATUS_EFFECTS_COMPONENT);
  const weaponRuntimeStates = optionalComponent<WeaponRuntimeState>(
    world,
    WEAPON_RUNTIME_STATE_COMPONENT,
  );
  const zone = getZone(world);
  const capturedPlayers: CapturedPlayerSnapshot[] = [];
  const capturedProjectiles: CapturedProjectileSnapshot[] = [];
  const capturedDeployables: CapturedDeployableSnapshot[] = [];
  const capturedObjects = captureObjects(world, positions);

  for (const [entity, player] of players.entries()) {
    if (player.alive !== 1) {
      continue;
    }
    const position = positions.get(entity);
    if (!position) {
      continue;
    }
    const animation = animations.get(entity);
    const abilityCooldowns = playerAbilityCooldowns(abilityStates?.get(entity));
    const armor = armors?.get(entity);
    const inventory = inventories?.get(entity);
    const damageIndicator = damageIndicators?.get(entity);
    const pickupPrompt = playerPickupPrompt(pickupPrompts?.get(entity));
    const pickupToast = pickupToasts?.get(entity);
    const stats = playerStats?.get(entity);
    const status = statuses?.get(entity);
    const statusEffects = status === undefined ? undefined : playerStatusEffects(status);
    const shield = shields?.get(entity);
    const weapon = playerWeaponSnapshot(
      equippedWeapons?.get(entity),
      reserves?.get(entity),
      reloadStates?.get(entity),
      weaponRuntimeStates?.get(entity),
    );
    capturedPlayers.push({
      id: player.playerId,
      ...(player.team === undefined ? {} : { team: player.team }),
      x: position.x,
      y: position.y,
      health: protocolHealth(player.health),
      ...(shield === undefined ? {} : { shield: shield.current }),
      ...(armor === undefined ? {} : { armor }),
      ...(weapon === undefined ? {} : { weapon }),
      ...(inventory === undefined ? {} : { inventory }),
      ...(pickupPrompt === undefined ? {} : { pickupPrompt }),
      ...(pickupToast === undefined ? {} : { pickupToast }),
      ...(damageIndicator === undefined ? {} : { damageIndicator }),
      ...(stats === undefined ? {} : { stats }),
      ...(statusEffects === undefined ? {} : { statusEffects }),
      ...(abilityStates?.get(entity) === undefined ? {} : { abilityCooldowns }),
      ...(player.modelId === undefined ? {} : { modelId: player.modelId }),
      ...(animation === undefined ? {} : { animation }),
    });
  }

  capturedPlayers.sort((left, right) => left.id.localeCompare(right.id));

  for (const [entity, projectile] of projectileEntries(world)) {
    const position = positions.get(entity);
    if (!position) {
      continue;
    }
    capturedProjectiles.push({
      id: String(entity),
      ownerPlayerId: projectile.ownerId,
      weaponSlot: projectile.weaponSlot,
      x: position.x,
      y: position.y,
      vx: projectile.dirX * projectile.speed,
      vy: projectile.dirY * projectile.speed,
      rotation: Math.atan2(projectile.dirY, projectile.dirX),
      ttlMs: protocolProjectileTtlMs(projectile.ttlTicks),
    });
  }

  capturedProjectiles.sort((left, right) => left.id.localeCompare(right.id));

  for (const [entity, deployable] of deployableEntries(world)) {
    const position = positions.get(entity);
    if (!position) {
      continue;
    }
    capturedDeployables.push({
      id: String(entity),
      kind: deployable.kind,
      ownerId: deployable.ownerId,
      x: position.x,
      y: position.y,
      radius: deployable.radius,
      remainingTicks: deployable.remainingTicks,
      armedTicks: deployable.armedTicks,
      triggered: deployable.triggered,
    });
  }

  capturedDeployables.sort((left, right) => left.id.localeCompare(right.id));

  return {
    serverTimestampMs: serverTimestampForTick(tick),
    players: capturedPlayers,
    projectiles: capturedProjectiles,
    deployables: capturedDeployables,
    objects: capturedObjects,
    zone: zone
      ? {
          cx: zone.cx,
          cy: zone.cy,
          radius: zone.currentRadius,
        }
      : emptyZone(),
  };
};

const sameZone = (
  left: BattleRoyaleProtocol.ZoneState,
  right: BattleRoyaleProtocol.ZoneState,
): boolean => left.cx === right.cx && left.cy === right.cy && left.radius === right.radius;

const sameAnimation = (
  left: BattleRoyaleProtocol.PlayerAnimationState | undefined,
  right: BattleRoyaleProtocol.PlayerAnimationState | undefined,
): boolean =>
  left?.modelId === right?.modelId &&
  left?.clipKey === right?.clipKey &&
  left?.facingDeg === right?.facingDeg &&
  left?.moving === right?.moving &&
  left?.aimDeg === right?.aimDeg &&
  left?.acceptedFireTick === right?.acceptedFireTick;

const sameStatusEffects = (
  left: readonly BattleRoyaleProtocol.PlayerStatusSnapshot[] | undefined,
  right: readonly BattleRoyaleProtocol.PlayerStatusSnapshot[] | undefined,
): boolean => {
  const leftEffects = left ?? [];
  const rightEffects = right ?? [];
  return (
    leftEffects.length === rightEffects.length &&
    leftEffects.every((effect, index) => {
      const other = rightEffects[index];
      return (
        other !== undefined &&
        effect.effectId === other.effectId &&
        effect.remainingTicks === other.remainingTicks &&
        effect.stacks === other.stacks
      );
    })
  );
};

const sameSnapshotValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const samePickup = (
  left: BattleRoyaleProtocol.ObjectPickupSnapshot | undefined,
  right: BattleRoyaleProtocol.ObjectPickupSnapshot | undefined,
): boolean =>
  left?.itemKind === right?.itemKind &&
  left?.tier === right?.tier &&
  left?.quantity === right?.quantity &&
  left?.available === right?.available;

const sameLootSource = (
  left: BattleRoyaleProtocol.ObjectLootSourceSnapshot | undefined,
  right: BattleRoyaleProtocol.ObjectLootSourceSnapshot | undefined,
): boolean =>
  left?.tableId === right?.tableId &&
  left?.tier === right?.tier &&
  left?.weight === right?.weight &&
  left?.collected === right?.collected;

const sameInteractable = (
  left: BattleRoyaleProtocol.ObjectInteractableSnapshot | undefined,
  right: BattleRoyaleProtocol.ObjectInteractableSnapshot | undefined,
): boolean =>
  left?.action === right?.action &&
  left?.radius === right?.radius &&
  left?.enabled === right?.enabled;

const sameBreakable = (
  left: BattleRoyaleProtocol.ObjectBreakableSnapshot | undefined,
  right: BattleRoyaleProtocol.ObjectBreakableSnapshot | undefined,
): boolean =>
  left?.health === right?.health &&
  left?.maxHealth === right?.maxHealth &&
  left?.destroyed === right?.destroyed;

const sameHazard = (
  left: BattleRoyaleProtocol.ObjectHazardSnapshot | undefined,
  right: BattleRoyaleProtocol.ObjectHazardSnapshot | undefined,
): boolean => left?.damagePerSecond === right?.damagePerSecond && left?.enabled === right?.enabled;

const sameObjectSnapshot = (left: CapturedObjectSnapshot, right: CapturedObjectSnapshot): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  samePickup(left.pickup, right.pickup) &&
  sameLootSource(left.lootSource, right.lootSource) &&
  sameInteractable(left.interactable, right.interactable) &&
  sameBreakable(left.breakable, right.breakable) &&
  sameHazard(left.hazard, right.hazard);

const toPlayerMap = (
  players: readonly CapturedPlayerSnapshot[],
): ReadonlyMap<string, CapturedPlayerSnapshot> => {
  const byId = new Map<string, CapturedPlayerSnapshot>();
  for (const player of players) {
    byId.set(player.id, player);
  }
  return byId;
};

const toProjectileMap = (
  projectiles: readonly CapturedProjectileSnapshot[],
): ReadonlyMap<string, CapturedProjectileSnapshot> => {
  const byId = new Map<string, CapturedProjectileSnapshot>();
  for (const projectile of projectiles) {
    byId.set(projectile.id, projectile);
  }
  return byId;
};

const toDeployableMap = (
  deployables: readonly CapturedDeployableSnapshot[],
): ReadonlyMap<string, CapturedDeployableSnapshot> => {
  const byId = new Map<string, CapturedDeployableSnapshot>();
  for (const deployable of deployables) {
    byId.set(deployable.id, deployable);
  }
  return byId;
};

const toObjectMap = (
  objects: readonly CapturedObjectSnapshot[],
): ReadonlyMap<string, CapturedObjectSnapshot> => {
  const byId = new Map<string, CapturedObjectSnapshot>();
  for (const object of objects) {
    byId.set(object.id, object);
  }
  return byId;
};

const pushFrame = (msgOut: RuntimeMessageOut | undefined, frame: Uint8Array): Uint8Array => {
  msgOut?.push(frame);
  return frame;
};

const toWireObjectSnapshot = (
  object: CapturedObjectSnapshot,
): BattleRoyaleProtocol.ObjectSnapshot =>
  new ObjectSnapshot({
    id: makeObjectId(object.id),
    x: object.x,
    y: object.y,
    ...(object.pickup === undefined ? {} : { pickup: object.pickup }),
    ...(object.lootSource === undefined ? {} : { lootSource: object.lootSource }),
    ...(object.interactable === undefined ? {} : { interactable: object.interactable }),
    ...(object.breakable === undefined ? {} : { breakable: object.breakable }),
    ...(object.hazard === undefined ? {} : { hazard: object.hazard }),
  });

export interface BattleRoyaleSnapshotEmitter {
  readonly buildWelcome: (world: PluginWorld, tick: number) => Uint8Array;
  readonly emitWelcome: (
    world: PluginWorld,
    tick: number,
    msgOut?: RuntimeMessageOut,
  ) => Uint8Array;
  readonly emitDelta: (world: PluginWorld, tick: number, msgOut?: RuntimeMessageOut) => Uint8Array;
}

export interface BattleRoyaleSnapshotEmitterOptions {
  readonly getProcessedInputSeqByPlayerId?: () => ReadonlyMap<string, number>;
}

const processedInputSeqByPlayerId = (
  options: BattleRoyaleSnapshotEmitterOptions,
): BattleRoyaleProtocol.ProcessedInputSequenceByPlayerId | undefined => {
  const entries = [...(options.getProcessedInputSeqByPlayerId?.() ?? new Map()).entries()]
    .filter(([, seq]) => Number.isSafeInteger(seq) && seq >= 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries.map(([playerId, seq]) => [makePlayerId(playerId), seq]));
};

export const createBattleRoyaleSnapshotEmitter = (
  seed: SnapshotSeed = 0,
  options: BattleRoyaleSnapshotEmitterOptions = {},
): BattleRoyaleSnapshotEmitter => {
  let previous: CapturedSnapshot | undefined;

  const encodeWelcome = (snapshot: CapturedSnapshot, tick: number): Uint8Array => {
    const processedInputSequences = processedInputSeqByPlayerId(options);
    return encodeServerMessage(
      new WelcomeSnapshot({
        tick,
        serverTimestampMs: snapshot.serverTimestampMs,
        seed,
        ...(processedInputSequences === undefined
          ? {}
          : { processedInputSeqByPlayerId: processedInputSequences }),
        players: snapshot.players.map((player) => ({
          id: makePlayerId(player.id),
          ...(player.team === undefined ? {} : { team: player.team }),
          x: player.x,
          y: player.y,
          health: player.health,
          ...(player.shield === undefined ? {} : { shield: player.shield }),
          ...(player.armor === undefined ? {} : { armor: player.armor }),
          ...(player.weapon === undefined ? {} : { weapon: player.weapon }),
          ...(player.inventory === undefined ? {} : { inventory: player.inventory }),
          ...(player.pickupPrompt === undefined ? {} : { pickupPrompt: player.pickupPrompt }),
          ...(player.pickupToast === undefined ? {} : { pickupToast: player.pickupToast }),
          ...(player.damageIndicator === undefined
            ? {}
            : { damageIndicator: player.damageIndicator }),
          ...(player.stats === undefined ? {} : { stats: player.stats }),
          ...(player.statusEffects === undefined
            ? {}
            : { statusEffects: [...player.statusEffects] }),
          ...(player.abilityCooldowns === undefined
            ? {}
            : { abilityCooldowns: [...player.abilityCooldowns] }),
          ...(player.modelId === undefined ? {} : { modelId: player.modelId }),
          ...(player.animation === undefined ? {} : { animation: player.animation }),
        })),
        projectiles: snapshot.projectiles.map(
          (projectile) =>
            new ProjectileSnapshot({
              id: makeProjectileId(projectile.id),
              ownerPlayerId: makePlayerId(projectile.ownerPlayerId),
              weaponSlot: projectile.weaponSlot,
              x: projectile.x,
              y: projectile.y,
              vx: projectile.vx,
              vy: projectile.vy,
              rotation: projectile.rotation,
              ttlMs: projectile.ttlMs,
            }),
        ),
        deployables: snapshot.deployables.map(
          (deployable) =>
            new DeployableSnapshot({
              id: makeDeployableId(deployable.id),
              kind: deployable.kind,
              ownerId: makeDeployableOwnerId(deployable.ownerId),
              x: deployable.x,
              y: deployable.y,
              radius: deployable.radius,
              remainingTicks: deployable.remainingTicks,
              armedTicks: deployable.armedTicks,
              triggered: deployable.triggered,
            }),
        ),
        objects: snapshot.objects.map(toWireObjectSnapshot),
        zone: snapshot.zone,
      }),
    );
  };

  const buildWelcome = (world: PluginWorld, tick: number): Uint8Array =>
    encodeWelcome(captureSnapshot(world, tick), tick);

  const emitWelcome = (
    world: PluginWorld,
    tick: number,
    msgOut?: RuntimeMessageOut,
  ): Uint8Array => {
    const snapshot = captureSnapshot(world, tick);
    previous = snapshot;
    return pushFrame(msgOut, encodeWelcome(snapshot, tick));
  };

  const emitDelta = (world: PluginWorld, tick: number, msgOut?: RuntimeMessageOut): Uint8Array => {
    if (!previous) {
      return emitWelcome(world, tick, msgOut);
    }

    const current = captureSnapshot(world, tick);
    const previousPlayers = toPlayerMap(previous.players);
    const currentPlayers = toPlayerMap(current.players);
    const previousProjectiles = toProjectileMap(previous.projectiles);
    const currentProjectiles = toProjectileMap(current.projectiles);
    const previousDeployables = toDeployableMap(previous.deployables);
    const currentDeployables = toDeployableMap(current.deployables);
    const previousObjects = toObjectMap(previous.objects);
    const currentObjects = toObjectMap(current.objects);
    const removed = [...previousPlayers.keys()]
      .filter((playerId) => !currentPlayers.has(playerId))
      .sort((left, right) => left.localeCompare(right))
      .map((playerId) => makePlayerId(playerId));
    const projectilesRemoved = [...previousProjectiles.keys()]
      .filter((projectileId) => !currentProjectiles.has(projectileId))
      .sort((left, right) => left.localeCompare(right))
      .map((projectileId) => makeProjectileId(projectileId));
    const deployablesRemoved = [...previousDeployables.keys()]
      .filter((deployableId) => !currentDeployables.has(deployableId))
      .sort((left, right) => left.localeCompare(right))
      .map((deployableId) => makeDeployableId(deployableId));
    const objectsRemoved = [...previousObjects.keys()]
      .filter((objectId) => !currentObjects.has(objectId))
      .sort((left, right) => left.localeCompare(right))
      .map((objectId) => makeObjectId(objectId));

    const updated = current.players.flatMap((player) => {
      const before = previousPlayers.get(player.id);
      if (
        before &&
        before.team === player.team &&
        before.x === player.x &&
        before.y === player.y &&
        before.health === player.health &&
        before.shield === player.shield &&
        sameSnapshotValue(before.armor, player.armor) &&
        sameSnapshotValue(before.weapon, player.weapon) &&
        sameSnapshotValue(before.inventory, player.inventory) &&
        sameSnapshotValue(before.pickupPrompt, player.pickupPrompt) &&
        sameSnapshotValue(before.pickupToast, player.pickupToast) &&
        sameSnapshotValue(before.damageIndicator, player.damageIndicator) &&
        sameSnapshotValue(before.stats, player.stats) &&
        sameStatusEffects(before.statusEffects, player.statusEffects) &&
        sameSnapshotValue(before.abilityCooldowns, player.abilityCooldowns) &&
        sameAnimation(before.animation, player.animation)
      ) {
        return [];
      }

      return [
        {
          id: makePlayerId(player.id),
          team:
            !before || before.team !== player.team
              ? player.team === undefined
                ? Option.none()
                : Option.some(player.team)
              : Option.none(),
          x: !before || before.x !== player.x ? Option.some(player.x) : Option.none(),
          y: !before || before.y !== player.y ? Option.some(player.y) : Option.none(),
          health:
            !before || before.health !== player.health ? Option.some(player.health) : Option.none(),
          shield:
            !before || before.shield !== player.shield
              ? player.shield === undefined
                ? Option.none()
                : Option.some(player.shield)
              : Option.none(),
          armor:
            !before || !sameSnapshotValue(before.armor, player.armor)
              ? player.armor === undefined
                ? Option.none()
                : Option.some(player.armor)
              : Option.none(),
          weapon:
            !before || !sameSnapshotValue(before.weapon, player.weapon)
              ? player.weapon === undefined
                ? Option.none()
                : Option.some(player.weapon)
              : Option.none(),
          inventory:
            !before || !sameSnapshotValue(before.inventory, player.inventory)
              ? player.inventory === undefined
                ? Option.none()
                : Option.some(player.inventory)
              : Option.none(),
          pickupPrompt:
            !before || !sameSnapshotValue(before.pickupPrompt, player.pickupPrompt)
              ? player.pickupPrompt === undefined
                ? Option.none()
                : Option.some(player.pickupPrompt)
              : Option.none(),
          pickupToast:
            !before || !sameSnapshotValue(before.pickupToast, player.pickupToast)
              ? player.pickupToast === undefined
                ? Option.none()
                : Option.some(player.pickupToast)
              : Option.none(),
          damageIndicator:
            !before || !sameSnapshotValue(before.damageIndicator, player.damageIndicator)
              ? player.damageIndicator === undefined
                ? Option.none()
                : Option.some(player.damageIndicator)
              : Option.none(),
          stats:
            !before || !sameSnapshotValue(before.stats, player.stats)
              ? player.stats === undefined
                ? Option.none()
                : Option.some(player.stats)
              : Option.none(),
          statusEffects:
            !before || !sameStatusEffects(before.statusEffects, player.statusEffects)
              ? player.statusEffects === undefined
                ? Option.none()
                : Option.some([...player.statusEffects])
              : Option.none(),
          abilityCooldowns:
            !before || !sameSnapshotValue(before.abilityCooldowns, player.abilityCooldowns)
              ? player.abilityCooldowns === undefined
                ? Option.none()
                : Option.some([...player.abilityCooldowns])
              : Option.none(),
          animation:
            !before || !sameAnimation(before.animation, player.animation)
              ? player.animation === undefined
                ? Option.none()
                : Option.some(player.animation)
              : Option.none(),
        },
      ];
    });

    const projectilesUpdated = current.projectiles.flatMap((projectile) => {
      const before = previousProjectiles.get(projectile.id);
      if (
        before &&
        before.ownerPlayerId === projectile.ownerPlayerId &&
        before.weaponSlot === projectile.weaponSlot &&
        before.x === projectile.x &&
        before.y === projectile.y &&
        before.vx === projectile.vx &&
        before.vy === projectile.vy &&
        before.rotation === projectile.rotation &&
        before.ttlMs === projectile.ttlMs
      ) {
        return [];
      }

      return [
        new ProjectileUpdate({
          id: makeProjectileId(projectile.id),
          ownerPlayerId:
            !before || before.ownerPlayerId !== projectile.ownerPlayerId
              ? Option.some(makePlayerId(projectile.ownerPlayerId))
              : Option.none(),
          weaponSlot:
            !before || before.weaponSlot !== projectile.weaponSlot
              ? Option.some(projectile.weaponSlot)
              : Option.none(),
          x: !before || before.x !== projectile.x ? Option.some(projectile.x) : Option.none(),
          y: !before || before.y !== projectile.y ? Option.some(projectile.y) : Option.none(),
          vx: !before || before.vx !== projectile.vx ? Option.some(projectile.vx) : Option.none(),
          vy: !before || before.vy !== projectile.vy ? Option.some(projectile.vy) : Option.none(),
          rotation:
            !before || before.rotation !== projectile.rotation
              ? Option.some(projectile.rotation)
              : Option.none(),
          ttlMs:
            !before || before.ttlMs !== projectile.ttlMs
              ? Option.some(projectile.ttlMs)
              : Option.none(),
        }),
      ];
    });

    const deployablesUpdated = current.deployables.flatMap((deployable) => {
      const before = previousDeployables.get(deployable.id);
      if (
        before &&
        before.kind === deployable.kind &&
        before.ownerId === deployable.ownerId &&
        before.x === deployable.x &&
        before.y === deployable.y &&
        before.radius === deployable.radius &&
        before.remainingTicks === deployable.remainingTicks &&
        before.armedTicks === deployable.armedTicks &&
        before.triggered === deployable.triggered
      ) {
        return [];
      }

      return [
        new DeployableUpdate({
          id: makeDeployableId(deployable.id),
          kind:
            !before || before.kind !== deployable.kind
              ? Option.some(deployable.kind)
              : Option.none(),
          ownerId:
            !before || before.ownerId !== deployable.ownerId
              ? Option.some(makeDeployableOwnerId(deployable.ownerId))
              : Option.none(),
          x: !before || before.x !== deployable.x ? Option.some(deployable.x) : Option.none(),
          y: !before || before.y !== deployable.y ? Option.some(deployable.y) : Option.none(),
          radius:
            !before || before.radius !== deployable.radius
              ? Option.some(deployable.radius)
              : Option.none(),
          remainingTicks:
            !before || before.remainingTicks !== deployable.remainingTicks
              ? Option.some(deployable.remainingTicks)
              : Option.none(),
          armedTicks:
            !before || before.armedTicks !== deployable.armedTicks
              ? Option.some(deployable.armedTicks)
              : Option.none(),
          triggered:
            !before || before.triggered !== deployable.triggered
              ? Option.some(deployable.triggered)
              : Option.none(),
        }),
      ];
    });

    const objectsUpdated = current.objects.flatMap((object) => {
      const before = previousObjects.get(object.id);
      if (before && sameObjectSnapshot(before, object)) {
        return [];
      }
      return [toWireObjectSnapshot(object)];
    });

    const processedInputSequences = processedInputSeqByPlayerId(options);
    const frame = encodeServerMessage(
      new DeltaSnapshot({
        tick,
        serverTimestampMs: current.serverTimestampMs,
        ...(processedInputSequences === undefined
          ? {}
          : { processedInputSeqByPlayerId: processedInputSequences }),
        removed,
        updated,
        projectilesUpdated,
        projectilesRemoved,
        deployablesUpdated,
        deployablesRemoved,
        objectsUpdated,
        objectsRemoved,
        zone: sameZone(previous.zone, current.zone) ? Option.none() : Option.some(current.zone),
      }),
    );
    previous = current;
    return pushFrame(msgOut, frame);
  };

  return {
    buildWelcome,
    emitWelcome,
    emitDelta,
  };
};

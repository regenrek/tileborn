import {
  createSeededRngFromSnapshot,
  createSeededRng,
  makeCombatEntityId,
  WeaponState,
  type ProjectileDelivery,
  type SeededRngSnapshot,
} from '@tileborne/simulation';
import type { JsonValue } from '@tileborne/core';
import {
  GameplayEventFrame,
  encodeServerMessage,
} from '@tileborne/ipc-contracts/protocols/battle-royale';

import { INVENTORY, LOOT_PICKUP_RADIUS, PLUGIN_ID } from './constants.js';
import { resolveBattleRoyaleConfig } from './battle-royale-config.js';
import {
  createDamageSystemState,
  ensureMatchPhase,
  recordMatchStarters,
  resolveRoomRules,
  runDamageSystem,
} from './ecs/damage-system.js';
import { buildRuntimeCollisionEnvironment } from './ecs/collision.js';
import { applyMovementTick, buildTileCollisionEnvironment } from './ecs/movement.js';
import { updatePlayerAnimationStates } from './ecs/player-animation.js';
import {
  createAbilityStatusSystemState,
  isBlockedByStun,
  movementMultiplierForStatus,
  runAbilityStatusSystem,
} from './ecs/ability-status-system.js';
import {
  createCombatSystemState,
  resolveMapBoundsFromArtifact,
  runCombatSystem,
} from './ecs/combat-system.js';
import {
  createInventoryLootSystemState,
  runInventoryLootSystem,
} from './ecs/inventory-loot-system.js';
import {
  buildCombatBlockers,
  createBattleRoyaleCombatWorldView,
  createBattleRoyaleHitPolicy,
} from './ecs/combat-world-view.js';
import { buildPlayerPhysicsByModelId } from './ecs/player-physics.js';
import {
  ABILITY_STATE_COMPONENT,
  AIM_COMPONENT,
  AMMO_RESERVE_COMPONENT,
  ANIMATION_STATE_COMPONENT,
  ARMOR_COMPONENT,
  BREAKABLE_COMPONENT,
  COLLISION_BODY_COMPONENT,
  DAMAGE_INDICATOR_COMPONENT,
  DEPLOYABLE_COMPONENT,
  EQUIPPED_WEAPON_COMPONENT,
  FACING_COMPONENT,
  HAZARD_COMPONENT,
  HITBOX_COMPONENT,
  INTERACTABLE_COMPONENT,
  INVENTORY_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  MATCH_PHASE_COMPONENT,
  MUZZLE_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  PICKUP_TOAST_COMPONENT,
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  RELOAD_STATE_COMPONENT,
  RESPAWN_STATE_COMPONENT,
  SHIELD_COMPONENT,
  STATUS_EFFECTS_COMPONENT,
  TEAM_COMPONENT,
  VELOCITY_COMPONENT,
  VISION_BLOCKER_COMPONENT,
  WEAPON_RUNTIME_STATE_COMPONENT,
  type AnimationState,
  type Player,
} from './ecs/components.js';
import {
  initializeBattleRoyaleRuntimeEcs,
  syncPlayerInputRuntimeComponents,
  type RuntimeEcsOptions,
} from './ecs/runtime-ecs.js';
import type { Direction8 } from './ecs/movement.js';
import { resolveSpawnSlots, spawnPlayersFromArtifact } from './ecs/spawn-players.js';
import { runZoneSystem } from './ecs/zone-system.js';
import { initZoneFromArtifact, ZONE_COMPONENT } from './ecs/zone.js';
import { buildBattleRoyaleRuntimeState } from './runtime-state-from-package.js';
import { createBattleRoyaleSnapshotEmitter } from './server/snapshot-emitter.js';
import { assertRuntimeBattleRoyaleArtifact } from './types/runtime-artifact-validation.js';
import type { RuntimePlugin, RuntimePluginHost, PluginWorld } from './types/runtime-plugin.js';
import { resolveBattleRoyaleWeaponEntry } from './weapon-catalog.js';

interface BattleRoyaleGameplayCheckpoint {
  readonly version?: number;
  readonly tick?: number;
  readonly gameplayEventSequence?: number;
  readonly activeWeaponSlots?: readonly {
    readonly playerId: string;
    readonly slot: number;
  }[];
  readonly worldComponents?: readonly BattleRoyaleComponentCheckpoint[];
  readonly world?: BattleRoyaleWorldCheckpoint;
  readonly combat?: {
    readonly rng?: SeededRngSnapshot;
    readonly weaponStates?: readonly BattleRoyaleWeaponStateCheckpoint[];
    readonly projectileSources?: readonly BattleRoyaleStringByEntityCheckpoint[];
  };
  readonly damage?: {
    readonly pendingKills?: readonly {
      readonly victimEntity: number;
      readonly victimPlayerId: string;
      readonly killerId: string;
    }[];
    readonly scheduledRespawns?: readonly {
      readonly entity: number;
      readonly atTick: number;
    }[];
    readonly gameOverEmitted?: boolean;
    readonly starterCount?: number;
    readonly lastEliminatedPlayerIds?: readonly string[];
    readonly matchEntity?: number;
  };
  readonly abilityStatus?: {
    readonly consumedInputByPlayerAbility?: readonly BattleRoyaleStringMapCheckpoint[];
  };
  readonly inventoryLoot?: {
    readonly rng?: SeededRngSnapshot;
    readonly consumedDropInputByPlayerId?: readonly BattleRoyaleStringMapCheckpoint[];
    readonly consumedInteractInputByPlayerId?: readonly BattleRoyaleStringMapCheckpoint[];
  };
}

interface BattleRoyaleWorldCheckpoint {
  readonly nextEntity: number;
}

interface BattleRoyaleComponentCheckpoint {
  readonly name: string;
  readonly entries: readonly {
    readonly entity: number;
    readonly value: JsonValue;
  }[];
}

interface BattleRoyaleWeaponStateCheckpoint {
  readonly playerId: string;
  readonly state: {
    readonly ammoInMagazine: number;
    readonly cooldownRemaining: number;
    readonly reloadRemaining: number;
    readonly reloadAmount: number;
  };
}

interface BattleRoyaleStringByEntityCheckpoint {
  readonly entity: number;
  readonly value: number;
}

interface BattleRoyaleStringMapCheckpoint {
  readonly key: string;
  readonly value: string;
}

const CHECKPOINT_VERSION = 2;

const CHECKPOINT_COMPONENT_NAMES = [
  POSITION_COMPONENT,
  VELOCITY_COMPONENT,
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  TEAM_COMPONENT,
  FACING_COMPONENT,
  AIM_COMPONENT,
  MUZZLE_COMPONENT,
  ANIMATION_STATE_COMPONENT,
  INVENTORY_COMPONENT,
  EQUIPPED_WEAPON_COMPONENT,
  AMMO_RESERVE_COMPONENT,
  RELOAD_STATE_COMPONENT,
  WEAPON_RUNTIME_STATE_COMPONENT,
  DAMAGE_INDICATOR_COMPONENT,
  PICKUP_TOAST_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  INTERACTABLE_COMPONENT,
  BREAKABLE_COMPONENT,
  HAZARD_COMPONENT,
  DEPLOYABLE_COMPONENT,
  ABILITY_STATE_COMPONENT,
  STATUS_EFFECTS_COMPONENT,
  SHIELD_COMPONENT,
  ARMOR_COMPONENT,
  HITBOX_COMPONENT,
  COLLISION_BODY_COMPONENT,
  VISION_BLOCKER_COMPONENT,
  MATCH_PHASE_COMPONENT,
  ZONE_COMPONENT,
  RESPAWN_STATE_COMPONENT,
  PROJECTILE_COMPONENT,
] as const;

const cloneJsonValue = (value: JsonValue): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveEntity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isJsonValue = (value: unknown): value is JsonValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  (Array.isArray(value) && value.every(isJsonValue)) ||
  (isObjectRecord(value) && Object.values(value).every(isJsonValue));

const decodeStringMap = (value: unknown): BattleRoyaleStringMapCheckpoint[] =>
  Array.isArray(value)
    ? value.flatMap((entry) =>
        isObjectRecord(entry) && typeof entry.key === 'string' && typeof entry.value === 'string'
          ? [{ key: entry.key, value: entry.value }]
          : [],
      )
    : [];

const decodeRngSnapshot = (value: unknown): SeededRngSnapshot | undefined => {
  if (
    isObjectRecord(value) &&
    typeof value.s0 === 'string' &&
    typeof value.s1 === 'string' &&
    typeof value.s2 === 'string' &&
    typeof value.s3 === 'string'
  ) {
    return { s0: value.s0, s1: value.s1, s2: value.s2, s3: value.s3 };
  }
  return undefined;
};

const decodeBattleRoyaleGameplayCheckpoint = (value: unknown): BattleRoyaleGameplayCheckpoint => {
  if (!isObjectRecord(value)) {
    return {};
  }
  const activeWeaponSlotsValue = value.activeWeaponSlots;
  const activeWeaponSlots = Array.isArray(activeWeaponSlotsValue)
    ? activeWeaponSlotsValue.flatMap((entry) => {
        if (
          isObjectRecord(entry) &&
          typeof entry.playerId === 'string' &&
          entry.playerId.length > 0 &&
          typeof entry.slot === 'number' &&
          Number.isSafeInteger(entry.slot) &&
          entry.slot > 0
        ) {
          return [
            {
              playerId: entry.playerId,
              slot: entry.slot,
            },
          ];
        }
        return [];
      })
    : [];
  const worldComponents = Array.isArray(value.worldComponents)
    ? value.worldComponents.flatMap((component) => {
        if (!isObjectRecord(component) || typeof component.name !== 'string') {
          return [];
        }
        const entries = Array.isArray(component.entries)
          ? component.entries.flatMap((entry) =>
              isObjectRecord(entry) && isPositiveEntity(entry.entity) && isJsonValue(entry.value)
                ? [{ entity: entry.entity, value: entry.value }]
                : [],
            )
          : [];
        return entries.length === 0 ? [] : [{ name: component.name, entries }];
      })
    : [];
  const combat = isObjectRecord(value.combat)
    ? (() => {
        const rng = decodeRngSnapshot(value.combat.rng);
        return {
          ...(rng === undefined ? {} : { rng }),
          weaponStates: Array.isArray(value.combat.weaponStates)
            ? value.combat.weaponStates.flatMap((entry) => {
                if (!isObjectRecord(entry) || typeof entry.playerId !== 'string') {
                  return [];
                }
                const state = entry.state;
                if (
                  !isObjectRecord(state) ||
                  typeof state.ammoInMagazine !== 'number' ||
                  !Number.isSafeInteger(state.ammoInMagazine) ||
                  typeof state.cooldownRemaining !== 'number' ||
                  !Number.isSafeInteger(state.cooldownRemaining) ||
                  typeof state.reloadRemaining !== 'number' ||
                  !Number.isSafeInteger(state.reloadRemaining) ||
                  typeof state.reloadAmount !== 'number' ||
                  !Number.isSafeInteger(state.reloadAmount)
                ) {
                  return [];
                }
                const ammoInMagazine = state.ammoInMagazine;
                const cooldownRemaining = state.cooldownRemaining;
                const reloadRemaining = state.reloadRemaining;
                const reloadAmount = state.reloadAmount;
                return [
                  {
                    playerId: entry.playerId,
                    state: {
                      ammoInMagazine,
                      cooldownRemaining,
                      reloadRemaining,
                      reloadAmount,
                    },
                  },
                ];
              })
            : [],
          projectileSources: Array.isArray(value.combat.projectileSources)
            ? value.combat.projectileSources.flatMap((entry) =>
                isObjectRecord(entry) &&
                isPositiveEntity(entry.entity) &&
                typeof entry.value === 'number'
                  ? [{ entity: entry.entity, value: entry.value }]
                  : [],
              )
            : [],
        };
      })()
    : undefined;
  const damage = isObjectRecord(value.damage)
    ? {
        pendingKills: Array.isArray(value.damage.pendingKills)
          ? value.damage.pendingKills.flatMap((entry) =>
              isObjectRecord(entry) &&
              isPositiveEntity(entry.victimEntity) &&
              typeof entry.victimPlayerId === 'string' &&
              typeof entry.killerId === 'string'
                ? [
                    {
                      victimEntity: entry.victimEntity,
                      victimPlayerId: entry.victimPlayerId,
                      killerId: entry.killerId,
                    },
                  ]
                : [],
            )
          : [],
        scheduledRespawns: Array.isArray(value.damage.scheduledRespawns)
          ? value.damage.scheduledRespawns.flatMap((entry) =>
              isObjectRecord(entry) &&
              isPositiveEntity(entry.entity) &&
              typeof entry.atTick === 'number' &&
              Number.isSafeInteger(entry.atTick)
                ? [{ entity: entry.entity, atTick: entry.atTick }]
                : [],
            )
          : [],
        ...(typeof value.damage.gameOverEmitted === 'boolean'
          ? { gameOverEmitted: value.damage.gameOverEmitted }
          : {}),
        ...(typeof value.damage.starterCount === 'number' &&
        Number.isSafeInteger(value.damage.starterCount)
          ? { starterCount: value.damage.starterCount }
          : {}),
        ...(Array.isArray(value.damage.lastEliminatedPlayerIds)
          ? {
              lastEliminatedPlayerIds: value.damage.lastEliminatedPlayerIds.filter(
                (playerId): playerId is string => typeof playerId === 'string',
              ),
            }
          : {}),
        ...(isPositiveEntity(value.damage.matchEntity)
          ? { matchEntity: value.damage.matchEntity }
          : {}),
      }
    : undefined;
  return {
    ...(typeof value.version === 'number' && Number.isSafeInteger(value.version)
      ? { version: value.version }
      : {}),
    ...(typeof value.tick === 'number' && Number.isSafeInteger(value.tick)
      ? { tick: value.tick }
      : {}),
    ...(typeof value.gameplayEventSequence === 'number' &&
    Number.isSafeInteger(value.gameplayEventSequence) &&
    value.gameplayEventSequence >= 0
      ? { gameplayEventSequence: value.gameplayEventSequence }
      : {}),
    ...(activeWeaponSlots.length === 0 ? {} : { activeWeaponSlots }),
    ...(worldComponents.length === 0 ? {} : { worldComponents }),
    ...(isObjectRecord(value.world) &&
    typeof value.world.nextEntity === 'number' &&
    Number.isSafeInteger(value.world.nextEntity) &&
    value.world.nextEntity > 0
      ? { world: { nextEntity: value.world.nextEntity } }
      : {}),
    ...(combat === undefined ? {} : { combat }),
    ...(damage === undefined ? {} : { damage }),
    ...(isObjectRecord(value.abilityStatus)
      ? {
          abilityStatus: {
            consumedInputByPlayerAbility: decodeStringMap(
              value.abilityStatus.consumedInputByPlayerAbility,
            ),
          },
        }
      : {}),
    ...(isObjectRecord(value.inventoryLoot)
      ? (() => {
          const rng = decodeRngSnapshot(value.inventoryLoot.rng);
          return {
            inventoryLoot: {
              ...(rng === undefined ? {} : { rng }),
              consumedDropInputByPlayerId: decodeStringMap(
                value.inventoryLoot.consumedDropInputByPlayerId,
              ),
              consumedInteractInputByPlayerId: decodeStringMap(
                value.inventoryLoot.consumedInteractInputByPlayerId,
              ),
            },
          };
        })()
      : {}),
  };
};

const encodeBattleRoyaleGameplayCheckpoint = (
  checkpoint: BattleRoyaleGameplayCheckpoint,
): JsonValue | undefined => {
  const activeWeaponSlots = [...(checkpoint.activeWeaponSlots ?? [])]
    .filter(
      (entry) => entry.playerId.length > 0 && Number.isSafeInteger(entry.slot) && entry.slot > 0,
    )
    .sort((left, right) => left.playerId.localeCompare(right.playerId));
  return {
    version: CHECKPOINT_VERSION,
    ...(checkpoint.tick === undefined ? {} : { tick: checkpoint.tick }),
    ...(checkpoint.gameplayEventSequence === undefined
      ? {}
      : { gameplayEventSequence: checkpoint.gameplayEventSequence }),
    ...(activeWeaponSlots.length === 0 ? {} : { activeWeaponSlots }),
    ...(checkpoint.worldComponents === undefined || checkpoint.worldComponents.length === 0
      ? {}
      : {
          worldComponents: checkpoint.worldComponents
            .map((component) => ({
              name: component.name,
              entries: component.entries
                .map((entry) => ({
                  entity: entry.entity,
                  value: cloneJsonValue(entry.value),
                }))
                .sort((left, right) => left.entity - right.entity),
            }))
            .filter((component) => component.entries.length > 0)
            .sort((left, right) => left.name.localeCompare(right.name)),
        }),
    ...(checkpoint.world === undefined ? {} : { world: checkpoint.world }),
    ...(checkpoint.combat === undefined ? {} : { combat: checkpoint.combat }),
    ...(checkpoint.damage === undefined ? {} : { damage: checkpoint.damage }),
    ...(checkpoint.abilityStatus === undefined ? {} : { abilityStatus: checkpoint.abilityStatus }),
    ...(checkpoint.inventoryLoot === undefined ? {} : { inventoryLoot: checkpoint.inventoryLoot }),
  } as unknown as JsonValue;
};

const registerCheckpointComponents = (world: PluginWorld): void => {
  for (const name of CHECKPOINT_COMPONENT_NAMES) {
    world.registerComponent(name);
  }
};

const captureWorldComponents = (world: PluginWorld): readonly BattleRoyaleComponentCheckpoint[] =>
  CHECKPOINT_COMPONENT_NAMES.flatMap((name) => {
    let entries: BattleRoyaleComponentCheckpoint['entries'];
    try {
      entries = [...world.getComponent(name).entries()]
        .map(([entity, value]) => ({ entity, value: cloneJsonValue(value as JsonValue) }))
        .sort((left, right) => left.entity - right.entity);
    } catch {
      entries = [];
    }
    return entries.length === 0 ? [] : [{ name, entries }];
  });

const restoreWorldComponents = (
  world: PluginWorld,
  components: readonly BattleRoyaleComponentCheckpoint[] | undefined,
  checkpoint: BattleRoyaleWorldCheckpoint | undefined,
): void => {
  if (components === undefined || components.length === 0) {
    return;
  }
  registerCheckpointComponents(world);
  if (checkpoint !== undefined && world.restoreCheckpoint !== undefined) {
    world.restoreCheckpoint(checkpoint);
  } else {
    const maxEntity = components.reduce(
      (max, component) =>
        component.entries.reduce((entryMax, entry) => Math.max(entryMax, entry.entity), max),
      0,
    );
    for (let entity = 1; entity <= maxEntity; entity += 1) {
      world.createEntity();
    }
  }
  for (const component of components) {
    const store = world.getComponent(component.name);
    for (const entry of component.entries) {
      const value = cloneJsonValue(entry.value) as object;
      store.set(
        entry.entity,
        component.name === ANIMATION_STATE_COMPONENT ? transientAnimationState(value) : value,
      );
    }
  }
};

const transientAnimationState = (value: object): object => {
  if (!('acceptedFireTick' in value)) {
    return value;
  }
  const { acceptedFireTick: _acceptedFireTick, ...rest } = value as AnimationState;
  return rest;
};

const clearAcceptedFireAnimationMarkers = (world: PluginWorld): void => {
  const animations = world.registerComponent<AnimationState>(ANIMATION_STATE_COMPONENT);
  for (const [entity, animation] of animations.entries()) {
    if (animation.acceptedFireTick !== undefined) {
      const { acceptedFireTick: _acceptedFireTick, ...rest } = animation;
      animations.set(entity, rest);
    }
  }
};

export {
  BattleRoyaleConfig,
  DEFAULT_BATTLE_ROYALE_CONFIG,
  decodeBattleRoyaleConfigOverride,
  mergeBattleRoyaleConfig,
  resolveBattleRoyaleConfig,
} from './battle-royale-config.js';
export type {
  BattleRoyaleConfigInput,
  ResolvedBattleRoyaleConfig,
} from './battle-royale-config.js';

export const createRuntimeAdapter = (host: RuntimePluginHost): RuntimePlugin => {
  // The host hands the encoded `RuntimeMapPackage` (ADR-0030); the adapter
  // derives BR's runtime state from it and re-asserts the runtime invariants
  // (player models are REQUIRED at adapter boot, unlike at package assembly).
  const artifact = assertRuntimeBattleRoyaleArtifact(
    buildBattleRoyaleRuntimeState(host.getMapPackage(), {
      ...(host.getPlayerModelSelections === undefined
        ? {}
        : { playerModelSelections: host.getPlayerModelSelections() }),
    }),
  );
  const config = resolveBattleRoyaleConfig(artifact, host.config);
  const tileCollisionEnvironment = buildTileCollisionEnvironment(artifact);
  const combatState = createCombatSystemState();
  const gameplayCheckpoint = decodeBattleRoyaleGameplayCheckpoint(
    host.getPluginCheckpoint?.(PLUGIN_ID),
  );
  for (const entry of gameplayCheckpoint?.activeWeaponSlots ?? []) {
    if (entry.playerId.length > 0 && Number.isSafeInteger(entry.slot) && entry.slot > 0) {
      combatState.activeWeaponSlotByPlayerId.set(entry.playerId, entry.slot);
    }
  }
  const damageState = createDamageSystemState();
  const abilityStatusState = createAbilityStatusSystemState();
  const inventoryLootState = createInventoryLootSystemState(
    typeof host.seed === 'number' ? (host.seed ^ 0x9e3779b9) >>> 0 : 0x9e3779b9,
  );
  const snapshotEmitter = createBattleRoyaleSnapshotEmitter(host.seed);
  const msgOut = host.msgOut ?? { push: () => undefined };
  const setReplayFrames = host.setReplayFrames ?? (() => undefined);
  const mapBounds = resolveMapBoundsFromArtifact(artifact);
  const spawnSlots = resolveSpawnSlots(artifact);
  const roomRules = resolveRoomRules({
    ...config.roomRules,
    ...(config.respawn.enabled ? { respawnEnabled: true } : {}),
  });

  // BR weapon/balance numbers expressed as neutral catalog data: the runtime
  // builds the typed `weaponCatalogs` slot data, then decodes + validates it
  // through the engine schemas to the `WeaponDefinition` / `ProjectileDelivery`
  // it drives combat with — the same data backs the manifest slot, so the slot
  // is the single source of BR's weapon definition (ADR-0018 §7). The decode is
  // worker-safe (no `@tileborne/plugin-api` / `node:fs` in the worker bundle).
  const weaponEntry = resolveBattleRoyaleWeaponEntry(config, host.getMapPackage());
  const weaponDelivery = weaponEntry.delivery as ProjectileDelivery;
  const playerPhysicsByModelId = buildPlayerPhysicsByModelId(artifact, {
    radius: config.movement.radius,
    offsetX: 0,
    offsetY: config.movement.footprintOffsetY,
  });
  const hitPolicy = createBattleRoyaleHitPolicy(roomRules);
  let combatRng = createSeededRng(typeof host.seed === 'number' ? host.seed : 0);
  let gameplayEventSequence = gameplayCheckpoint.gameplayEventSequence ?? 0;
  const runtimeEcsOptions: RuntimeEcsOptions = {
    playerHealth: config.damage.playerHealth,
    weaponId: String(weaponEntry.weapon.id),
    weaponSlotCount: config.projectile.weaponSlotCount,
    magazineSize: config.projectile.magazineSize,
    reloadTicks: config.projectile.reloadTicks,
    inventoryCapacity: INVENTORY.capacity,
    initialAmmoReserve: config.projectile.initialAmmoReserve,
    zoneDamagePerSecond: config.zone.damagePerSecOutside,
    bodyByModelId: playerPhysicsByModelId,
    defaultPlayerPhysics: {
      radius: config.movement.radius,
      offsetX: 0,
      offsetY: config.movement.footprintOffsetY,
    },
  };
  let spawned = false;
  let spawnedPlayerIds = new Set<string>();
  let zoneInitialized = false;
  let runtimeEcsInitialized = false;

  const restoreGameplayCheckpoint = (world: PluginWorld): boolean => {
    if (gameplayCheckpoint.worldComponents === undefined) {
      return false;
    }
    restoreWorldComponents(world, gameplayCheckpoint.worldComponents, gameplayCheckpoint.world);
    if (gameplayCheckpoint.combat?.rng !== undefined) {
      combatRng = createSeededRngFromSnapshot(gameplayCheckpoint.combat.rng);
    }
    combatState.weaponStateByPlayerId.clear();
    for (const entry of gameplayCheckpoint.combat?.weaponStates ?? []) {
      combatState.weaponStateByPlayerId.set(entry.playerId, new WeaponState(entry.state));
    }
    combatState.activeWeaponSlotByPlayerId.clear();
    for (const entry of gameplayCheckpoint.activeWeaponSlots ?? []) {
      combatState.activeWeaponSlotByPlayerId.set(entry.playerId, entry.slot);
    }
    combatState.projectileSourceByEntity.clear();
    for (const entry of gameplayCheckpoint.combat?.projectileSources ?? []) {
      combatState.projectileSourceByEntity.set(entry.entity, makeCombatEntityId(entry.value));
    }
    combatState.componentsRegistered = true;

    damageState.pendingKills = [...(gameplayCheckpoint.damage?.pendingKills ?? [])];
    damageState.scheduledRespawns = [...(gameplayCheckpoint.damage?.scheduledRespawns ?? [])];
    damageState.gameOverEmitted = gameplayCheckpoint.damage?.gameOverEmitted ?? false;
    damageState.starterCount = gameplayCheckpoint.damage?.starterCount;
    damageState.lastEliminatedPlayerIds = [
      ...(gameplayCheckpoint.damage?.lastEliminatedPlayerIds ?? []),
    ];
    damageState.matchEntity = gameplayCheckpoint.damage?.matchEntity;
    damageState.componentsRegistered = true;

    abilityStatusState.consumedInputByPlayerAbility.clear();
    for (const entry of gameplayCheckpoint.abilityStatus?.consumedInputByPlayerAbility ?? []) {
      abilityStatusState.consumedInputByPlayerAbility.set(entry.key, entry.value);
    }
    abilityStatusState.componentsRegistered = true;

    inventoryLootState.consumedDropInputByPlayerId.clear();
    for (const entry of gameplayCheckpoint.inventoryLoot?.consumedDropInputByPlayerId ?? []) {
      inventoryLootState.consumedDropInputByPlayerId.set(entry.key, entry.value);
    }
    inventoryLootState.consumedInteractInputByPlayerId.clear();
    for (const entry of gameplayCheckpoint.inventoryLoot?.consumedInteractInputByPlayerId ?? []) {
      inventoryLootState.consumedInteractInputByPlayerId.set(entry.key, entry.value);
    }
    if (gameplayCheckpoint.inventoryLoot?.rng !== undefined) {
      inventoryLootState.rng = createSeededRngFromSnapshot(gameplayCheckpoint.inventoryLoot.rng);
    }

    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    spawnedPlayerIds = new Set([...players.entries()].map(([, player]) => player.playerId));
    spawned = spawnedPlayerIds.size > 0;
    zoneInitialized = true;
    runtimeEcsInitialized = true;
    return true;
  };

  const persistGameplayCheckpoint = (world: PluginWorld, tick: number): void => {
    host.setPluginCheckpoint?.(
      PLUGIN_ID,
      encodeBattleRoyaleGameplayCheckpoint({
        tick,
        gameplayEventSequence,
        ...(world.createCheckpoint === undefined ? {} : { world: world.createCheckpoint() }),
        activeWeaponSlots: [...combatState.activeWeaponSlotByPlayerId].map(([playerId, slot]) => ({
          playerId,
          slot,
        })),
        worldComponents: captureWorldComponents(world),
        combat: {
          rng: combatRng.snapshot(),
          weaponStates: [...combatState.weaponStateByPlayerId]
            .map(([playerId, state]) => ({
              playerId,
              state: {
                ammoInMagazine: state.ammoInMagazine,
                cooldownRemaining: state.cooldownRemaining,
                reloadRemaining: state.reloadRemaining,
                reloadAmount: state.reloadAmount,
              },
            }))
            .sort((left, right) => left.playerId.localeCompare(right.playerId)),
          projectileSources: [...combatState.projectileSourceByEntity]
            .map(([entity, value]) => ({ entity, value: Number(value) }))
            .sort((left, right) => left.entity - right.entity),
        },
        damage: {
          pendingKills: [...damageState.pendingKills],
          scheduledRespawns: [...damageState.scheduledRespawns],
          gameOverEmitted: damageState.gameOverEmitted,
          ...(damageState.starterCount === undefined
            ? {}
            : { starterCount: damageState.starterCount }),
          lastEliminatedPlayerIds: [...damageState.lastEliminatedPlayerIds],
          ...(damageState.matchEntity === undefined
            ? {}
            : { matchEntity: damageState.matchEntity }),
        },
        abilityStatus: {
          consumedInputByPlayerAbility: [...abilityStatusState.consumedInputByPlayerAbility]
            .map(([key, value]) => ({ key, value }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        },
        inventoryLoot: {
          rng: inventoryLootState.rng.snapshot(),
          consumedDropInputByPlayerId: [...inventoryLootState.consumedDropInputByPlayerId]
            .map(([key, value]) => ({ key, value }))
            .sort((left, right) => left.key.localeCompare(right.key)),
          consumedInteractInputByPlayerId: [...inventoryLootState.consumedInteractInputByPlayerId]
            .map(([key, value]) => ({ key, value }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        },
      }),
    );
  };

  const ensurePlayersSpawned = (world: PluginWorld): void => {
    const created = spawnPlayersFromArtifact(world, artifact, {
      playerHealth: config.damage.playerHealth,
      ...(host.getPlayerIds === undefined ? {} : { playerIds: host.getPlayerIds() }),
      existingPlayerIds: spawnedPlayerIds,
      matchMode: roomRules.matchMode,
    });
    if (created.length === 0 && spawnedPlayerIds.size > 0) {
      return;
    }
    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    spawnedPlayerIds = new Set([...players.entries()].map(([, player]) => player.playerId));
    if (!spawned && spawnedPlayerIds.size > 0) {
      recordMatchStarters(world, damageState);
      spawned = true;
    }
  };

  const ensureRuntimeEcsInitialized = (world: PluginWorld): void => {
    if (runtimeEcsInitialized) {
      return;
    }
    initializeBattleRoyaleRuntimeEcs(world, artifact, runtimeEcsOptions);
    ensureMatchPhase(world, damageState);
    runtimeEcsInitialized = true;
  };

  const ensureZoneInitialized = (world: PluginWorld): void => {
    if (zoneInitialized) {
      return;
    }
    initZoneFromArtifact(world, artifact, {
      schedule: config.zone.schedule,
      damagePerSecOutside: config.zone.damagePerSecOutside,
    });
    zoneInitialized = true;
  };

  const isDirection8 = (dir: number | undefined): dir is Direction8 =>
    dir !== undefined && Number.isInteger(dir) && dir >= 0 && dir <= 7;

  const buildMovementInputs = (world: PluginWorld) => {
    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    const inputs = new Map<
      string,
      { readonly dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; readonly shoot: boolean }
    >();
    const speedMultiplierByPlayerId = new Map<string, number>();
    const alivePlayers = [...players.entries()]
      .filter(([, player]) => player.alive === 1)
      .sort(([, left], [, right]) => left.playerId.localeCompare(right.playerId));

    for (const [entity, player] of alivePlayers) {
      speedMultiplierByPlayerId.set(player.playerId, movementMultiplierForStatus(world, entity));
      if (isBlockedByStun(world, entity)) {
        continue;
      }
      const input = host.getPlayerInput?.(player.playerId);
      if (input && isDirection8(input.dir)) {
        inputs.set(player.playerId, { dir: input.dir, shoot: input.shoot });
      }
    }

    return { inputs, speedMultiplierByPlayerId };
  };

  return {
    id: PLUGIN_ID,
    onInit(_ctx, world) {
      if (restoreGameplayCheckpoint(world)) {
        const welcome = snapshotEmitter.emitWelcome(world, gameplayCheckpoint.tick ?? 0, msgOut);
        setReplayFrames([welcome]);
        return;
      }
      ensurePlayersSpawned(world);
      ensureZoneInitialized(world);
      ensureRuntimeEcsInitialized(world);
      const welcome = snapshotEmitter.emitWelcome(world, 0, msgOut);
      setReplayFrames([welcome]);
    },
    onTick(world, dt, tick) {
      ensurePlayersSpawned(world);
      ensureZoneInitialized(world);
      ensureRuntimeEcsInitialized(world);

      syncPlayerInputRuntimeComponents(
        world,
        (playerId) => host.getPlayerInput?.(playerId),
        runtimeEcsOptions,
      );
      const movementCollisionEnvironment = buildRuntimeCollisionEnvironment(
        world,
        tileCollisionEnvironment,
      );
      runAbilityStatusSystem(
        world,
        {
          tick,
          getPlayerInput: (playerId) => host.getPlayerInput?.(playerId),
          roomRules,
          bodyByModelId: playerPhysicsByModelId,
          defaultPlayerPhysics: {
            radius: config.movement.radius,
            offsetX: 0,
            offsetY: config.movement.footprintOffsetY,
          },
          ...(movementCollisionEnvironment === undefined
            ? {}
            : { collisionEnvironment: movementCollisionEnvironment }),
        },
        abilityStatusState,
        damageState,
      );
      const movementInputs = buildMovementInputs(world);
      applyMovementTick(world, dt, movementInputs.inputs, movementCollisionEnvironment, {
        speed: config.movement.speed,
        radius: config.movement.radius,
        offsetY: config.movement.footprintOffsetY,
        bodyByModelId: playerPhysicsByModelId,
        speedMultiplierByPlayerId: movementInputs.speedMultiplierByPlayerId,
      });
      syncPlayerInputRuntimeComponents(
        world,
        (playerId) => host.getPlayerInput?.(playerId),
        runtimeEcsOptions,
      );

      const inventoryLootContext = {
        artifact,
        getPlayerInput: (playerId: string) => host.getPlayerInput?.(playerId),
        weaponId: String(weaponEntry.weapon.id),
        pickupRadius: LOOT_PICKUP_RADIUS,
        ammoPickupAmount: INVENTORY.ammoPickupAmount,
        healthPackAmount: INVENTORY.healthPackAmount,
        playerHealth: config.damage.playerHealth,
      };
      runInventoryLootSystem(world, inventoryLootContext, inventoryLootState);

      const combatCollisionEnvironment = buildRuntimeCollisionEnvironment(
        world,
        tileCollisionEnvironment,
      );
      const combatBlockers = buildCombatBlockers(combatCollisionEnvironment);
      const worldView = createBattleRoyaleCombatWorldView(
        world,
        {
          maxHealth: config.damage.playerHealth,
          footprintOffsetY: config.movement.footprintOffsetY,
          bodyByModelId: playerPhysicsByModelId,
        },
        combatBlockers,
      );
      const acceptedFireTicks = new Map<string, number>();

      runCombatSystem(
        world,
        {
          worldView,
          policy: hitPolicy,
          weapon: weaponEntry.weapon,
          delivery: weaponDelivery,
          rng: combatRng,
          damageState,
          getPlayerInput: (playerId) => host.getPlayerInput?.(playerId),
          mapBounds,
          weaponSlotCount: config.projectile.weaponSlotCount,
          initialAmmoReserve: config.projectile.initialAmmoReserve,
          projectileBoundsRadius: config.projectile.radius,
          bodyByModelId: playerPhysicsByModelId,
          tick,
          onWeaponSlotApplied: () => persistGameplayCheckpoint(world, tick),
          onWeaponFired: (event) => {
            acceptedFireTicks.set(event.sourceId, event.tick);
            msgOut?.push(
              encodeServerMessage(
                new GameplayEventFrame({ sequence: gameplayEventSequence++, event }),
              ),
            );
          },
          ...(combatCollisionEnvironment === undefined
            ? {}
            : { collisionEnvironment: combatCollisionEnvironment }),
        },
        combatState,
      );
      runInventoryLootSystem(world, inventoryLootContext, inventoryLootState);
      updatePlayerAnimationStates(
        world,
        (playerId) => host.getPlayerInput?.(playerId),
        (playerId) => acceptedFireTicks.get(playerId),
      );

      runZoneSystem(world, dt, tick, {
        damageState,
        schedule: config.zone.schedule,
        worldView,
        policy: hitPolicy,
      });

      runDamageSystem(
        world,
        tick,
        {
          msgOut,
          roomRules,
          spawnSlots,
          respawnDelayTicks: config.respawn.delayTicks,
          playerHealth: config.damage.playerHealth,
        },
        damageState,
      );

      snapshotEmitter.emitDelta(world, tick, msgOut);
      clearAcceptedFireAnimationMarkers(world);
      setReplayFrames([snapshotEmitter.buildWelcome(world, tick)]);
      persistGameplayCheckpoint(world, tick);
    },
  };
};

export type { ExportedArtifact } from './types/artifact.js';
export type { RuntimePlugin, RuntimePluginHost } from './types/runtime-plugin.js';

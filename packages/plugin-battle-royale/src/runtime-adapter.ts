import { createSeededRng, type ProjectileDelivery } from '@tileborne/simulation';

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
import { PLAYER_COMPONENT, type Player } from './ecs/components.js';
import {
  initializeBattleRoyaleRuntimeEcs,
  syncPlayerInputRuntimeComponents,
  type RuntimeEcsOptions,
} from './ecs/runtime-ecs.js';
import type { Direction8 } from './ecs/movement.js';
import { resolveSpawnSlots, spawnPlayersFromArtifact } from './ecs/spawn-players.js';
import { runZoneSystem } from './ecs/zone-system.js';
import { initZoneFromArtifact } from './ecs/zone.js';
import { buildBattleRoyaleRuntimeState } from './runtime-state-from-package.js';
import { createBattleRoyaleSnapshotEmitter } from './server/snapshot-emitter.js';
import { assertRuntimeBattleRoyaleArtifact } from './types/runtime-artifact-validation.js';
import type { RuntimePlugin, RuntimePluginHost, PluginWorld } from './types/runtime-plugin.js';
import { resolveBattleRoyaleWeaponEntry } from './weapon-catalog.js';

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
  const combatRng = createSeededRng(typeof host.seed === 'number' ? host.seed : 0);
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
          ...(combatCollisionEnvironment === undefined
            ? {}
            : { collisionEnvironment: combatCollisionEnvironment }),
        },
        combatState,
      );
      runInventoryLootSystem(world, inventoryLootContext, inventoryLootState);
      updatePlayerAnimationStates(world, (playerId) => host.getPlayerInput?.(playerId));

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
      setReplayFrames([snapshotEmitter.buildWelcome(world, tick)]);
    },
  };
};

export type { ExportedArtifact } from './types/artifact.js';
export type { RuntimePlugin, RuntimePluginHost } from './types/runtime-plugin.js';

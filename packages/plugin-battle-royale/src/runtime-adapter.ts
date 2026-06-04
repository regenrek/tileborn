import { createSeededRng, type ProjectileDelivery } from '@tileborne/simulation';

import { PLUGIN_ID } from './constants.js';
import { resolveBattleRoyaleConfig } from './battle-royale-config.js';
import {
  createDamageSystemState,
  recordMatchStarters,
  resolveRoomRules,
  runDamageSystem,
} from './ecs/damage-system.js';
import { applyMovementTick, buildCollisionEnvironment } from './ecs/movement.js';
import {
  createCombatSystemState,
  resolveMapBoundsFromArtifact,
  runCombatSystem,
} from './ecs/combat-system.js';
import {
  buildCombatBlockers,
  createBattleRoyaleCombatWorldView,
  createBattleRoyaleHitPolicy,
} from './ecs/combat-world-view.js';
import { PLAYER_COMPONENT, type Player } from './ecs/components.js';
import { resolveSpawnSlots, spawnPlayersFromArtifact } from './ecs/spawn-players.js';
import { runZoneSystem } from './ecs/zone-system.js';
import { initZoneFromArtifact } from './ecs/zone.js';
import { createBattleRoyaleSnapshotEmitter } from './server/snapshot-emitter.js';
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
  const artifact = host.getArtifact();
  const config = resolveBattleRoyaleConfig(artifact, host.config);
  const collisionEnvironment = buildCollisionEnvironment(artifact);
  const combatState = createCombatSystemState();
  const damageState = createDamageSystemState();
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
  const weaponEntry = resolveBattleRoyaleWeaponEntry(config);
  const weaponDelivery = weaponEntry.delivery as ProjectileDelivery;
  const combatBlockers = buildCombatBlockers(collisionEnvironment);
  const hitPolicy = createBattleRoyaleHitPolicy(roomRules);
  const combatRng = createSeededRng(typeof host.seed === 'number' ? host.seed : 0);
  let spawned = false;
  let zoneInitialized = false;

  const ensurePlayersSpawned = (world: PluginWorld): void => {
    if (spawned) {
      return;
    }
    spawnPlayersFromArtifact(world, artifact, { playerHealth: config.damage.playerHealth });
    recordMatchStarters(world, damageState);
    spawned = true;
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

  const buildMovementInputs = (world: PluginWorld) => {
    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    const inputs = new Map<
      string,
      { readonly dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; readonly shoot: boolean }
    >();
    const alivePlayers = [...players.entries()]
      .filter(([, player]) => player.alive === 1)
      .sort(([, left], [, right]) => left.playerId.localeCompare(right.playerId));

    for (const [, player] of alivePlayers) {
      const input = host.getPlayerInput?.(player.playerId);
      if (input) {
        inputs.set(player.playerId, { dir: input.dir, shoot: input.shoot });
      }
    }

    return inputs;
  };

  return {
    id: PLUGIN_ID,
    onInit(_ctx, world) {
      ensurePlayersSpawned(world);
      ensureZoneInitialized(world);
      const welcome = snapshotEmitter.emitWelcome(world, 0, msgOut);
      setReplayFrames([welcome]);
    },
    onTick(world, dt, tick) {
      ensurePlayersSpawned(world);
      ensureZoneInitialized(world);

      const worldView = createBattleRoyaleCombatWorldView(
        world,
        {
          maxHealth: config.damage.playerHealth,
          footprintOffsetY: config.movement.footprintOffsetY,
        },
        combatBlockers,
      );

      applyMovementTick(world, dt, buildMovementInputs(world), collisionEnvironment, {
        speed: config.movement.speed,
        radius: config.movement.radius,
        offsetY: config.movement.footprintOffsetY,
      });

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
          projectileSpeedPerSecond: config.projectile.speed,
          projectileBoundsRadius: config.projectile.radius,
          dt,
        },
        combatState,
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
      setReplayFrames([snapshotEmitter.buildWelcome(world, tick)]);
    },
  };
};

export type { ExportedArtifact } from './types/artifact.js';
export type { RuntimePlugin, RuntimePluginHost } from './types/runtime-plugin.js';

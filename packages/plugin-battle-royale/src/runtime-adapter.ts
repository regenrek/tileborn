import { PLUGIN_ID } from "./constants.js";
import { resolveBattleRoyaleConfig } from "./battle-royale-config.js";
import {
  createDamageSystemState,
  recordMatchStarters,
  resolveRoomRules,
  runDamageSystem,
} from "./ecs/damage-system.js";
import { applyMovementTick, buildCollisionEnvironment } from "./ecs/movement.js";
import {
  createProjectileSystemState,
  resolveMapBoundsFromArtifact,
  runProjectileSystem,
} from "./ecs/projectile-system.js";
import { PLAYER_COMPONENT, type Player } from "./ecs/components.js";
import { resolveSpawnSlots, spawnPlayersFromArtifact } from "./ecs/spawn-players.js";
import { runZoneSystem } from "./ecs/zone-system.js";
import { initZoneFromArtifact } from "./ecs/zone.js";
import { createBattleRoyaleSnapshotEmitter } from "./server/snapshot-emitter.js";
import type { RuntimePlugin, RuntimePluginHost, PluginWorld } from "./types/runtime-plugin.js";

export {
  BattleRoyaleConfig,
  DEFAULT_BATTLE_ROYALE_CONFIG,
  decodeBattleRoyaleConfigOverride,
  mergeBattleRoyaleConfig,
  resolveBattleRoyaleConfig,
} from "./battle-royale-config.js";
export type {
  BattleRoyaleConfigInput,
  ResolvedBattleRoyaleConfig,
} from "./battle-royale-config.js";

export const createRuntimeAdapter = (host: RuntimePluginHost): RuntimePlugin => {
  const artifact = host.getArtifact();
  const config = resolveBattleRoyaleConfig(artifact, host.config);
  const collisionEnvironment = buildCollisionEnvironment(artifact);
  const projectileState = createProjectileSystemState();
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
    const inputs = new Map<string, { readonly dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; readonly shoot: boolean }>();
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

      applyMovementTick(
        world,
        dt,
        buildMovementInputs(world),
        collisionEnvironment,
        {
          speed: config.movement.speed,
          radius: config.movement.radius,
          offsetY: config.movement.footprintOffsetY,
        },
      );

      runProjectileSystem(
        world,
        dt,
        tick,
        {
          damageState,
          mapBounds,
          getPlayerInput: (playerId) => host.getPlayerInput?.(playerId),
          ...(collisionEnvironment ? { collisionEnvironment } : {}),
          config: {
            speed: config.projectile.speed,
            damage: config.projectile.damage,
            ttlTicks: config.projectile.ttlTicks,
            shootCooldownTicks: config.projectile.shootCooldownTicks,
            projectileRadius: config.projectile.radius,
            playerRadius: config.movement.radius,
            playerOffsetY: config.movement.footprintOffsetY,
            weaponSlotCount: config.projectile.weaponSlotCount,
          },
        },
        projectileState,
      );

      runZoneSystem(
        world,
        dt,
        tick,
        {
          damageState,
          schedule: config.zone.schedule,
        },
      );

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

export type { ExportedArtifact } from "./types/artifact.js";
export type { RuntimePlugin, RuntimePluginHost } from "./types/runtime-plugin.js";

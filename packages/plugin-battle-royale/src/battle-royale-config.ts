import { Option, Schema } from "effect";

import { DAMAGE, MOVEMENT, PROJECTILE, RESPAWN, ZONE } from "./constants.js";
import { resolveRoomRules, type RoomRulesConfig } from "./ecs/damage-system.js";
import type { ZoneScheduleConfig } from "./ecs/zone.js";
import type { ExportedArtifact } from "./types/artifact.js";

const BattleRoyaleZoneScheduleOverride = Schema.Struct({
  waitSec: Schema.optional(Schema.Number),
  shrinkSec: Schema.optional(Schema.Number),
  holdSec: Schema.optional(Schema.Number),
  shrinkPhases: Schema.optional(Schema.Number),
  radiusFactor: Schema.optional(Schema.Number),
});

const BattleRoyaleZoneOverride = Schema.Struct({
  damagePerSecOutside: Schema.optional(Schema.Number),
  schedule: Schema.optional(BattleRoyaleZoneScheduleOverride),
});

const BattleRoyaleMovementOverride = Schema.Struct({
  speed: Schema.optional(Schema.Number),
  radius: Schema.optional(Schema.Number),
  footprintOffsetY: Schema.optional(Schema.Number),
});

const BattleRoyaleProjectileOverride = Schema.Struct({
  speed: Schema.optional(Schema.Number),
  damage: Schema.optional(Schema.Number),
  ttlTicks: Schema.optional(Schema.Number),
  shootCooldownTicks: Schema.optional(Schema.Number),
  radius: Schema.optional(Schema.Number),
  weaponSlotCount: Schema.optional(Schema.Number),
  magazineSize: Schema.optional(Schema.Number),
  reloadTicks: Schema.optional(Schema.Number),
  initialAmmoReserve: Schema.optional(Schema.Number),
});

const BattleRoyaleDamageOverride = Schema.Struct({
  playerHealth: Schema.optional(Schema.Number),
});

const BattleRoyaleRespawnOverride = Schema.Struct({
  delayTicks: Schema.optional(Schema.Number),
  enabled: Schema.optional(Schema.Boolean),
});

const BattleRoyaleRoomRulesOverride = Schema.Struct({
  respawnEnabled: Schema.optional(Schema.Boolean),
  friendlyFire: Schema.optional(Schema.Boolean),
  matchMode: Schema.optional(Schema.Literals(["solo", "duo", "squad"] as const)),
});

/** Partial per-room overrides for battle royale gameplay constants. */
export class BattleRoyaleConfig extends Schema.Class<BattleRoyaleConfig>("BattleRoyaleConfig")({
  tickRate: Schema.optional(Schema.Number),
  movement: Schema.optional(BattleRoyaleMovementOverride),
  zone: Schema.optional(BattleRoyaleZoneOverride),
  projectile: Schema.optional(BattleRoyaleProjectileOverride),
  damage: Schema.optional(BattleRoyaleDamageOverride),
  respawn: Schema.optional(BattleRoyaleRespawnOverride),
  roomRules: Schema.optional(BattleRoyaleRoomRulesOverride),
}) {}

export type BattleRoyaleConfigInput = typeof BattleRoyaleConfig.Type;

export interface ResolvedBattleRoyaleConfig {
  readonly tickRate: number;
  readonly movement: {
    readonly speed: number;
    readonly radius: number;
    readonly footprintOffsetY: number;
  };
  readonly zone: {
    readonly damagePerSecOutside: number;
    readonly schedule: ZoneScheduleConfig;
  };
  readonly projectile: {
    readonly speed: number;
    readonly damage: number;
    readonly ttlTicks: number;
    readonly shootCooldownTicks: number;
    readonly radius: number;
    readonly weaponSlotCount: number;
    readonly magazineSize: number;
    readonly reloadTicks: number;
    readonly initialAmmoReserve: number;
  };
  readonly damage: {
    readonly playerHealth: number;
  };
  readonly respawn: {
    readonly delayTicks: number;
    readonly enabled: boolean;
  };
  readonly roomRules: RoomRulesConfig;
}

export const DEFAULT_BATTLE_ROYALE_CONFIG: ResolvedBattleRoyaleConfig = {
  tickRate: MOVEMENT.tickRate,
  movement: {
    speed: MOVEMENT.speed,
    radius: MOVEMENT.radius,
    footprintOffsetY: MOVEMENT.footprintOffsetY,
  },
  zone: {
    damagePerSecOutside: ZONE.damagePerSecond,
    schedule: {
      waitSec: ZONE.schedule.waitSec,
      shrinkSec: ZONE.schedule.shrinkSec,
      holdSec: ZONE.schedule.holdSec,
      shrinkPhases: ZONE.schedule.shrinkPhases,
      radiusFactor: ZONE.schedule.radiusFactor,
      tickRate: MOVEMENT.tickRate,
    },
  },
  projectile: {
    speed: PROJECTILE.speed,
    damage: PROJECTILE.damage,
    ttlTicks: PROJECTILE.ttlTicks,
    shootCooldownTicks: PROJECTILE.shootCooldownTicks,
    radius: PROJECTILE.radius,
    weaponSlotCount: PROJECTILE.weaponSlotCount,
    magazineSize: PROJECTILE.magazineSize,
    reloadTicks: PROJECTILE.reloadTicks,
    initialAmmoReserve: PROJECTILE.initialAmmoReserve,
  },
  damage: {
    playerHealth: DAMAGE.playerHealth,
  },
  respawn: {
    delayTicks: RESPAWN.delayTicks,
    enabled: false,
  },
  roomRules: {
    respawnEnabled: false,
    friendlyFire: false,
    matchMode: "solo",
  },
};

export const decodeBattleRoyaleConfigOverride = (input: unknown): BattleRoyaleConfigInput | undefined => {
  const decoded = Schema.decodeUnknownOption(BattleRoyaleConfig)(input);
  return Option.getOrUndefined(decoded);
};

const mergeZoneSchedule = (
  base: ZoneScheduleConfig,
  override: BattleRoyaleConfigInput["zone"],
  tickRate: number,
): ZoneScheduleConfig => ({
  waitSec: override?.schedule?.waitSec ?? base.waitSec,
  shrinkSec: override?.schedule?.shrinkSec ?? base.shrinkSec,
  holdSec: override?.schedule?.holdSec ?? base.holdSec,
  shrinkPhases: override?.schedule?.shrinkPhases ?? base.shrinkPhases,
  radiusFactor: override?.schedule?.radiusFactor ?? base.radiusFactor,
  tickRate,
});

export const mergeBattleRoyaleConfig = (
  base: ResolvedBattleRoyaleConfig,
  override: BattleRoyaleConfigInput | undefined,
): ResolvedBattleRoyaleConfig => {
  if (!override) {
    return base;
  }

  const tickRate = override.tickRate ?? base.tickRate;
  const zoneSchedule = mergeZoneSchedule(base.zone.schedule, override.zone, tickRate);

  return {
    tickRate,
    movement: {
      speed: override.movement?.speed ?? base.movement.speed,
      radius: override.movement?.radius ?? base.movement.radius,
      footprintOffsetY: override.movement?.footprintOffsetY ?? base.movement.footprintOffsetY,
    },
    zone: {
      damagePerSecOutside: override.zone?.damagePerSecOutside ?? base.zone.damagePerSecOutside,
      schedule: zoneSchedule,
    },
    projectile: {
      speed: override.projectile?.speed ?? base.projectile.speed,
      damage: override.projectile?.damage ?? base.projectile.damage,
      ttlTicks: override.projectile?.ttlTicks ?? base.projectile.ttlTicks,
      shootCooldownTicks: override.projectile?.shootCooldownTicks ?? base.projectile.shootCooldownTicks,
      radius: override.projectile?.radius ?? base.projectile.radius,
      weaponSlotCount: override.projectile?.weaponSlotCount ?? base.projectile.weaponSlotCount,
      magazineSize: override.projectile?.magazineSize ?? base.projectile.magazineSize,
      reloadTicks: override.projectile?.reloadTicks ?? base.projectile.reloadTicks,
      initialAmmoReserve: override.projectile?.initialAmmoReserve ?? base.projectile.initialAmmoReserve,
    },
    damage: {
      playerHealth: override.damage?.playerHealth ?? base.damage.playerHealth,
    },
    respawn: {
      delayTicks: override.respawn?.delayTicks ?? base.respawn.delayTicks,
      enabled: override.respawn?.enabled ?? base.respawn.enabled,
    },
    roomRules: resolveRoomRules({
      ...(override.roomRules?.respawnEnabled !== undefined
        ? { respawnEnabled: override.roomRules.respawnEnabled }
        : {}),
      ...(override.respawn?.enabled !== undefined ? { respawnEnabled: override.respawn.enabled } : {}),
      ...(override.roomRules?.friendlyFire !== undefined
        ? { friendlyFire: override.roomRules.friendlyFire }
        : {}),
      ...(override.roomRules?.matchMode !== undefined ? { matchMode: override.roomRules.matchMode } : {}),
    }),
  };
};

export const resolveBattleRoyaleConfig = (
  artifact: ExportedArtifact,
  hostConfig: BattleRoyaleConfigInput | undefined,
): ResolvedBattleRoyaleConfig => {
  const artifactDefaults: ResolvedBattleRoyaleConfig = {
    ...DEFAULT_BATTLE_ROYALE_CONFIG,
    zone: {
      ...DEFAULT_BATTLE_ROYALE_CONFIG.zone,
      damagePerSecOutside: artifact.shrinkSchedule.damagePerSecond,
    },
  };

  const fromMap = mergeBattleRoyaleConfig(artifactDefaults, artifact.battleRoyale);
  return mergeBattleRoyaleConfig(fromMap, hostConfig);
};

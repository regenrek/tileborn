import { Schema } from "effect";

import { MOVEMENT, ZONE } from "../constants.js";

import type { ExportedArtifact } from "../types/artifact.js";
import type { PluginWorld } from "../types/runtime-plugin.js";

/** Battle royale safe-zone singleton tracked by the runtime adapter. */
export class ZoneComponent extends Schema.Class<ZoneComponent>("ZoneComponent")({
  cx: Schema.Number,
  cy: Schema.Number,
  currentRadius: Schema.Number,
  targetRadius: Schema.Number,
  shrinkStartTick: Schema.Int,
  shrinkDurationTicks: Schema.Int,
  shrinkFromRadius: Schema.Number,
  damagePerSecOutside: Schema.Number,
  schedulePhaseIndex: Schema.Int,
  phaseStartTick: Schema.Int,
}) {}

export const ZONE_COMPONENT = "Zone";

export type Zone = typeof ZoneComponent.Type;

export interface ZoneScheduleConfig {
  readonly waitSec: number;
  readonly shrinkSec: number;
  readonly holdSec: number;
  readonly shrinkPhases: number;
  readonly radiusFactor: number;
  readonly tickRate: number;
}

export const DEFAULT_ZONE_SCHEDULE: ZoneScheduleConfig = {
  waitSec: ZONE.schedule.waitSec,
  shrinkSec: ZONE.schedule.shrinkSec,
  holdSec: ZONE.schedule.holdSec,
  shrinkPhases: ZONE.schedule.shrinkPhases,
  radiusFactor: ZONE.schedule.radiusFactor,
  tickRate: MOVEMENT.tickRate,
};

export interface ZoneInitOptions {
  readonly schedule?: ZoneScheduleConfig;
  readonly damagePerSecOutside?: number;
}

let zoneEntity: number | undefined;

export const registerZoneComponent = (world: PluginWorld): void => {
  world.registerComponent<Zone>(ZONE_COMPONENT);
};

export const initZoneFromArtifact = (
  world: PluginWorld,
  artifact: ExportedArtifact,
  options: ZoneInitOptions = {},
): number => {
  registerZoneComponent(world);
  const zones = world.getComponent<Zone>(ZONE_COMPONENT);

  const entity = zoneEntity ?? world.createEntity();
  zoneEntity = entity;

  const schedule = options.schedule ?? DEFAULT_ZONE_SCHEDULE;
  const initialRadius = artifact.shrinkSchedule.startRadiusTiles;

  zones.set(entity, {
    cx: artifact.shrinkSchedule.centerX,
    cy: artifact.shrinkSchedule.centerY,
    currentRadius: initialRadius,
    targetRadius: initialRadius,
    shrinkStartTick: -1,
    shrinkDurationTicks: schedule.shrinkSec * schedule.tickRate,
    shrinkFromRadius: initialRadius,
    damagePerSecOutside: options.damagePerSecOutside ?? artifact.shrinkSchedule.damagePerSecond,
    schedulePhaseIndex: 0,
    phaseStartTick: 0,
  });

  return entity;
};

export const getZone = (world: PluginWorld): Zone | undefined => {
  if (zoneEntity === undefined) {
    return undefined;
  }
  return world.getComponent<Zone>(ZONE_COMPONENT).get(zoneEntity);
};

export const getZoneEntity = (): number | undefined => zoneEntity;

export const resetZoneSingleton = (): void => {
  zoneEntity = undefined;
};

export const distanceOutsideZone = (zone: Zone, x: number, y: number): number => {
  const distance = Math.hypot(x - zone.cx, y - zone.cy);
  return Math.max(0, distance - zone.currentRadius);
};

export const isOutsideZone = (zone: Zone, x: number, y: number): boolean =>
  distanceOutsideZone(zone, x, y) > 0;

export const phaseDurationTicks = (
  phaseIndex: number,
  schedule: ZoneScheduleConfig,
): number => {
  if (phaseIndex === 0) {
    return schedule.waitSec * schedule.tickRate;
  }
  return (schedule.shrinkSec + schedule.holdSec) * schedule.tickRate;
};

export const totalSchedulePhases = (schedule: ZoneScheduleConfig): number =>
  1 + schedule.shrinkPhases;

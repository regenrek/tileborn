import { PLAYER_COMPONENT, POSITION_COMPONENT, type Player, type Position } from './components.js';
import {
  DEFAULT_ZONE_SCHEDULE,
  getZone,
  getZoneEntity,
  isOutsideZone,
  phaseDurationTicks,
  totalSchedulePhases,
  ZONE_COMPONENT,
  type Zone,
  type ZoneScheduleConfig,
} from './zone.js';
import type { CombatWorldView, HitResolutionPolicy } from '@tileborne/simulation';

import { applyEnvironmentDamage } from './combat-system.js';
import { type DamageSystemState } from './damage-system.js';
import type { PluginWorld } from '../types/runtime-plugin.js';

export interface ZoneSystemContext {
  readonly schedule?: ZoneScheduleConfig;
  readonly damageState: DamageSystemState;
  readonly worldView: CombatWorldView;
  readonly policy: HitResolutionPolicy;
}

const interpolateShrinkRadius = (zone: Zone, tick: number): number => {
  if (zone.shrinkStartTick < 0 || zone.shrinkDurationTicks <= 0) {
    return zone.currentRadius;
  }

  const elapsed = tick - zone.shrinkStartTick;
  if (elapsed <= 0) {
    return zone.shrinkFromRadius;
  }
  if (elapsed >= zone.shrinkDurationTicks) {
    return zone.targetRadius;
  }

  const progress = elapsed / zone.shrinkDurationTicks;
  return zone.shrinkFromRadius + (zone.targetRadius - zone.shrinkFromRadius) * progress;
};

const beginShrinkPhase = (zone: Zone, tick: number, schedule: ZoneScheduleConfig): Zone => ({
  ...zone,
  shrinkFromRadius: zone.currentRadius,
  targetRadius: zone.currentRadius * schedule.radiusFactor,
  shrinkStartTick: tick,
  shrinkDurationTicks: schedule.shrinkSec * schedule.tickRate,
  phaseStartTick: tick,
});

const advanceSchedule = (zone: Zone, tick: number, schedule: ZoneScheduleConfig): Zone => {
  const maxPhaseIndex = totalSchedulePhases(schedule) - 1;
  if (zone.schedulePhaseIndex > maxPhaseIndex) {
    return zone;
  }

  const phaseElapsed = tick - zone.phaseStartTick;
  const phaseDuration = phaseDurationTicks(zone.schedulePhaseIndex, schedule);
  if (phaseElapsed < phaseDuration) {
    return zone;
  }

  const nextPhaseIndex = zone.schedulePhaseIndex + 1;
  if (nextPhaseIndex > maxPhaseIndex) {
    return {
      ...zone,
      schedulePhaseIndex: nextPhaseIndex,
      phaseStartTick: tick,
      shrinkStartTick: -1,
    };
  }

  const nextZone: Zone = {
    ...zone,
    schedulePhaseIndex: nextPhaseIndex,
    phaseStartTick: tick,
    shrinkStartTick: -1,
  };

  if (nextPhaseIndex >= 1) {
    return beginShrinkPhase(nextZone, tick, schedule);
  }

  return nextZone;
};

const updateZoneRadius = (zone: Zone, tick: number, schedule: ZoneScheduleConfig): Zone => {
  const next = advanceSchedule(zone, tick, schedule);

  if (next.schedulePhaseIndex === 0) {
    return {
      ...next,
      currentRadius: next.targetRadius,
      shrinkStartTick: -1,
    };
  }

  if (next.shrinkStartTick >= 0) {
    const interpolated = interpolateShrinkRadius(next, tick);
    return {
      ...next,
      currentRadius: interpolated,
    };
  }

  return next;
};

const applyZoneDamage = (
  world: PluginWorld,
  zone: Zone,
  dt: number,
  tick: number,
  ctx: ZoneSystemContext,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);

  for (const [entity, player] of players.entries()) {
    if (player.alive !== 1) {
      continue;
    }

    const position = positions.get(entity);
    if (!position || !isOutsideZone(zone, position.x, position.y)) {
      continue;
    }

    applyEnvironmentDamage(
      world,
      ctx.worldView,
      ctx.policy,
      ctx.damageState,
      entity,
      zone.damagePerSecOutside * dt,
      tick,
    );
  }
};

export const runZoneSystem = (
  world: PluginWorld,
  dt: number,
  tick: number,
  ctx: ZoneSystemContext,
): void => {
  const zone = getZone(world);
  if (!zone) {
    return;
  }

  const schedule = ctx.schedule ?? DEFAULT_ZONE_SCHEDULE;
  const zoneEntity = getZoneEntity();
  if (zoneEntity === undefined) {
    return;
  }

  const zones = world.getComponent<Zone>(ZONE_COMPONENT);
  const updated = updateZoneRadius(zone, tick, schedule);
  zones.set(zoneEntity, updated);
  applyZoneDamage(world, updated, dt, tick, ctx);
};

import {
  DEFAULT_MAX_PLAYERS,
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  ZONE,
} from '@tileborne/plugin-battle-royale';
import { TileborneMap, type JsonObject } from '@tileborne/core';

export const BATTLE_ROYALE_AUTHORING_OBJECTS = [
  {
    kind: SPAWN_POINT_KIND,
    label: 'Spawn point',
    description: 'Player start position',
  },
  {
    kind: SHRINK_ZONE_ANCHOR_KIND,
    label: 'Shrink anchor',
    description: 'Safe-zone center',
  },
  {
    kind: LOOT_CRATE_KIND,
    label: 'Loot crate',
    description: 'Supply source',
  },
] as const;

export interface BattleRoyaleAuthoringSettings {
  readonly maxPlayers: number;
  readonly waitSec: number;
  readonly shrinkSec: number;
  readonly holdSec: number;
  readonly shrinkPhases: number;
  readonly damagePerSecOutside: number;
}

const readPositiveNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const readBattleRoyaleObject = (value: unknown): JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

export const readBattleRoyaleAuthoringSettings = (
  map: TileborneMap,
): BattleRoyaleAuthoringSettings => {
  const battleRoyale = readBattleRoyaleObject(map.properties.battleRoyale);
  const zone = readBattleRoyaleObject(battleRoyale.zone);
  const schedule = readBattleRoyaleObject(zone.schedule);
  return {
    maxPlayers: readPositiveNumber(map.properties.maxPlayers, DEFAULT_MAX_PLAYERS),
    waitSec: readPositiveNumber(schedule.waitSec, ZONE.schedule.waitSec),
    shrinkSec: readPositiveNumber(schedule.shrinkSec, ZONE.schedule.shrinkSec),
    holdSec: readPositiveNumber(schedule.holdSec, ZONE.schedule.holdSec),
    shrinkPhases: readPositiveNumber(schedule.shrinkPhases, ZONE.schedule.shrinkPhases),
    damagePerSecOutside: readPositiveNumber(
      zone.damagePerSecOutside,
      ZONE.damagePerSecond,
    ),
  };
};

export const battleRoyaleObjectCounts = (map: TileborneMap) => ({
  spawnPoints: map.objects.filter((object) => object.kind === SPAWN_POINT_KIND).length,
  shrinkAnchors: map.objects.filter((object) => object.kind === SHRINK_ZONE_ANCHOR_KIND).length,
  lootCrates: map.objects.filter((object) => object.kind === LOOT_CRATE_KIND).length,
});

export const applyBattleRoyaleAuthoringSettings = (
  map: TileborneMap,
  settings: BattleRoyaleAuthoringSettings,
): TileborneMap => {
  const previousBattleRoyale = readBattleRoyaleObject(map.properties.battleRoyale);
  const previousZone = readBattleRoyaleObject(previousBattleRoyale.zone);
  const previousSchedule = readBattleRoyaleObject(previousZone.schedule);
  return new TileborneMap({
    ...map,
    properties: {
      ...map.properties,
      maxPlayers: Math.max(1, Math.round(settings.maxPlayers)),
      battleRoyale: {
        ...previousBattleRoyale,
        zone: {
          ...previousZone,
          damagePerSecOutside: Math.max(0.1, settings.damagePerSecOutside),
          schedule: {
            ...previousSchedule,
            waitSec: Math.max(1, settings.waitSec),
            shrinkSec: Math.max(1, settings.shrinkSec),
            holdSec: Math.max(1, settings.holdSec),
            shrinkPhases: Math.max(1, Math.round(settings.shrinkPhases)),
          },
        },
      },
    },
  });
};

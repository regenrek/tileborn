import { TileborneMap, type JsonObject } from "@tileborne/core";

import { DEFAULT_MAX_PLAYERS, LOOT_CRATE_KIND, SHRINK_ZONE_ANCHOR_KIND, SPAWN_POINT_KIND, ZONE } from "../constants.js";

/**
 * Per-map Battle Royale authoring settings (zone schedule + max players),
 * read from / written to `map.properties`. Plugin-owned because these are BR
 * product-domain defaults + the durable shape consumed by the playtest export;
 * the editor's authoring panel reads/writes them through this contribution.
 */
export interface BattleRoyaleAuthoringSettings {
  readonly maxPlayers: number;
  readonly waitSec: number;
  readonly shrinkSec: number;
  readonly holdSec: number;
  readonly shrinkPhases: number;
  readonly damagePerSecOutside: number;
}

const readPositiveNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const readBattleRoyaleObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
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

/**
 * Declarative authoring-settings form contribution: the BR zone/max-player
 * field set + per-field UI hints + draft (de)serialization and validation. This
 * is the canonical owner of the BR settings FIELD policy; the editor inspector
 * renders + validates the form generically from this declaration without naming
 * any BR field.
 */
export const BATTLE_ROYALE_AUTHORING_SETTINGS_FORM = {
  fields: [
    { key: "maxPlayers", label: "Max players", min: 1, step: 1 },
    { key: "waitSec", label: "Zone wait", min: 1, step: 1 },
    { key: "shrinkSec", label: "Shrink time", min: 1, step: 1 },
    { key: "holdSec", label: "Hold time", min: 1, step: 1 },
    { key: "shrinkPhases", label: "Phases", min: 1, step: 1 },
    { key: "damagePerSecOutside", label: "Zone DPS", min: 1, step: 0.5 },
  ] as readonly { readonly key: string; readonly label: string; readonly min: number; readonly step: number }[],
  toDraft: (settings: BattleRoyaleAuthoringSettings): Record<string, string> => ({
    maxPlayers: String(settings.maxPlayers),
    waitSec: String(settings.waitSec),
    shrinkSec: String(settings.shrinkSec),
    holdSec: String(settings.holdSec),
    shrinkPhases: String(settings.shrinkPhases),
    damagePerSecOutside: String(settings.damagePerSecOutside),
  }),
  parseDraft: (draft: Record<string, string>): BattleRoyaleAuthoringSettings | undefined => {
    const parsed = Object.fromEntries(
      Object.entries(draft).map(([key, value]) => [key, Number(value)]),
    ) as Record<keyof BattleRoyaleAuthoringSettings, number>;
    return Object.values(parsed).every((value) => Number.isFinite(value) && value > 0)
      ? parsed
      : undefined;
  },
  invalidMessage: "Battle Royale settings must be positive numbers.",
};

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

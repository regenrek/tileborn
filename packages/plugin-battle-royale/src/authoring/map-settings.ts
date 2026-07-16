import {
  TileborneMap,
  readPluginMapSettings,
  writePluginSettingsNamespace,
  type JsonObject,
} from "@tileborne/core";

import { DEFAULT_MAX_PLAYERS, LOOT_CRATE_KIND, PLUGIN_ID, SHRINK_ZONE_ANCHOR_KIND, SPAWN_POINT_KIND, ZONE } from "../constants.js";

/**
 * Per-map Battle Royale authoring settings (zone schedule + max players).
 *
 * ADR-0023 section A: per-map settings VALUES persist under the NEUTRAL
 * per-plugin namespace `map.properties.<pluginId>` (here `PLUGIN_ID`), folding
 * in what used to be the hardcoded `map.properties.battleRoyale` override object
 * + the top-level `map.properties.maxPlayers` key. The literal keys are
 * hard-cut on write; {@link readBattleRoyaleMapSettings} provides a load-time
 * migration so maps authored before the cut still read. BR keeps OWNING the
 * translation between the flat field set the editor renders and its durable
 * nested `BattleRoyaleConfig` override (consumed by the playtest export).
 */
export interface BattleRoyaleAuthoringSettings {
  readonly maxPlayers: number;
  readonly waitSec: number;
  readonly shrinkSec: number;
  readonly holdSec: number;
  readonly shrinkPhases: number;
  readonly damagePerSecOutside: number;
  readonly matchMode: "solo" | "duo" | "squad";
  readonly matchEndPolicy: "last-standing" | "continuous";
  readonly respawnEnabled: boolean;
  readonly friendlyFire: boolean;
  readonly startingWeaponId: string | undefined;
}

/** Legacy keys hard-cut from `map.properties` on the next save (ADR-0023). */
const LEGACY_KEYS = ["battleRoyale", "maxPlayers"] as const;

const readPositiveNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const readObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

const readMatchMode = (value: unknown): BattleRoyaleAuthoringSettings["matchMode"] =>
  value === "duo" || value === "squad" ? value : "solo";

const readMatchEndPolicy = (
  value: unknown,
  respawnEnabled: boolean,
): BattleRoyaleAuthoringSettings["matchEndPolicy"] =>
  value === "continuous" || (value !== "last-standing" && respawnEnabled)
    ? "continuous"
    : "last-standing";

const omitKeys = (bag: JsonObject, keys: readonly string[]): JsonObject =>
  Object.fromEntries(Object.entries(bag).filter(([key]) => !keys.includes(key)));

/**
 * Read BR's per-map settings bag from the neutral namespace, with a load-time
 * migration from the legacy `map.properties.battleRoyale` override +
 * `map.properties.maxPlayers` for maps authored before the namespace cut. The
 * returned object is a `BattleRoyaleConfig`-compatible override that ALSO
 * carries `maxPlayers` (folded in). Exported so the playtest export reader
 * consumes the same migrated shape.
 */
export const readBattleRoyaleMapSettings = (map: TileborneMap): JsonObject => {
  const namespaced = readPluginMapSettings(map, PLUGIN_ID);
  if (Object.keys(namespaced).length > 0) {
    return namespaced;
  }
  const legacyBattleRoyale = readObject(map.properties.battleRoyale);
  const legacyMaxPlayers = map.properties.maxPlayers;
  if (Object.keys(legacyBattleRoyale).length === 0 && typeof legacyMaxPlayers !== "number") {
    return {};
  }
  return {
    ...legacyBattleRoyale,
    ...(typeof legacyMaxPlayers === "number" ? { maxPlayers: legacyMaxPlayers } : {}),
  };
};

export const readBattleRoyaleAuthoringSettings = (
  map: TileborneMap,
): BattleRoyaleAuthoringSettings => {
  const settings = readBattleRoyaleMapSettings(map);
  const zone = readObject(settings.zone);
  const schedule = readObject(zone.schedule);
  const roomRules = readObject(settings.roomRules);
  const respawn = readObject(settings.respawn);
  const loadout = readObject(settings.loadout);
  const respawnEnabled =
    typeof roomRules.respawnEnabled === "boolean"
      ? roomRules.respawnEnabled
      : typeof respawn.enabled === "boolean"
        ? respawn.enabled
        : false;
  return {
    maxPlayers: readPositiveNumber(settings.maxPlayers, DEFAULT_MAX_PLAYERS),
    waitSec: readPositiveNumber(schedule.waitSec, ZONE.schedule.waitSec),
    shrinkSec: readPositiveNumber(schedule.shrinkSec, ZONE.schedule.shrinkSec),
    holdSec: readPositiveNumber(schedule.holdSec, ZONE.schedule.holdSec),
    shrinkPhases: readPositiveNumber(schedule.shrinkPhases, ZONE.schedule.shrinkPhases),
    damagePerSecOutside: readPositiveNumber(zone.damagePerSecOutside, ZONE.damagePerSecond),
    matchMode: readMatchMode(roomRules.matchMode),
    matchEndPolicy: readMatchEndPolicy(roomRules.matchEndPolicy, respawnEnabled),
    respawnEnabled,
    friendlyFire: typeof roomRules.friendlyFire === "boolean" ? roomRules.friendlyFire : false,
    startingWeaponId: typeof loadout.startingWeaponId === "string" ? loadout.startingWeaponId : undefined,
  };
};

export const battleRoyaleObjectCounts = (map: TileborneMap) => ({
  spawnPoints: map.objects.filter((object) => object.kind === SPAWN_POINT_KIND).length,
  shrinkAnchors: map.objects.filter((object) => object.kind === SHRINK_ZONE_ANCHOR_KIND).length,
  lootCrates: map.objects.filter((object) => object.kind === LOOT_CRATE_KIND).length,
});

export const applyBattleRoyaleAuthoringSettings = (
  map: TileborneMap,
  settings: Omit<BattleRoyaleAuthoringSettings, "matchMode" | "matchEndPolicy" | "respawnEnabled" | "friendlyFire" | "startingWeaponId"> &
    Partial<Pick<BattleRoyaleAuthoringSettings, "matchMode" | "matchEndPolicy" | "respawnEnabled" | "friendlyFire" | "startingWeaponId">>,
): TileborneMap => {
  const current = readBattleRoyaleAuthoringSettings(map);
  const previous = readBattleRoyaleMapSettings(map);
  const previousZone = readObject(previous.zone);
  const previousSchedule = readObject(previousZone.schedule);
  const previousRoomRules = readObject(previous.roomRules);
  const previousRespawn = readObject(previous.respawn);
  const nextSettings: JsonObject = {
    ...previous,
    maxPlayers: Math.max(1, Math.round(settings.maxPlayers)),
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
    roomRules: {
      ...previousRoomRules,
      matchMode: settings.matchMode ?? current.matchMode,
      matchEndPolicy: (settings.respawnEnabled ?? current.respawnEnabled)
        ? "continuous"
        : settings.matchEndPolicy ?? current.matchEndPolicy,
      respawnEnabled: settings.respawnEnabled ?? current.respawnEnabled,
      friendlyFire: settings.friendlyFire ?? current.friendlyFire,
    },
    respawn: {
      ...previousRespawn,
      enabled: settings.respawnEnabled ?? current.respawnEnabled,
    },
    loadout: settings.startingWeaponId === undefined
      ? readObject(previous.loadout)
      : settings.startingWeaponId.length === 0
        ? {}
        : { ...readObject(previous.loadout), startingWeaponId: settings.startingWeaponId },
  };
  // Write under the neutral namespace and hard-cut the legacy literal keys.
  return new TileborneMap({
    ...map,
    properties: writePluginSettingsNamespace(
      omitKeys(map.properties, LEGACY_KEYS),
      PLUGIN_ID,
      nextSettings,
    ),
  });
};

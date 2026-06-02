import { Schema } from "effect";

import { TileborneMap } from "./index.js";
import { migrateLegacyMapJson } from "./migrate.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fill the `OptionFromUndefinedOr` keys on a persisted `MapObjectPlacement`
 * (`packId`/`assetId`/`tileId`/`gid`) that on-disk JSON omits, so the placement
 * decodes against the schema. A present `undefined` decodes to `Option.none`;
 * an absent key would otherwise fail the (required-key) transform.
 */
const normalizePlacementJson = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    packId: "packId" in value ? value.packId : undefined,
    assetId: "assetId" in value ? value.assetId : undefined,
    tileId: "tileId" in value ? value.tileId : undefined,
    gid: "gid" in value ? value.gid : undefined,
  };
};

/**
 * Fill the `OptionFromUndefinedOr` keys on a persisted `MapObject`
 * (`width`/`height`, plus the placement sub-fields when a placement is present)
 * that on-disk JSON omits, so the object decodes against the schema. An absent
 * (optional) `placement` is materialized to an explicit `undefined` so the
 * shape is stable across the decode and IPC-payload paths.
 */
const normalizeObjectJson = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    width: "width" in value ? value.width : undefined,
    height: "height" in value ? value.height : undefined,
    placement: "placement" in value ? normalizePlacementJson(value.placement) : undefined,
  };
};

/**
 * THE canonical plain-JSON load transform for persisted Tileborne maps
 * (ADR-0019). Runs the legacy `MapObject.kind` migration
 * ({@link migrateLegacyMapJson}) and then fills the `OptionFromUndefinedOr`
 * object/placement keys that on-disk JSON omits — returning **plain JSON** (not
 * a decoded {@link TileborneMap} class instance).
 *
 * This is the single migrate+normalize SSOT shared by EVERY persisted-map load
 * boundary: {@link decodePersistedTileborneMapJson} (services/CLI/asset that
 * want a decoded instance), the IPC map-payload shaping path, AND the playtest
 * runtime host (which hands plain JSON to plugins and must not skip the
 * normalize step). Idempotent — safe on already-migrated/normalized maps.
 */
export const normalizeAndMigratePersistedMapJson = (parsed: unknown): unknown => {
  const migrated = migrateLegacyMapJson(parsed);
  if (!isRecord(migrated) || !Array.isArray(migrated.objects)) {
    return migrated;
  }
  return {
    ...migrated,
    objects: migrated.objects.map(normalizeObjectJson),
  };
};

/**
 * THE canonical persisted-map decode boundary (ADR-0019). Every raw decode of a
 * persisted Tileborne map — CLI map reads, headless playtest artifact decode,
 * asset cleanup, and the map services — MUST route through this helper so the
 * legacy-`kind` migration can never be skipped at a load boundary (and so a
 * single normalization rule governs every entry point). It runs the shared
 * {@link normalizeAndMigratePersistedMapJson} plain-JSON transform, then decodes
 * the result against {@link TileborneMap}.
 *
 * Throws on an unmappable legacy kind (`LegacyMapObjectKindError`) or a map that
 * is structurally invalid (`ParseError`) — we fail loudly rather than load
 * corrupted data.
 */
export const decodePersistedTileborneMapJson = (parsed: unknown): TileborneMap =>
  Schema.decodeUnknownSync(TileborneMap)(normalizeAndMigratePersistedMapJson(parsed));

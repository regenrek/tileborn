import { Schema } from "effect";

import { gameObjectTypeIdForKey } from "../catalog/well-known.js";
import type { GameObjectTypeId } from "../ids.js";

/**
 * Raised when a persisted `MapObject.kind` cannot be migrated to a catalog
 * {@link GameObjectTypeId} without guessing — we fail loudly rather than
 * silently corrupting the user's map data (ADR-0019 / hard-cut migration).
 */
export class LegacyMapObjectKindError extends Schema.TaggedErrorClass<LegacyMapObjectKindError>()(
  "LegacyMapObjectKindError",
  {
    kind: Schema.String,
    message: Schema.String,
  },
) {}

const GOBJ_PATTERN = /^gobj:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A safe legacy "kind" slug: lowercase letters/digits/hyphens, e.g. "spawn-point". */
const LEGACY_KIND_SLUG = /^[a-z][a-z0-9-]*$/;

/**
 * Map a single persisted `MapObject.kind` value to a catalog
 * {@link GameObjectTypeId}.
 *
 * - Already-migrated ids (`gobj:<uuid>`) pass through unchanged (idempotent).
 * - A legacy semantic slug (`placeable`, `object`, `spawn-point`, …) is mapped
 *   deterministically to its catalog id via {@link gameObjectTypeIdForKey}, the
 *   same derivation engine + plugins use when registering catalog content, so a
 *   given legacy kind always resolves to the registered type.
 * - Anything else (empty, non-slug, or a different prefixed id like `asset:…`)
 *   throws {@link LegacyMapObjectKindError} — we never coerce ambiguous data.
 */
export const migrateLegacyMapObjectKind = (kind: string): GameObjectTypeId => {
  if (GOBJ_PATTERN.test(kind)) {
    return kind as GameObjectTypeId;
  }
  if (LEGACY_KIND_SLUG.test(kind)) {
    return gameObjectTypeIdForKey(kind);
  }
  throw new LegacyMapObjectKindError({
    kind,
    message: `cannot migrate legacy MapObject.kind "${kind}" to a catalog GameObjectTypeId`,
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One-time, read-time migration applied to raw persisted map JSON *before*
 * schema decode. Rewrites each object's legacy free-string `kind` to a catalog
 * {@link GameObjectTypeId}. Idempotent (safe to run on already-migrated maps).
 *
 * This is a data migration, not a dual code path: the engine has a single
 * `kind: GameObjectTypeId` contract after decode. Maps with an unmappable kind
 * throw {@link LegacyMapObjectKindError} rather than load corrupted.
 */
export const migrateLegacyMapJson = (value: unknown): unknown => {
  if (!isRecord(value) || !Array.isArray(value.objects)) {
    return value;
  }
  return {
    ...value,
    objects: value.objects.map((object) => {
      if (!isRecord(object) || typeof object.kind !== "string") {
        return object;
      }
      return { ...object, kind: migrateLegacyMapObjectKind(object.kind) };
    }),
  };
};

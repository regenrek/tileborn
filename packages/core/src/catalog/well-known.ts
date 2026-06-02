import { sha256Hex } from "../hashing/hash.js";
import { GameObjectTypeId, makeGameObjectTypeId, type Uuid } from "../ids.js";

/**
 * Stable namespace used to derive deterministic catalog type ids from a short
 * human key (e.g. "spawn-point"). Both engine-neutral built-in types and
 * plugin-shipped catalog content derive their ids through this single helper so
 * that a given key always resolves to the same `gobj:<uuid>` across the engine,
 * plugins, and the legacy `MapObject.kind` load migration — without any package
 * importing another's literals.
 */
const NAMESPACE = "tileborne:catalog:game-object-type";

/**
 * Derive a deterministic, worker-safe UUID (version 8, RFC-variant) from a key.
 * Uses the pure in-repo SHA-256 so it runs in runtime/game-host workers with no
 * `node:crypto` dependency.
 */
const deterministicUuid = (key: string): Uuid => {
  const hex = sha256Hex(`${NAMESPACE}:${key}`);
  const part = hex.slice(0, 30);
  const uuid =
    `${part.slice(0, 8)}-${part.slice(8, 12)}-8${part.slice(12, 15)}` +
    `-8${part.slice(15, 18)}-${part.slice(18, 30)}`;
  return uuid as Uuid;
};

const GOBJ_ID_PATTERN =
  /^gobj:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve the canonical {@link GameObjectTypeId} for a short, stable key.
 * Deterministic and collision-resistant; the SSOT mapping from a named object
 * kind to its branded catalog id. Idempotent: a value that is already a catalog
 * id is returned unchanged, so callers may pass either a key or a resolved id.
 */
export const gameObjectTypeIdForKey = (key: string): GameObjectTypeId => {
  if (GOBJ_ID_PATTERN.test(key)) {
    return key as GameObjectTypeId;
  }
  return makeGameObjectTypeId(deterministicUuid(key));
};

/**
 * Engine-neutral built-in object-type keys. These are render/editor primitives
 * (a placed sprite, a Tiled-imported generic object, an editor trigger region)
 * that are part of the shared engine, NOT any game mode. Plugin/game-mode kinds
 * (spawn points, loot, hazards, …) are owned by the plugins that ship them.
 */
export const ENGINE_GAME_OBJECT_TYPE_KEYS = {
  /** A sprite/placeable placed on the map via a `visual-ref` binding. */
  placeable: "placeable",
  /** A generic placed object (e.g. imported from a Tiled object layer). */
  object: "object",
  /** An editor-authored rectangular trigger region. */
  triggerRegion: "trigger-region",
} as const;

/** Built-in engine-neutral catalog type id for placed sprite/placeable objects. */
export const PLACEABLE_OBJECT_TYPE_ID = gameObjectTypeIdForKey(
  ENGINE_GAME_OBJECT_TYPE_KEYS.placeable,
);

/** Built-in engine-neutral catalog type id for generic placed objects. */
export const GENERIC_OBJECT_TYPE_ID = gameObjectTypeIdForKey(ENGINE_GAME_OBJECT_TYPE_KEYS.object);

/** Built-in engine-neutral catalog type id for editor trigger regions. */
export const TRIGGER_REGION_OBJECT_TYPE_ID = gameObjectTypeIdForKey(
  ENGINE_GAME_OBJECT_TYPE_KEYS.triggerRegion,
);

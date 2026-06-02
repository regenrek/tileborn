import { gameObjectTypeIdForKey } from "@tileborne/core";

/**
 * Human-readable object-kind keys (stable across persistence / Tiled / palette
 * brushes). These are the keys the catalog derives type ids from.
 */
export const SPAWN_POINT_KEY = "spawn-point";
export const SHRINK_ZONE_ANCHOR_KEY = "shrink-zone-anchor";
export const LOOT_CRATE_KEY = "loot-crate";

/**
 * Catalog {@link GameObjectTypeId}s for BR's object types. `MapObject.kind`
 * stores these ids (ADR-0019), so all runtime/authoring comparisons key on them
 * while user-facing copy uses the `*_KEY` strings above.
 */
export const SPAWN_POINT_KIND = gameObjectTypeIdForKey(SPAWN_POINT_KEY);
export const SHRINK_ZONE_ANCHOR_KIND = gameObjectTypeIdForKey(SHRINK_ZONE_ANCHOR_KEY);
export const LOOT_CRATE_KIND = gameObjectTypeIdForKey(LOOT_CRATE_KEY);

export const MIN_SPAWN_POINTS = 4;
export const REQUIRED_SHRINK_ANCHORS = 1;
export const MIN_LOOT_CRATES = 1;

export const DEFAULT_LOOT_TABLE: readonly {
  readonly itemKind: string;
  readonly tier: string;
  readonly weight: number;
}[] = [
  { itemKind: "health-pack", tier: "common", weight: 40 },
  { itemKind: "ammo-box", tier: "common", weight: 35 },
  { itemKind: "armor-vest", tier: "rare", weight: 15 },
  { itemKind: "weapon-crate", tier: "epic", weight: 10 },
];

export const LOOT_PICKUP_RADIUS = 1.5;

export const PLUGIN_ID = "@tileborne-plugins/battle-royale" as const;

/** Default player cap from declarative room-rules panel (`panels/index.json`). */
export const DEFAULT_MAX_PLAYERS = 32;

/** Canonical gameplay defaults grouped by runtime system. */
export const MOVEMENT = {
  /** Playtest movement speed in world units per second. */
  speed: 120,
  /** Circle collision radius for player movement resolution. */
  radius: 12,
  /** Vertical offset from entity origin to collision circle center. */
  footprintOffsetY: 0,
  /** Canonical playtest simulation tick rate (Hz). */
  tickRate: 20,
} as const;

export const ZONE = {
  /** Interval between shrink phases in exported artifact metadata (ms). */
  shrinkIntervalMs: 30_000,
  /** Damage per second applied outside the safe zone at init. */
  damagePerSecond: 5,
  schedule: {
    /** Initial wait before first shrink (seconds). */
    waitSec: 60,
    /** Duration of each shrink animation (seconds). */
    shrinkSec: 30,
    /** Hold time after shrink completes (seconds). */
    holdSec: 30,
    /** Number of shrink phases after initial wait. */
    shrinkPhases: 3,
    /** Multiplier applied to radius at each shrink phase. */
    radiusFactor: 0.5,
  },
} as const;

export const PROJECTILE = {
  /** Travel speed in world units per second. */
  speed: 400,
  /** Damage applied on player hit. */
  damage: 25,
  /** Lifetime in simulation ticks (~2s at 20Hz). */
  ttlTicks: 40,
  /** Minimum ticks between shots per player (~5 shots/sec at 20Hz). */
  shootCooldownTicks: 8,
  /** Circle collision radius for hit tests. */
  radius: 4,
  /** Numbered weapon slots accepted by runtime input; clients send 1..N. */
  weaponSlotCount: 3,
} as const;

export const DAMAGE = {
  /** Starting health for spawned and respawned players. */
  playerHealth: 100,
} as const;

export const RESPAWN = {
  /** Delay before respawn when room rules enable respawn (5 seconds at 20Hz). */
  delayTicks: 5 * MOVEMENT.tickRate,
} as const;

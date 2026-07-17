/**
 * `@tileborne/simulation` — neutral, deterministic combat simulation (ADR-0018).
 *
 * Slice 1: the foundational neutral boundary — branded combat ids, a neutral
 * health/vitality pool + pure damage resolution, an injected hit-resolution
 * policy (open team/hostility, no closed mode enum), and the deterministic
 * RNG / time / world ports.
 *
 * Slice 2: the neutral weapon firing runtime — a `WeaponDefinition` schema and a
 * deterministic cooldown / ammo / magazine / reload tick state machine
 * (`fireWeapon` / `advanceWeaponTick` / `beginReload`) producing neutral outcome
 * values.
 *
 * Slice 3: the neutral `DamageDelivery` tagged-union (hitscan / beam / projectile
 * / pellet / charge / bounce / pierce / explosive / melee) + resolvers that turn
 * a fired delivery into concrete hits via Slice 1's `resolveDamage` /
 * `HitResolutionPolicy`, with neutral 2D geometry, distance falloff, catalog-fed
 * line-of-sight / projectile blocking, and knockback impulse outputs. Spread
 * sampling consumes the injected `SeededRng` — the slice where RNG enters.
 *
 * Slice 4: the neutral combat **result-value set** (`WeaponFired` / `DamageApplied`
 * / `EntityDefeated` / projectile lifecycle `ProjectileSpawned` / `ProjectileMoved`
 * / `ProjectileExpired` / the `StatusApplied` P0 hook) and the deterministic
 * `runCombatTick` orchestrator over `CombatWorldView`. It wires weapon firing
 * (Slice 2) → delivery resolution (Slice 3) → damage application (Slice 1) for a
 * single fixed tick, carrying weapon firing state + in-flight projectiles forward
 * in a returned `CombatTickState`; a fixed seed + input log replays bit-identically.
 *
 * Inventory/loot addendum, Slice 1 (M3): the neutral inventory/loot module —
 * `InventoryState` (open item ids, capacity-bounded, explicit overflow policy),
 * `AmmoReserve` ammo stacks (feeding the weapon runtime's reload reserve read),
 * the `RuntimeLootTable`/`RuntimeLootTableEntry` runtime input shape (keyed by
 * the catalog's `LootTableId`), the seeded `rollLootTable` weighted roll, deterministic
 * `resolvePickupCandidates`, and the neutral inventory result-value set
 * (`ItemGranted` / `ItemDropped` / `ItemConsumed` / `PickupSpawned` /
 * `InventoryRejected`). The BR system drives these since M3 S4; host wiring
 * beyond the plugin-mediated tick is later scope.
 *
 * Inventory/loot addendum, Slice 2 (M3): grant application + authoritative
 * ops — `applyGrantRef` interprets the catalog's typed `item-grant` /
 * `weapon-grant` refs (the runtime half of ADR-0023 §C) against
 * inventory + ammo reserve (item grants store per resolved quantity, ammo
 * routes into the reserve as `AmmoGranted`, weapon grants emit
 * `WeaponGranted` for the caller's weapon system — the simulation never
 * re-owns weapon state); `resolveInventoryCommands` consumes the sequenced
 * neutral command union (`PickupCommand` / `DropCommand` / `ConsumeCommand`
 * / `EquipCommand` / `SwapCommand`) deterministically (sorted by actor →
 * sequence, stale/duplicate sequences skipped) against per-actor
 * inventory + `EquipmentState` (open slot ids); and `dropOnDefeat` empties a
 * defeated inventory into `PickupSpawned` values plus one caller-resolved
 * drop-table roll.
 *
 * This package is React-free, Electron-free, Node-free, Pixi-free and
 * worker-safe; it depends only on `@tileborne/core` and never on
 * `@tileborne/runtime` or any plugin. It owns combat *algorithms + schemas*,
 * never balance *numbers* or game-mode rules — those are plugin data.
 */

export * from './ids.js';
export * from './health.js';
export * from './hit-policy.js';
export * from './damage.js';
export * from './rng.js';
export * from './clock.js';
export * from './world.js';
export * from './weapon.js';
export * from './geometry.js';
export * from './broadphase.js';
export * from './falloff.js';
export * from './delivery.js';
export * from './status.js';
export * from './projectile.js';
export * from './combat.js';
export * from './inventory.js';
export * from './ammo.js';
export * from './loot.js';
export * from './grants.js';
export * from './inventory-ops.js';

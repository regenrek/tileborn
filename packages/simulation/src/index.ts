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
export * from './falloff.js';
export * from './delivery.js';

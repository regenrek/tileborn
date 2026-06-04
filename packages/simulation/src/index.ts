/**
 * `@tileborne/simulation` — neutral, deterministic combat simulation (ADR-0018).
 *
 * Slice 1: the foundational neutral boundary — branded combat ids, a neutral
 * health/vitality pool + pure damage resolution, an injected hit-resolution
 * policy (open team/hostility, no closed mode enum), and the deterministic
 * RNG / time / world ports the later slices (weapon firing, delivery families,
 * tick orchestrator) build on.
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

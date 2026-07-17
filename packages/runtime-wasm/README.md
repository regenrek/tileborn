# `@tileborne/runtime-wasm`

TypeScript fallback implementations and a Rust/wasm scaffold for runtime simulation backends:

- **Pathfinding** — deterministic grid A\* (`src/pathfinding/astar.ts`)
- **Broadphase** — sweep-and-prune AABB pairs (`src/broadphase/sweep-prune.ts`)
- **Procgen** — xoshiro256\*\* seeded RNG (`src/procgen/rng.ts`)
- **Simulation** — TypeScript tick backend (`src/simulation/sim.ts`; use `selectSimulationBackend()`)

Select backends via `selectBackend(kind)`; defaults to TS. Set `TILEBORNE_RT_BACKEND=wasm` once the Rust crates under `crates/` export wasm-bindgen bindings.

See `docs/03-runtime-game-host.md` §16 (strict determinism / wasm plug-in) for architecture context.

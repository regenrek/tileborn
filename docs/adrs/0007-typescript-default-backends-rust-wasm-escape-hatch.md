# ADR-0007: TypeScript default backends with Rust/WASM escape hatch

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: runtime, wasm, rust, performance

## Context

Simulation helpers (pathfinding, broadphase, procedural generation, deterministic sim steps) may need native performance. Architecture invariant #8 keeps Rust/WASM optional behind interfaces; TypeScript remains the default. `@tileborne/runtime-wasm` is a stub package with backend interfaces consumed by Effect services in main/runtime.

Migration plan Phase 7 adds WASM backends with TS fallback parity tests—not v1 blockers.

## Decision

All performance-sensitive backends are defined as **TypeScript interfaces** (`PathfindingBackend`, `BroadphaseBackend`, `ProcgenBackend`, `SimulationBackend`) with **pure TypeScript implementations as default**. Rust/WASM implementations in `@tileborne/runtime-wasm` are opt-in via configuration; callers use Effect services and never import WASM directly from renderer code. Main process may load native/WASM modules for CLI and heavy jobs.

## Options considered

- **A — Rust/WASM required for v1 sim**: Better perf early; blocks OSS contributors without Rust toolchain.
- **B — Native Node addons**: Platform-specific binaries; poor fit for Cloudflare Workers and browser runtime.
- **C (chosen) — TS default + WASM escape hatch behind interfaces**: Ships v1 on TS; upgrade path for hot paths with benchmark-gated WASM swaps.

## Consequences

- Positive: Single interface contract for editor, CLI, runtime, and Workers (where WASM is supported).
- Positive: Parity tests ensure TS fallback correctness when WASM is enabled.
- Negative: Initial sim/procgen may be slower until Phase 7 backends land.
- Follow-up: Benchmark suite and feature flags for backend selection; document in runtime SDK docs.

## References

- `docs/01-spec.md` §3 (`@tileborne/runtime-wasm`), §15 Phase 7
- Related: [ADR-0006](./0006-runtime-renderer-abstraction-pixi-default.md), [ADR-0003](./0003-electron-process-boundary-rules.md)

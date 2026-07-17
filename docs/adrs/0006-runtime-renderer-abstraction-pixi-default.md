# ADR-0006: Runtime renderer abstraction and Pixi default

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: runtime, rendering, pixi, architecture

## Context

`@tileborne/runtime` must serve the editor viewport, local playtest, and browser game client. Architecture invariant #9 requires a renderer-agnostic SDK with Pixi as the default 2D adapter. The editor and game-host specs both split React chrome from canvas rendering: React owns HUD/menus; the renderer adapter owns draw calls.

Phaser (Petwars legacy) is not carried forward; Pixi + `@pixi/tilemap` matches the tilemap editor and runtime needs.

## Decision

The runtime exposes a **`RendererAdapter` interface**; the default implementation is **`PixiRendererAdapter`** under `packages/runtime/src/renderer/pixi/`. Game systems and the ECS world emit normalized draw instructions; Pixi maps them to WebGL2 (see ADR-0010). Alternative adapters (e.g. Canvas2D, future WebGPU) plug in without changing ECS or networking code.

## Options considered

- **A — Phaser as core renderer**: Familiar from Petwars; heavier coupling of scene graph, physics, and game loop.
- **B — Raw WebGL/WebGPU in runtime**: Maximum control; high maintenance for editor tooling and tilemaps.
- **C (chosen) — RendererAdapter + Pixi default**: Matches spec §11 viewport layers; `@pixi/tilemap` for chunked tilemaps; React stays outside the render loop.

## Consequences

- Positive: Editor viewport and game client share tilemap/camera/sprite abstractions.
- Positive: Runtime SDK stays usable for non-Pixi experiments via adapter swap.
- Negative: Team maintains Pixi version upgrades and tilemap chunk invalidation logic.
- Follow-up: Pixi renderer smoke tests in Phase 3/5 per migration plan.

## References

- `docs/01-spec.md` §3 (`@tileborne/runtime`), §11 (Pixi viewport architecture), §13 (runtime SDK)
- `docs/03-runtime-game-host.md` §3–§4 (React/Pixi/ECS boundaries)
- `docs/02-editor-ux.md` §6 (center viewport)
- Related: [ADR-0010](./0010-webgpu-postponed-webgl2-default.md)

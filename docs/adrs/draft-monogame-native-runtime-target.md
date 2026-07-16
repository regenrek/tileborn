# ADR-DRAFT: MonoGame native runtime target (Switch/iOS shipping)

- Status: Draft (Proposed — number TBD, candidate ADR-0023+)
- Date: 2026-06-02
- Deciders: Tileborne core team
- Tags: runtime, rendering, monogame, native, console, ios, switch, architecture
- Related: [ADR-0006](./0006-runtime-renderer-abstraction-pixi-default.md), [ADR-0007](./0007-typescript-default-backends-rust-wasm-escape-hatch.md), [ADR-0010](./0010-webgpu-postponed-webgl2-default.md), [ADR-0014](./0014-runtime-rendering-via-plugin-projector.md)

> ROUGH DRAFT. Captures scope/effort for adopting MonoGame. Not yet a commitment.

## Context

The current runtime renders via `PixiRendererAdapter` (WebGL2, ADR-0006/0010) inside the Electron renderer. We want to ship the **game** (not the editor) to platforms the web stack cannot reach — notably **Nintendo Switch and iOS** — using a proven 2D engine. MonoGame is the natural fit: Celeste, Stardew Valley, and Carrion are 2D MonoGame titles, and it has first-class Switch/iOS/desktop targets.

Key constraint: **MonoGame is .NET/C# and renders to a native window (OpenGL/DirectX/Vulkan). It cannot run inside Electron or a browser.** Therefore this is not a `RendererAdapter` swap — it is a **second, native runtime target** that consumes the same authored content. Electron/web cannot reach Switch, so the game's shipping runtime must leave the web stack.

### What is and isn't coupled to Pixi today

- **Cleanly abstracted (runtime):** `packages/runtime/src/renderer/renderer-adapter.ts` defines `RendererAdapter` (`mount` / `loadAssets` / `renderFrame` / `dispose`). `PixiRendererAdapter` (~487 lines) is the only implementation. The rest of the runtime — `ecs/`, `simulation/`, `input/`, `collision/`, `loop/`, `net/`, `clock/` — is renderer-agnostic.
- **NOT abstracted (editor):** ~3,500 lines under `apps/desktop/src/renderer/` use Pixi primitives directly (`editor-viewport-controller.ts` 1,134 lines / 48 Pixi symbols, `map-editor-viewport.tsx`, `playtest-viewport.tsx`, `playtest-multiplayer-viewport.tsx`, sprite studio, working palette).

## Decision (proposed)

Do **not** "replace PixiJS." Instead:

1. **Keep Electron + React + Pixi for the editor and local playtest.** The editor is UI-heavy authoring; React/Electron remains the right tool. Pixi stays the default web renderer per ADR-0006.
2. **Build a separate `@tileborne/runtime-native` MonoGame player** (C#/.NET) that loads the editor's exported content bundles and ships to Desktop → iOS → Switch.
3. **Promote the content/wire contract to a versioned, language-neutral artifact** consumed by both the TS runtime and the C# runtime. This contract is the central deliverable; the renderer is downstream of it.

The existing renderer-agnostic boundary (`RendererAdapter`, ECS, fixed-step loop) is the porting seam.

## Existing contracts the C# runtime must consume

These already exist and are largely serialization-friendly (Effect Schema + msgpack):

- **Map:** `TileborneMap` (`packages/core/src/map/index.ts`) — `{ id, schemaVersion: 1, size, tileSize, layers[], objects[], properties }`. JSON-serializable. Schema versioning is ADR-0008.
- **Assets:** `AssetPackManifest` — `assets[]` of `{ id, path, mime, size, hash, license }` (`runtime-asset-manifest.ts`).
- **ECS components:** explicit numeric field types ready for C# structs — `Position/Velocity {x,y: f32}`, `Health {current,max: i32}`, `Transform {f32...}`, `Renderable {assetId: u32, layerIndex: u8}` (`ecs/components.ts`).
- **Loop:** fixed-step, `tickRate` default 60, `snapshotHz` 20 (`loop/game-loop.ts`).
- **Net:** msgpack wire, `PROTOCOL_VERSION = 1` (`net/protocol.ts`, deprecated for hot path) and the Battle-Royale hot-path protocol projected to `RenderableEntity` per ADR-0014.

## Scope: what the MonoGame runtime re-implements in C#

1. **Content loader** — read map + asset manifest bundle (decode msgpack/JSON; verify hashes).
2. **Renderer** — `SpriteBatch`-based sprites + tilemap (Pixi `CompositeTilemap` → batched tile draw), layer z-ordering, camera, animation clip timelines (port `clip-timeline.ts` / `interpolate-entities.ts`).
3. **ECS + simulation playback** — port `ecs/`, `simulation/`, `collision/`, `input/`, `loop/`. Must match TS determinism for parity (`runtime/parity`).
4. **Netcode** — client-side of the snapshot/input protocol if multiplayer must work on native (high risk; see below).
5. **Content pipeline** — MGCB for textures/atlases, or load runtime bundles directly.
6. **Per-platform shells** — DesktopGL, iOS, Switch projects.

The ~3,500 lines of **editor** Pixi code are **out of scope** — they stay in Electron.

## Options considered

- **A — Full rewrite of editor + runtime in MonoGame/C#.** Rejected: throws away the React/Electron editor; MonoGame is poor at dense authoring UI.
- **B (proposed) — Dual runtime: keep TS/Pixi editor, add native C# player sharing a content contract.** Editor velocity preserved; native target reaches Switch/iOS; clear seam.
- **C — Stay web-only, pick a different web renderer (Three.js/Babylon/WebGPU) behind `RendererAdapter`.** Cheapest; keeps one codebase — but **cannot ship to Switch/iOS**, so it does not meet the stated goal.

## Rough phasing

- **Phase 0 — Contract freeze.** Define `runtime-bundle/v1` (map + assets + manifest) as the language-neutral export. Add a TS exporter and golden fixtures. _Small–medium; mostly exists._
- **Phase 1 — C# project + content loader.** New `runtime-native` .NET solution; load a bundle; render one static tilemap on DesktopGL. _Medium._
- **Phase 2 — Renderer parity.** Sprites, layers, camera, animation clips matching Pixi output on a reference map. _Medium–large._
- **Phase 3 — Simulation/ECS port + determinism parity.** Port logic; reuse parity fixtures to assert TS↔C# match. _Large._
- **Phase 4 — Netcode (optional).** Native client of the snapshot/input protocol. _Large, risky — defer if single-player-first is acceptable._
- **Phase 5 — iOS target.** Apple developer account; touch input mapping. _Medium + external account._
- **Phase 6 — Switch target.** **Blocked on registered Nintendo devkit + NDA** — external, non-code dependency, gated approval. _Unknown lead time._

## Consequences

- Positive: Reaches Switch/iOS/console with a battle-tested 2D engine; editor unaffected.
- Positive: Forces a clean, versioned content contract (good hygiene regardless of MonoGame).
- Negative: **Two runtimes to keep in sync** — every gameplay/sim/render change risks TS↔C# drift; needs shared golden/parity fixtures as the guardrail.
- Negative: Second language + toolchain (.NET SDK, MGCB) and second CI matrix.
- Negative: Switch is gated behind Nintendo licensing; cannot be unblocked by engineering alone.
- Effort: **multi-month** for a single-player native target; longer with multiplayer parity.

## Open questions

1. Single-player native first (defer Phase 4 netcode), or is multiplayer-on-native a hard requirement?
2. Is there already a serialized map/asset _export_ path, or do maps only exist in-editor (defines Phase 0 size)?
3. Do plugins (e.g. Battle Royale, ADR-0014) need to run on native? If so, plugin logic must also be portable C# — a major scope expansion.
4. C# struct-of-arrays ECS vs. an existing C# ECS lib (e.g. Arch) — buy vs. build.
5. Does the editor need a "preview as it will look on native" mode, or is fixture-based parity testing sufficient?

## References

- `packages/runtime/src/renderer/renderer-adapter.ts` (the porting seam)
- `packages/runtime/src/renderer/pixi/pixi-renderer-adapter.ts` (reference implementation)
- `packages/core/src/map/index.ts` (`TileborneMap` contract)
- `packages/runtime/src/{ecs,simulation,collision,input,loop,net,clock,parity}/`
- ADR-0006 (renderer abstraction), ADR-0007 (non-TS escape hatch), ADR-0010 (WebGL2 default), ADR-0014 (plugin projector → RenderableEntity)

# Technical Architecture

## Components

- `packages/core`: explicit coordinate conversion primitives and durable contracts.
- `packages/services-build`: sole authoring-pixel to runtime-tile package conversion.
- `packages/runtime`: input sampling, fixed-step client driver, prediction and reconciliation.
- `packages/plugin-battle-royale`: action-to-intent, safe spawn policy, combat and event semantics.
- `apps/desktop` and `apps/game-client`: DOM capture, shell pointer routing, lifecycle wiring.
- `PixiRendererAdapter`: draw-only adapter with automatic ticker disabled.

## Data Flow

`DOM input -> InputResolver -> neutral actions -> BR intent -> local prediction ->
authoritative runtime -> gameplay events/snapshots -> reconcile local + interpolate remote -> Pixi`.

`TileborneMap(pixel objects) -> services-build conversion -> RuntimeMapPackage(tile placements)
-> BR systems and projector`.

## Failure Modes

- Double conversion or renderer heuristics reintroduce coordinate drift.
- Pointer-owning overlays bypass viewport capture.
- Separate desktop and shipped-client loops diverge on pause or prediction.
- Input-driven audio lies when cooldown, ammo, or authority rejects a shot.
- Project navigation loses the session id before stop completes.

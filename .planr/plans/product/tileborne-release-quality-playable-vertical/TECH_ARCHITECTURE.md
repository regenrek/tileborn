# Technical Architecture

## Components

- `@tileborne/core`: coordinate, visual-size, input-action, HUD, and gameplay-event contracts.
- `@tileborne/services-build`: sole authoring-pixel to runtime-tile package conversion.
- `@tileborne/runtime`: fixed-step loop, input sampling, prediction, reconciliation, scheduling.
- `@tileborne/plugin-api`: game-mode/capability and declarative contribution contracts.
- `@tileborne/plugin-battle-royale`: safe spawn policy, BR rules/tuning, action-to-intent,
  combat semantics, projector, authored visual configuration, HUD derivation, and shell content.
- `@tileborne/game-client`: neutral menu/HUD chassis and accessible interaction surfaces.
- `apps/desktop`: Electron capture, IPC/session lifecycle, editor integration, and live playtest host.
- `PixiRendererAdapter`: draw-only adapter; no simulation, spawn, or gameplay policy.

## Data Flow

`generated tile cells -> authored pixel MapObject -> services-build conversion once ->
runtime tile positions -> BR systems/projector -> explicit visual normalization -> Pixi`.

`DOM/device input -> InputResolver -> neutral actions -> BR intent -> prediction ->
authoritative simulation -> gameplay events/snapshots -> reconciliation/interpolation -> feedback`.

`plugin manifest -> plugin discovery -> GameModeDescriptor.rendererCapabilityId ->
map route -> viewport mount`; no stale or fallback owner may silently replace this path.

## Failure Modes

- Double/missing coordinate conversion creates clustered or out-of-bounds scenes.
- Natural texture pixels are treated as world units, producing oversized sprites/props.
- Spawn safety validates only spawn-to-spawn distance and ignores hazards/collision/loot footprints.
- Renderer capability is present in manifest but lost through discovery/cache/selection.
- Shell navigation conflates match phase with playtest-session ownership.
- Input-triggered effects lie when authority rejects shots or damage.
- Desktop-specific fixes diverge from the shipped browser client.

## Ownership Guardrails

- Extend the existing playable-controls and coordinate plans; do not create a second loop,
  projector, input mapper, coordinate heuristic, or desktop-only BR implementation.
- Safe spawn and combat tuning are BR-plugin policy; neutral contracts stay in core/plugin-api.
- Visual normalization belongs to the projector/visual contract boundary, not ad hoc canvas scaling.
- Match/lobby semantics belong to the game-shell application workflow; Electron owns only session plumbing.

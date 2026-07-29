---
name: playable-controls-and-runtime-responsiveness-playable-controls-runtime
overview: "Build plan for Playable Controls and Runtime Responsiveness - Playable controls runtime."
todos:
  - id: coordinate-lifecycle
    content: "Establish one coordinate and playtest lifecycle contract"
    status: pending
  - id: pointer-weapons
    content: "Deliver pointer aim crosshair and authoritative weapon feedback"
    status: pending
  - id: local-prediction
    content: "Make local movement immediately responsive through prediction and reconciliation"
    status: pending
  - id: live-proof
    content: "Prove the complete flow in tests Electron and Browser"
    status: pending
isProject: false
stage: build
source_plan: pln-d4221d92
slice: "Playable controls runtime"
---

# Playable Controls and Runtime Responsiveness - Playable controls runtime

## Scope Decision

Implement one playable-controls vertical slice without replacing PixiJS. Correct
the authoring/runtime coordinate boundary and playtest lifecycle first, then make
pointer/weapon input truthful, then add local-only prediction while preserving
remote interpolation and server authority, and finally close live evidence.

This plan supersedes the generator-only coordinate plan `pln-bada5951`, whose
pixel placement change is retained only when paired with the canonical
services-build pixel-to-tile package conversion.

## Ownership Target

- `packages/core`: explicit conversion helpers/contracts for authoring pixels and runtime tiles.
- `packages/services-build`: sole conversion during `RuntimeMapPackage` assembly.
- `packages/runtime`: neutral input sampling and local prediction/reconciliation primitives.
- `packages/plugin-battle-royale`: BR intent, safe spawn, weapon/event semantics.
- `apps/desktop` and browser game client: capture, shell pointer routing, lifecycle wiring.
- Pixi remains a draw adapter with no gameplay-loop policy.

## Existing Leverage

Reuse the generated-map pixel placement work and tests, ADR-0030 tile-space
runtime package contract, `GameLoop`, `InputResolver`, snapshot sequence/timestamp
data, `SnapshotEntityStore`, plugin gameplay event stream, HUD registry, Playwright
Electron smoke fixtures, and existing localhost game-client build.

## Phase 1 - Coordinate and lifecycle

- [ ] Add one tested map-pixel to runtime-tile conversion at package assembly.
- [ ] Remove contradictory direct pixel consumption and update generator/package regressions.
- [ ] Freeze gameplay before Start Match and during local pause.
- [ ] Bind sessions to project/map ownership and stop them on navigation/explicit stop.

## Phase 2 - Pointer and weapons

- [ ] Make the in-match shell pointer-transparent except interactive controls.
- [ ] Coalesce pointer aim and emit it continuously; left click fires toward the cursor.
- [ ] Add a centered pointer-transparent crosshair.
- [ ] Drive fire audio/VFX from accepted gameplay events and align cadence documentation.

## Phase 3 - Local responsiveness

- [ ] Add reusable local transform prediction and input-sequence reconciliation in runtime.
- [ ] Apply it to desktop and browser clients while retaining remote 100 ms interpolation.
- [ ] Keep server validation and authoritative movement/combat unchanged.

## Phase 4 - Proof and review

- [ ] Run focused tests/typechecks and changed-scope React Doctor.
- [ ] Live-test generated map, movement, mouse aim/fire, reload, pause, stop, and project switch in Electron.
- [ ] Verify the localhost browser client with Browser and leave no running session.
- [ ] Close independent review and Planr audit with replayable evidence.

## Out Of Scope

No Phaser or renderer replacement, broad visual redesign, new weapon families,
new multiplayer topology, production deployment, release publication, or unrelated
macOS signing/release review work.

## Verification

- Focused tests for core coordinate helpers, services-build package assembly,
  runtime prediction, BR input/combat/events, desktop capture/shell/lifecycle.
- Relevant package typechecks and lint/format checks.
- `npx react-doctor@latest --verbose --scope changed` with no regression.
- Native Electron mouse/keyboard flow through the real hit-testing surface.
- Browser plugin flow against the localhost game client.
- Runtime session list confirms zero `Running` sessions after cleanup.

## Acceptance Criteria

- Fresh generated objects are distributed in editor pixels and converted once to
  runtime tiles; zone, spawn, collision, and projectiles agree.
- HP and ticks remain frozen before Start Match and during local pause.
- Stop and project switch terminate the exact owned session.
- Native pointer changes aim, left click creates an aimed projectile, and the
  crosshair/accepted fire feedback agree.
- Local motion is presented within one display frame and reconciles without a
  visible normal-latency snap; remote entities retain buffered interpolation.
- Automated tests, Electron oracle, Browser oracle, independent review, and Planr audit hold.

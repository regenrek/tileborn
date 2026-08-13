# Playable Controls and Runtime Responsiveness

## Summary

Make a freshly generated Battle Royale project immediately playable and
responsive in the Electron editor and shipped browser client while retaining
PixiJS as the default renderer.

## Goals

- Establish one explicit authoring-pixel to runtime-tile coordinate boundary.
- Make match lifecycle, pause, project switching, and session cleanup reliable.
- Deliver real mouse aim, click-to-fire, crosshair, and event-backed weapon feedback.
- Render local movement immediately through prediction and reconcile it to authority.
- Prove the same controls and runtime behavior in Electron and the browser client.

## Non-Goals

- Replacing PixiJS or adopting Phaser.
- Broad visual redesign, new weapon families, deployment, or release publication.
- Changing remote-player interpolation solely to mask local-player latency.

## Assumptions

- Persisted editor `MapObject` positions are world pixels.
- `RuntimeMapPackage` placements are tile units as accepted by ADR-0030.
- Server authority remains fixed-step; prediction affects local presentation only.


## Refinement 2026-07-28T15:36:55.945644Z

One coherent goal: make a freshly generated Battle Royale project immediately playable and responsive in Electron and the shipped browser client without replacing PixiJS. Preserve the accepted renderer boundary: packages/runtime owns neutral fixed-step client loop, input sampling, local-player prediction and reconciliation; packages/core owns explicit pixel-versus-tile coordinate types and conversion contracts; services-build owns the one authoring-pixels to runtime-tile conversion; plugin-battle-royale owns action-to-intent, match rules, safe spawn policy, weapon cadence and gameplay-event mapping; apps/desktop and game-client own DOM capture, shell pointer routing, presentation and platform lifecycle only. Hard-cut generator-only coordinate fixes, renderer heuristics, duplicate loops and input-triggered weapon feedback. Required behavior: generated maps render distributed in editor and runtime; zone, spawn, collision and projectile systems share tile units; simulation and player damage do not begin before Start Match; project change and stop terminate the owned playtest; local single-player pause freezes ticks; in-match shell passes pointer events through except interactive controls; pointer aim emits coalesced updates and left click fires toward the cursor; local player input renders within one frame using prediction while remote entities retain approximately 100 ms interpolation; authoritative snapshots reconcile without visible snapping under normal local latency; weapon audio and VFX originate from actual gameplay events; BR HUD includes a centered crosshair; weapon cadence comment and behavior agree. Preserve unrelated dirty worktree changes. Verification: focused core, services-build, runtime, battle-royale and desktop tests; native Electron mouse and keyboard playtest; Browser verification against the localhost game client; project switch and stale-session check; pause tick check; generated-map coordinate and zone check; React Doctor changed-scope no regression. Out of scope: replacing PixiJS, adding Phaser, broad visual redesign, new weapon families, production deployment or release work.

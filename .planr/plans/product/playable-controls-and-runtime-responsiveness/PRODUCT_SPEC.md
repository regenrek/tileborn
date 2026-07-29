# Product Specification

## Problem

Generated maps look distributed in the editor but feed pixel positions into a
runtime contract that expects tile units. Players consequently spawn outside the
zone or visuals collapse when old tile-like values reach the renderer. The match
also simulates before deployment, sessions can survive project changes, the
in-match shell blocks canvas pointer events, pointer motion does not emit aim,
and the local player is delayed by the same interpolation buffer as remote state.

## Users

- Creators validating a newly generated top-down or Battle Royale game.
- Players using keyboard and mouse in Electron or the browser build.
- Plugin authors relying on neutral runtime, input, and map-package contracts.

## Requirements

- A newly generated map must preserve distributed pixel-space authoring objects
  and produce tile-space runtime placements exactly once during package assembly.
- Gameplay damage and simulation must begin only after Start Match; local pause
  freezes simulation; stop and project change leave no running session.
- The viewport receives pointer events during play, pointer aim is coalesced and
  emitted continuously, and left click fires toward the cursor.
- Local input is predicted within one display frame and reconciled to authoritative
  snapshots while remote entities keep buffered interpolation.
- Fire audio and visual feedback are driven by actual gameplay events, not raw
  button transitions. A centered crosshair communicates aim.
- Pixi remains a renderer adapter and never becomes the gameplay-loop owner.

## Success Criteria

- A fresh BR project completes title, lobby, movement, aim, three shots, reload,
  pause/resume, results, stop, and project-switch flows without premature death.
- Native Electron mouse movement changes outgoing aim and click creates a projectile.
- Measured local input-to-visible-motion is under one display frame in local play.
- No active playtest session remains after stop or project switch.
- Focused tests, changed-scope React Doctor, Electron live proof, Browser proof,
  independent review, and Planr audit all hold.

---
name: tileborne-release-quality-playable-vertical-fair-readable-match-start
overview: "Build plan for Tileborne release-quality playable vertical - Fair readable match start."
todos:
  - id: capability
    content: "Resolve the active renderer capability before viewport mount"
    status: pending
  - id: spawn-safety
    content: "Enforce spawn clearance from hazards, collision, and participants"
    status: pending
  - id: visual-scale
    content: "Apply one runtime-to-visual world scale and readable opening composition"
    status: pending
  - id: live-proof
    content: "Prove five clean opening runs in Electron"
    status: pending
isProject: false
stage: build
source_plan: pln-a1dec95e
slice: "Fair readable match start"
---

# Tileborne release-quality playable vertical - Fair readable match start

## Scope Decision

Fix only the first playable-state boundary exposed by the 2026-08-01 critic pass:
the active Battle Royale renderer capability must resolve before mount, every
participant must enter at a fair spawn, and the first rendered frame must use a
coherent world/visual scale. This slice ends once a player can stand, see, and
begin controlling the game without involuntary damage or scene overlap.

Extend the canonical work in `pln-d4221d92` and `pln-e4db0624`; do not reopen
their solved generator conversion or create parallel input/runtime implementations.

## Ownership Target

- `@tileborne/plugin-api` plus desktop plugin discovery/selection: preserve the
  manifest-declared `rendererCapabilityId` through one descriptor path.
- `@tileborne/plugin-battle-royale`: own spawn safety against hazards, collision,
  opponents, and authored object footprints; own BR projector visual descriptors.
- `@tileborne/core` / `@tileborne/services-build`: retain the existing single
  authoring-pixel to runtime-tile contract; change only if a proven contract defect remains.
- Desktop renderer: block mount on unresolved capability and apply camera projection once.
- Pixi adapter: draw normalized entities only; no gameplay or safety policy.

## Existing Leverage

- Product plan `pln-a1dec95e` and live critic evidence from 2026-08-01.
- Controls/runtime plan `pln-d4221d92` and build plan `pln-d3d9761b`.
- Generated-coordinate plan `pln-e4db0624` and build plan `pln-bada5951`.
- `generate-map.ts`, `authoringPixelToRuntimeTile`, `spawn-players.ts`,
  `ability-status-system.ts`, BR projector/visual oracle, game-mode descriptor,
  map-editor route, and current readiness checks.
- Accepted ADR-0014, ADR-0018, ADR-0024, ADR-0027, and ADR-0030.

## Phase 1 — Trace the first wrong state

- [ ] Prove where `rendererCapabilityId` is lost between manifest discovery,
  `GameModeDescriptor`, IPC decode, project selection, and viewport props.
- [ ] Compare runtime spawn/trap/collision positions and declared radii for the
  two reproduced maps; identify the first unsafe relationship rather than weakening damage.
- [ ] Compare projector world footprint, texture source pixels, camera zoom, and
  viewport projection; identify whether size is normalized twice, once, or not at all.

## Phase 2 — Apply canonical fixes

- [ ] Make unresolved required renderer capability a single blocking state and
  preserve the declared capability through the canonical discovery path.
- [ ] Reserve deterministic spawn safety space from environmental hazards,
  collision, and other participants; generated-map readiness uses the same policy.
- [ ] Normalize character, weapon, prop, hazard, and effect visuals through one
  declared world-footprint/anchor/layer contract before Pixi drawing.
- [ ] Remove any stale fallback, duplicate conversion, or renderer gameplay heuristic
  made obsolete by the canonical fixes.

## Phase 3 — Prove the opening

- [ ] Run the closest existing capability/discovery check.
- [ ] Run the closest existing BR spawn/visual invariant check.
- [ ] Live-test five fresh openings in Electron, including `map-fix-check` and
  `petwars3`, then stop the session cleanly.

## Out Of Scope

- Movement tuning, prediction, pointer aim, firing, reload, combat balance, audio polish.
- Full tileset/character asset production, HUD redesign, results/redeploy semantics.
- Browser/multiplayer completion, release packaging, deployment, publication.
- New broad test suites, proof-only hooks, metrics, or a second projector/runtime loop.

## Verification

- Inspect the real Electron operating path first and repeat it once after the informed fix.
- Use at most one targeted existing automated check per durable owning invariant.
- Observe normal play zoom and console directly; screenshots or snapshots do not
  substitute for seeing the rendered opening in Electron.
- Stop if the same informed fix fails twice without new evidence.

## Acceptance Criteria

- `rendererCapabilityId` reaches the viewport before mount; three consecutive
  runs emit no missing-capability or other relevant console error.
- Five consecutive starts create distinct valid participant spawns and no player
  receives environmental damage/status for the first three seconds without movement.
- Characters, weapons, props, hazards, pickups, and terrain are distinguishable at
  normal zoom; unrelated full-size visuals do not stack over the local player.
- Minimap, collision, camera, simulation, and visuals agree on entity locations.
- Stop leaves zero live playtest sessions.
- Existing unrelated worktree changes remain preserved.

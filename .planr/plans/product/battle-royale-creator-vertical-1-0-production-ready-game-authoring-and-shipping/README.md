# Battle Royale Creator Vertical 1.0 - Production-ready game authoring and shipping

## Summary

Close the complete no-CLI creator loop for a local-first Battle Royale game in
Tileborne Desktop. A creator starts from a clean profile, creates a Battle
Royale project, authors content and visuals, builds a valid map, playtests it,
reopens it without data loss, and ships a locally executable game artifact.

The goal extends the existing editor, runtime, plugin, build, and asset
foundations. It does not replace them with a second authoring stack.

## Goals

- Make Battle Royale creation understandable without knowledge of plugin ids,
  catalog ids, package internals, or CLI commands.
- Provide first-class authoring for game objects, weapons, items, loot, player
  visuals, sprites, animations, HUD/input, and Battle Royale rules.
- Make validation one actionable source of truth that gates playtest and build.
- Protect work through consistent dirty-state, autosave, recovery, and reopen
  behavior across editor surfaces.
- Turn the existing build pipeline into a guided Validate -> Build -> Preview ->
  Export workflow.
- Preserve genre-neutral core ownership and prove extension points needed by a
  future top-down game-mode plugin.
- Finish with live Electron and executed packaged-artifact evidence.

## Non-Goals

- Building the future top-down/Zelda-style game itself.
- Cloud accounts, global matchmaking, parties, friends, leaderboards, or
  long-lived player identity.
- A public plugin marketplace or execution of arbitrary untrusted plugin code.
- A full Photoshop/Aseprite replacement; sprite work covers import, slicing,
  visual assignment, animation clips, preview, and gameplay anchors/events.
- Replacing the existing map editor, runtime simulation, plugin API, or CLI.
- Requiring cloud deployment credentials for completion.

## Assumptions

- Tileborne remains desktop-first and local-first for this release.
- Battle Royale and Example Arena remain bundled first-party plugins.
- The existing declarative plugin manifests, runtime projector model, catalog,
  map package, and build services are canonical foundations.
- Creators may use bundled assets or import their own legally usable assets.
- Existing unrelated dirty worktree changes are preserved.
- The 2,000-asset Working Palette scenario remains a regression baseline.

## Scope Decision

This goal is the Battle Royale creator vertical required to call the editor
production-ready for local game creation. It includes generic core contracts
only where the Battle Royale vertical needs them and where the same contract is
necessary for a later top-down plugin. Cloud platform features and the actual
top-down gameplay implementation are separate goals.

## Goal Oracle

From a clean Tileborne Desktop profile, and without using the CLI for authoring,
a tester can create a Battle Royale game, use real assets, define a player,
weapon, item/loot configuration and Battle Royale rules, build a valid map,
observe and fix actionable readiness errors, complete live Single and local
multiplayer playtests, close and reopen the project with authored state intact,
produce a local game artifact from the Ship Game flow, execute that artifact,
and observe the authored Battle Royale match running.

## Refinement 2026-07-13T16:03:28.664892Z

User-provided outcome: plan the complete production-ready Battle Royale creator loop across core editor features, object/sprite/asset/animation authoring, the Battle Royale mode plugin, playtest, persistence, and shipping.

## Refinement 2026-07-13T16:03:28.851658Z

Constraint: extend the existing local-first Electron editor, plugin API, runtime, catalogs, map-package, and build services; preserve their canonical ownership and avoid a parallel authoring or build stack.

## Refinement 2026-07-13T16:03:29.035819Z

Constraint: Core owns genre-neutral mechanisms; game-mode plugins own rules, defaults/templates, validation, runtime systems, and projection. Prepare extension points for a future top-down mode without implementing that game.

## Refinement 2026-07-13T16:03:29.261142Z

Assumption: creator 1.0 ships a local executable or servable artifact. Cloud identity, global matchmaking, leaderboards, marketplace distribution, and the actual top-down game are separate goals.

## Refinement 2026-07-13T16:03:29.439669Z

Verification oracle: from a clean Desktop profile and without CLI authoring, create a BR game with real assets and authored player, weapon, loot, rules and map; fix readiness errors; run Single and two-client local multiplayer playtests; save and reopen; ship and execute the resulting local artifact.

## Refinement 2026-07-13T16:03:29.636119Z

Quality constraint: preserve unrelated dirty worktree changes, require independent review for the release slice, and retain the bounded on-demand 2000-asset Working Palette behavior as a regression gate.

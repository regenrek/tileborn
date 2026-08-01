# Tileborne release-quality playable vertical

## Summary

Turn the current Battle Royale sample from a technically running editor playtest
into a credible 2026-quality top-down 2D game vertical. The vertical is the proof
that Tileborne can produce a game that is immediately fair, readable, responsive,
cohesive, and enjoyable—not merely a runtime that advances ticks.

## Goals

- Make a fresh generated game safely playable from title screen through results and redeploy.
- Deliver responsive movement, pointer aim, firing, reload, collision, camera, and pause behavior.
- Establish a coherent 2D sprite scale, layering, animation, VFX, audio, and HUD language.
- Preserve one canonical engine/runtime/plugin ownership path without renderer gameplay forks.
- Meet keyboard, remapping, color-independent, and reduced-effects accessibility expectations.

## Non-Goals

- Replacing PixiJS, rewriting the engine, or introducing Phaser as a second runtime owner.
- Shipping a full commercial content campaign, progression economy, or production matchmaking.
- Solving release signing, notarization, deployment, or storefront distribution.
- Adding verification-only production hooks, duplicate test suites, or synthetic proof machinery.

## Assumptions

- Battle Royale is the first quality oracle, while the engine remains genre-neutral for Zelda-like games.
- Existing Planr controls and coordinate plans are canonical dependencies, not work to duplicate.
- The current Maltipoo art may be used as temporary source material, but the final vertical needs a
  deliberately authored, internally consistent tileset, characters, weapons, effects, and UI treatment.

## Refinement 2026-08-01T14:49:40.218315Z

2026-08-01 live critic pass: four Electron runs across map-fix-check and petwars3 reproduced immediate trap/status damage at tick 9, unreadable sprite/prop/world scale, repeated missing renderer-capability errors, empty results, and Redeploy/Lobby stopping the playtest. Treat existing plans pln-d4221d92 and pln-e4db0624 as canonical dependencies; do not create duplicate input, coordinate, projector, or runtime-loop owners.

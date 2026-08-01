# Client Implementation

## CLI

No new CLI surface.

## MCP

No new MCP surface.

## UI

- Block playtest viewport mounting until project, game-mode descriptor, renderer capability,
  runtime package, and required visuals are resolved.
- Keep the canvas primary in match; interactive HUD controls occupy bounded safe areas and
  noninteractive overlays remain pointer-transparent.
- Render normalized sprite footprints, camera follow, crosshair, projectiles, impacts,
  damage reaction, pickups, hazards, and zone with one visual-scale contract.
- Present concise controls/objective onboarding, accessible pause/settings, factual results,
  and distinct Lobby/Redeploy/Stop behavior.
- Reuse `@tileborne/game-client` chassis and existing input/prediction path in Electron and browser.

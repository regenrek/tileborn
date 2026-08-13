# API And Data Model

## Objects

- Explicit authoring-pixel, runtime-tile, and visual-world-size values.
- Spawn safety result with conflicts against hazards, collision, and participant clearance.
- Game-mode descriptor with required renderer capability and blocking diagnostic.
- Match result with placement, eliminations, damage/survival summary, and end reason.
- Sprite visual descriptor with world footprint, anchor, layer, animation clips, and sockets.

## Commands

- Start/pause/resume/end a match independently from start/stop of the playtest session.
- Redeploy within the current session and return to its lobby.
- Resolve remapped actions and submit BR intent; authority accepts/rejects outcomes.

## Events

- Match started/paused/resumed/ended and session stopped.
- Weapon fired/reload, projectile/impact, damage/status/elimination, pickup, and zone phase.
- Results-ready event referencing the authoritative match outcome.

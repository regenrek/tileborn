# Client Implementation

## CLI

No new CLI surface. Existing headless runtime tests consume the canonical loop.

## MCP

No MCP changes.

## UI

- Make the in-match runtime shell pointer-transparent except its controls.
- Coalesce pointer motion to one aim submission per animation frame.
- Add centered crosshair and keep it pointer-transparent.
- Predict only the local controlled entity; render remote snapshots with the
  existing interpolation delay; reconcile local prediction by input sequence.
- Stop the owned playtest before project context changes.

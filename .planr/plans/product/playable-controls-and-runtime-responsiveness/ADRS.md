# Architecture Decisions

## ADR-001

Status: proposed

Decision:

Keep PixiJS as the default renderer adapter. The runtime owns simulation,
input sampling, prediction, reconciliation, and scheduling. Persisted map objects
use pixels; runtime package placements use tiles; services-build performs the one
explicit conversion. Local entities are predicted, remote entities interpolated.
Gameplay feedback consumes authoritative gameplay events.

Consequences:

- No Phaser, Pixi ticker, renderer heuristic, or plugin-specific shell loop becomes
  a second gameplay owner.
- Existing generator pixel placement remains valid after package conversion.
- Desktop playtest and browser game client must share the same input/prediction core.

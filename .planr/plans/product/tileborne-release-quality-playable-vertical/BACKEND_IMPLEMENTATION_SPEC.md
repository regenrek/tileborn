# Backend Implementation

## Storage

No new remote storage. Project-authored visual/HUD/control settings use existing
project persistence; personal remaps/accessibility preferences use existing user-owned settings.

## Services

- Runtime package assembly retains one coordinate conversion owner.
- BR runtime validates safe spawn relationships and starts simulation only on match command.
- Authoritative gameplay events and match results feed every client surface.
- Session service distinguishes match lifecycle from process/playtest lifecycle.

## Tests

- Spawn-to-hazard/collision/opponent clearance and no-start-damage invariants.
- Coordinate and visual-footprint conversion once, capability discovery, and shell semantics.
- Deterministic movement/fire/reload/damage/results behavior through existing owning suites.

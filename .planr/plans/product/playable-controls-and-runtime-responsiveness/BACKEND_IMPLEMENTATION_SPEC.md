# Backend Implementation

## Storage

No new persistent backend storage. Session ownership remains keyed by project,
map, and session id.

## Services

- Runtime package assembly converts pixels to tiles once.
- Playtest and game-host simulation remain authoritative fixed-step owners.
- Shell phases explicitly gate/freeze gameplay activation for local playtest.

## Tests

- Conversion, zone, spawn, collision, and projectile unit consistency.
- Session stop/project switch and pause tick invariants.
- Reconciliation and malicious/impossible input remain server constrained.

# QA Acceptance Tests

## Acceptance

- Generate a 48×48, 32 px Battle Royale map and assert perimeter spawns reach
  world positions near the far edges.
- Assert the shrink anchor is at the world-space center.
- Assert every object position is aligned to the tile grid and inside bounds.

## Regression

- Same seed/options still produce identical maps.
- Loot, hazards, decoys, and barriers remain present.
- No object coordinate remains constrained to raw tile-index range by mistake.

## Manual Scenarios

- Create a new Battle Royale project and visually confirm markers are distributed
  across the editor viewport. Existing projects are not auto-migrated.

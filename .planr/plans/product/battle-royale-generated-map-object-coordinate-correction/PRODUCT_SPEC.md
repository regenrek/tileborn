# Product Specification

## Problem

The Battle Royale starter generator writes object positions in tile coordinates,
while `MapObject.x/y` and every editor/runtime consumer interpret them as world
pixels. On a 32 px tile map, all generated markers therefore render inside the
first roughly 1.5 tiles at the top-left despite being logically distributed.

## Users

Creators starting a new Battle Royale game from the bundled starter template.

## Requirements

- Generated spawn, shrink, loot, trap, decoy, and barrier objects use canonical
  world-pixel coordinates derived from each tile position and the map tile size.
- Deterministic generation, map topology, gameplay properties, and object counts
  remain unchanged.
- Existing persisted projects are not silently rewritten by this code fix.
- Regression tests prove perimeter and interior objects span the generated map
  in pixel space and remain deterministic.

## Success Criteria

- A new 48×48 starter map with 32 px tiles renders objects across the full
  1536×1536 world instead of clustering near `(0,0)`.
- Focused plugin tests, typecheck, and lint pass.
- The canonical generator remains the single coordinate-conversion owner.

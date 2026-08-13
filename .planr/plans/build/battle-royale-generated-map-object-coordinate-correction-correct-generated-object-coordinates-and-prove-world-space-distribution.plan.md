---
name: battle-royale-generated-map-object-coordinate-correction-correct-generated-object-coordinates-and-prove-world-space-distribution
overview: "Build plan for Battle Royale generated map object coordinate correction - Correct generated object coordinates and prove world-space distribution."
todos:
  - id: phase-1
    content: "Implement Correct generated object coordinates and prove world-space distribution"
    status: completed
isProject: false
stage: build
source_plan: pln-e4db0624
slice: "Correct generated object coordinates and prove world-space distribution"
---

# Battle Royale generated map object coordinate correction - Correct generated object coordinates and prove world-space distribution

## Scope Decision

Fix only newly generated Battle Royale maps. Convert all generated object tile
cells to world pixels without changing terrain generation, counts, properties,
runtime behavior, or existing persisted maps.

## Ownership Target

`packages/plugin-battle-royale/src/generate-map.ts` owns generated placement.
`MapObject` and renderer/runtime consumers keep their existing pixel contract.

## Existing Leverage

Reuse `map.tileSize`, deterministic point helpers, generator tests, and the
desktop viewport's already-canonical pixel-space placement behavior.

## Phase 1

- [x] Add one tile-cell-to-world-pixel helper and use it for every generated object family.
- [x] Add focused generator regressions for bounds, alignment, center, and perimeter distribution.
- [x] Run focused tests, plugin typecheck, lint, and formatting checks.

## Out Of Scope

No automatic migration of existing maps, terrain redesign, new art, renderer
coordinate fallback, runtime compatibility path, or unrelated release work.

## Verification

- `pnpm --filter @tileborne/plugin-battle-royale test -- generate-map.test.ts`
- `pnpm --filter @tileborne/plugin-battle-royale typecheck`
- `pnpm --filter @tileborne/plugin-battle-royale lint`
- Prettier check for changed source/test/plan files.

## Acceptance Criteria

- Generated spawn positions reach the far edges in pixel space on a 48×48 map.
- The shrink anchor is centered at `(width * tileWidth / 2, height * tileHeight / 2)`.
- Every object is grid-aligned, non-negative, and inside map world bounds.
- Same seed/options remain deterministic and all prior generated object kinds remain present.
- Existing user map files remain untouched.

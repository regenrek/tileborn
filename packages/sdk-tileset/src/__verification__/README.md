# SDK Tileset Verification

End-to-end deterministic and golden verification for the `@tileborne/sdk-tileset` pipeline.

## Running tests

From the monorepo root:

```bash
pnpm --filter @tileborne/sdk-tileset test --run
```

## Regenerating goldens

When intentional pipeline output changes, regenerate committed goldens:

```bash
cd packages/sdk-tileset
pnpm tsx scripts/regen-goldens.mts
```

Goldens live under `src/__verification__/__goldens__/<scenario>/` as pretty-printed JSON with deterministic key ordering. Keep individual files under ~50KB.

## Scenarios

| Scenario                 | File(s)                                                      | Verifies                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-format equivalence | `cross-format-equivalence/`                                  | TMX, TMJ, LDtk, and Tileborne manifest produce equivalent normalized packs + layouts; Tiled source is verified separately via wall-rule goldens |
| Compatibility matrix     | `compatibility-matrix.json` + `compatibility-matrix.test.ts` | Explicit 4×7 source-format × autotile-pattern support matrix with round-trip or diagnostic expectations                                         |
| Replay                   | `replay/`                                                    | RNG seed + brush sequence byte-identical across runs                                                                                            |
| Layout goldens           | `layouts/`                                                   | `renderTileLayout` for 4×4 / 8×8 / 16×16 maps                                                                                                   |
| UV goldens               | `uvs/`                                                       | Atlas slicing + frame index tables                                                                                                              |
| Animation determinism    | `animation-determinism/`                                     | 60-tick `resolveAnimatedTile` sequence                                                                                                          |
| Collision roundtrip      | `collision-roundtrip/`                                       | Tiled → SDK → manifest geometry preservation                                                                                                    |
| Runtime packaging        | `runtime-packaging/`                                         | Referenced-tile manifest filtering                                                                                                              |
| Tiled source wall rules  | `tiled-wall-rules/`                                          | Synthetic wall-rule TMX → compiled mask table                                                                                                   |
| Terrain transition       | `terrain-transition-grass-water/`                            | 3×3 grass/water base + overlay output                                                                                                           |

Test failures include the regeneration command in the error message.

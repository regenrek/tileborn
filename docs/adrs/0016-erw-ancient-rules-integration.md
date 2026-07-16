# ADR-0016: ERW Ancient Tiled rules integration

- Status: Proposed
- Date: 2026-05-24
- Deciders: Tileborne core team
- Tags: terrain, tiled, erw-ancient, runtime, editor-ui, ipc, boundary-test, live-test

## Context

ADR-0014 and ADR-0015 closed the v0.1 playtest rendering and bundled-asset blockers. The next gap is different: Tileborn can import and display ERW Ancient asset packs, and `@tileborne/sdk-tileset` already contains parser/resolver pieces for Tiled, LDtk, Wang rules, animation, collision metadata, and a first ERW Ancient importer. The live audit under `.refs/v0.1.1-live-audit/` shows the product surface still falls short of the private Petwars ERW behavior:

- `01-current-editor.png` shows a generated editor scene with simple `terrain`, `props`, and `entities` tile layers.
- `02-generate-map-dialog.png` and `02-generate-map-dialog-dom.json` show Generate Map exposes only pack, width, height, seed, and generic presets: `Open field`, `Dungeon rooms`, and `Bordered arena`.
- `03-asset-library.png` and `03-asset-library-dom.json` show ERW Ancient packs are installed, but at least one selected pack reports `Tile count 0`; the UI exposes asset packs, not rule-pack application or wangset diagnostics.

Petwars' ERW Ancient contract is richer than "a pack of sprites". The private pipeline starts from a Tiled source manifest (`petwars.erw-ancient-tiled-source.v1`) containing TSX tilesets, Wang sets/colors/tiles, tile probabilities, animations, object collision metadata, example maps, and TMX automapping rules. It compiles this into `petwars.erw-ancient-rule-pipeline.v1` with:

- `wangSets` copied from Tiled tilesets.
- `automappingRules` extracted from rule maps with canonical `input_walls` and `output_walls` layers.
- `rule_options` object groups carrying `Probability` and `Disabled`.
- ordered phases `reset`, `place`, `variation`, split by wall and transparent/non-transparent variants.
- `wallGroups` with sorted rule paths and phase order.
- diagnostics for missing or empty rule layers.

The generated Petwars runtime map consumes that pipeline as semantic map state plus projected renderables: `terrainCells`, `visualTiles`, layered props, hide zones, obstacles, gameplay objects, loot/spawn hints, collision footprints, `terrainBuildHash`, and `procgenSignature`. Runtime packaging then includes only referenced ERW image/atlas entries by content hash.

Tileborn's current static state is close but not integrated:

- `packages/sdk-tileset/src/importers/erw-ancient-ruins/import.ts` imports ERW TSX/TMX sources and attaches wall-rule output to tilesets, but it is still a tileset-pack importer, not the canonical Petwars-compatible rule pipeline contract.
- `packages/services-app/src/map/index.ts` generates maps through `makeGeneratedLayers(spec.preset, width, height, seed)` with preset-only metadata and no rule-pack application.
- `apps/desktop/src/renderer/components/generate-map-dialog.tsx` matches the live audit: pack selection plus generic presets only.
- `packages/boundary-tests/src/tests/forbidden-tokens.test.ts` currently allow-lists ERW importer exceptions, but does not yet enforce the new forbidden edges for renderer/runtime/rule-engine ownership.

The v0.1 synthesis already called out follow-up gaps around editor authoring, terrain rules, asset packs, multiplayer parity beyond BR, and plugin SDK surfaces. ADR-0016 narrows the next round to making ERW Ancient Tiled rules work end-to-end without making ERW private content or Petwars semantics the neutral Tileborn architecture.

## Decision

Adopt the ERW Ancient Tiled rule shape as the canonical terrain/tile rule format that Tileborn must support for the next gap-fix round.

The rule engine is engine-side and plugin-neutral: pure, deterministic, worker-safe, and renderer-free. Plugins may ship rule packs as data, but plugins do not ship the rule engine. Runtime and editor consumers receive projected rule outputs, diagnostics, and renderable/collision projections; they do not import rule-pipeline internals.

The canonical package owner is `packages/sdk-tileset` for now. A later package split to `packages/erw-ancient-rules` is allowed only if it removes coupling and keeps the public API renderer-neutral. Do not create a Petwars-specific package in Tileborn.

Effect v4 remains the schema and boundary language for new public contracts in `packages/core`, `packages/runtime`, and `packages/ipc-contracts`: use `Schema.Class`, branded IDs, tagged errors via `Schema.TaggedErrorClass`, and service methods shaped as `Effect.fn` where services are introduced.

## Plugin-neutral architecture

Keep PNNM: plugin-neutral neutral model.

- ERW rule engine: `packages/sdk-tileset` or a narrow pure package under `packages/`, with no React, Electron, Pixi, Phaser, filesystem, or Node-only runtime dependencies in worker-bundled entry points.
- Bundled rule packs: plugin-owned data registered through the ADR-0015 bundled-asset precedent, extended to rule-pack specs if needed.
- Map authoring UI: `apps/desktop/src/renderer` owns React/shadcn dialogs, previews, and scorecards, but only calls IPC and consumes projected output.
- Runtime rule application: `packages/runtime` owns worker-safe application of compiled rule output during playtest and runtime mounting.
- IPC: `packages/ipc-contracts` owns any authoring/preview/apply RPC and event schemas.
- Durable project/map data: `packages/core` owns stable map/project schema extensions and IDs.

Forbidden edges:

- ERW rule logic must not import from `apps/desktop/**` or `packages/runtime/renderer/**`.
- Renderer code must not import ERW rule-pipeline internals; it may import IPC clients and projected view models only.
- Worker-bundled paths must not import `node:fs`, `node:crypto`, or Electron modules. Use injected readers at import time and runtime-neutral hashing (`crypto.subtle` or a shared pure helper) in runtime paths.
- `packages/core`, `packages/runtime`, and `packages/ipc-contracts` must not depend on private Petwars code, `.pwmap`, or Petwars object catalogs.

## Phases

### Phase 0 - Engine-side ERW rule package (2-3 day vertical slice)

Deliver a pure, deterministic rule-pack contract with Effect schemas and golden tests against Petwars-shaped fixtures.

Work:

1. Define `ErwAncientRulePack`, `ErwAncientRulePipeline`, `ErwRuleApplicationInput`, `ErwRuleApplicationOutput`, diagnostics, provenance, and branded IDs.
2. Normalize current `sdk-tileset` ERW importer output into the Petwars-compatible pipeline shape: Wang sets, automapping rules, phases, wall groups, options, and source digest.
3. Add a worker-safe entry point with no Node/Electron/renderer imports.
4. Add deterministic golden tests using small synthetic fixtures plus private-gated Petwars fixture tests when available.

DoD:

- Same source manifest plus same seed yields byte-identical compiled pipeline and projected tile output.
- Missing `input_walls`, missing `output_walls`, empty layers, invalid options, and missing tile refs produce typed diagnostics.
- Boundary test proves rule engine cannot import renderer/runtime renderer modules.

### Phase 1 - Map authoring UI and asset-pack importer

Turn "asset pack installed" into "rule pack understood".

Work:

1. Add an importer/report surface for ERW Ancient Tiled wangsets and automapping phases.
2. Extend asset library details to show rule-pack summary: source digest, wang set count, automapping rule count, wall groups, diagnostics, and license/provenance.
3. Extend Generate Map to select a rule pack, terrain behavior profile, wall group policy, and deterministic seed.
4. Add preview output for projected terrain transitions and wall placement without exposing rule internals to renderer code.

DoD:

- Live UI shows an imported ERW rule pack with non-zero tiles/rules/wall groups.
- Generate Map no longer only offers `open/dungeon/arena`; it can run an ERW Ancient profile.
- Renderer consumes IPC-projected preview data, not rule-engine internals.

### Phase 2 - Runtime integration, boundaries, and live walkthrough

Apply ERW rule output in playtest/runtime without duplicating policy.

Work:

1. `packages/runtime` applies compiled/projected rule output to map packages through a worker-safe entry point.
2. Runtime map output preserves Tileborn-neutral layers while carrying enough projections for Petwars terrain: renderable tiles, collision masks, object spawn hints, hide zones, obstacle footprints, and source digests.
3. Add forbidden-import tests for the ownership edges.
4. Extend live walkthrough to cover project create, rule-pack import, ERW map generation, editor scene render, and playtest boot.

DoD:

- Playtest renders ERW-projected terrain and obstacles from a generated map.
- Runtime package includes only referenced assets/rules and stable content hashes.
- Live audit scorecard is saved under `.refs/v0.1.1-live-audit/` and includes screenshots and DOM JSON.

## IPC contract changes

New or extended contracts should live in `packages/ipc-contracts` with Effect schemas:

- `tileborne:assets:inspect-rule-pack`
  - Request: `{ packId }`
  - Response: rule-pack summary, source digest, wang set count, automapping rule count, wall groups, diagnostics, provenance.
- `tileborne:maps:preview-rule-application`
  - Request: `{ projectId, packId, mapId?, width, height, seed, profile, wallGroups }`
  - Response: projected layer patches, diagnostics, affected cells, preview asset refs.
- `tileborne:maps:generate-from-rule-pack`
  - Request: `{ projectId, packId, width, height, seed, profile, ruleOptions }`
  - Response: `{ map, ruleApplicationSummary, diagnostics }`
- `tileborne:runtime:prepare-rule-projection`
  - Request: `{ mapId, packId, projectionDigest }`
  - Response: runtime-safe projection manifest with referenced assets and rule digest.
- Event: `tileborne:maps:rule-preview-updated`
  - Payload: `{ projectId, mapId?, previewId, diagnostics, patchSummary }`

All schema payloads must use branded IDs from `@tileborne/core` or local branded rule IDs, not loose strings for durable identity.

## Definition of done

1. `ErwAncientRulePipeline` encodes Petwars-compatible Wang sets, automapping rules, phase order, rule options, wall groups, diagnostics, and source digest.
2. Rule application is deterministic and idempotent for same source digest, same seed, same input semantic grid, and same profile.
3. Generated Tileborn maps can carry ERW-projected renderable tile layers, collision masks, and gameplay spawn/object hints without importing Petwars runtime code.
4. Generate Map exposes ERW rule-pack/profile selection and diagnostics, not only generic presets.
5. Asset library details show non-zero ERW rule/tile summaries and provenance/license data.
6. Runtime playtest applies rule output through a worker-safe entry point and includes only referenced assets in runtime manifests.
7. Boundary tests forbid rule-engine imports from `apps/desktop/**`, renderer imports of rule internals, and Node/Electron imports in worker-bundled rule/runtime paths.
8. Live test item: screenshot and DOM JSON prove Generate Map exposes ERW rule-pack controls and diagnostics.
9. Live test item: screenshot and DOM JSON prove generated editor scene renders projected terrain/walls/objects, then playtest boots from the same projection.
10. `vitest --run` focused suites cover schemas, importer normalization, deterministic rule application, IPC contracts, runtime projection, and boundary tests.

## Risks and mitigations

1. **Private-content leak.** ERW Ancient is licensed private content. Mitigation: rule-pack tests are synthetic or private-gated; no ERW-derived images/manifests ship in OSS fixtures unless provenance allows it.
2. **Tileborn neutral core becomes Petwars-shaped.** Petwars needs objects, loot, and collision, but Tileborn should not hard-code Petwars roles. Mitigation: ERW produces neutral projected hints; game plugins map hints to game-specific catalogs.
3. **Duplicate rule engines.** Existing `sdk-tileset` parser/resolver code could diverge from a new ERW package. Mitigation: keep canonical owner in `sdk-tileset` unless a split has one-way dependencies and shared tests.
4. **Renderer shortcut.** UI might import rule internals for convenience. Mitigation: add boundary tests before UI implementation.
5. **Worker bundling regressions.** Node-only imports can sneak in via path/security helpers. Mitigation: dedicated worker entry, boundary test for `node:` imports, and browser/worker smoke.
6. **Algorithm mismatch with Petwars.** Tiled Wang rules alone do not capture Petwars automapping phases. Mitigation: Phase 0 golden tests compare reset/place/variation order, wall group sorting, rule options, transparent variants, and diagnostics.

## Reference repos

Petwars evidence:

- `/Users/kregenrek/projects/games/petwars/shared/src/erw-ancient-tiled/source-manifest.ts:130` defines the source manifest shape: source roots, digest, tilesets, maps, automapping rules, and summary counts.
- `/Users/kregenrek/projects/games/petwars/shared/src/erw-ancient-tiled/rule-pipeline.ts:74` compiles manifest data into the rule pipeline; lines 111-129 require `input_walls`, `output_walls`, `rule_options`, `MatchInOrder`, and phase data.
- `/Users/kregenrek/projects/games/petwars/editor/data/maps/grassland.json:70189` shows `terrainBuildHash` and `procgenSignature`; lines 70193-70291 show ERW source IDs and behavior graph fields.
- `/Users/kregenrek/projects/games/petwars/editor/src/client/playtest-pipeline.ts:135` exports authored maps to `.pwmap`, then lines 160-216 include only referenced ERW runtime assets.
- `/Users/kregenrek/projects/games/petwars/app/src/client/scenes/map-renderer.ts:92` resolves `visualTiles`, props, and hide zones through ERW runtime assets.
- `/Users/kregenrek/projects/games/petwars/shared/src/game-object-definitions/defaults.ts:246` and `validation.ts:279` show the object/catalog/collision invariants ERW-generated maps rely on.

External and local prior-art references:

- `.refs/v01-tileset-parser-references/reference-context.md:14` cites `riebel/pixi-tiledmap` for Tiled/Pixi loader boundaries; line 23 cites `workadventure/tiled-map-type-guard` for explicit Tiled JSON validation; line 31 cites `syropian/autotile` for pure resolver shape; line 40 cites `browndragon/phaser3-autotile` for 47-tile/Wang refresh-region behavior.
- `.refs/v01-editor-references/reference-context.md:16` cites `mapeditor/tiled` as the canonical tile-map editor UX reference; line 23 cites LDtk for layer/entity editing; line 37 cites `excaliburjs/excalibur-tiled` for runtime handoff thinking.
- `docs/01-spec.md:69` lists Tileborn invariants including renderer no Node/Electron imports, IPC in Effect Schema, content-hashed imports, and no `petwars`/`grassland`/`erw:` tokens after migration.
- `/Users/kregenrek/projects/external-codebase/tamux/skills/nontechnical/absolutelyskilled/pixel-art-sprites/references/tileset-patterns.md:96` summarizes 8-bit Wang/blob auto-tiling; lines 243-248 call out Tiled Wang set support. This was the only directly relevant local hit in `/Users/kregenrek/projects/external-codebase`; broader implementation references remain the curated search-context refs above.

## Smallest vertical slice

Three-day deliverable:

**Day 1 - Contract and normalization.** Define Effect schemas for `ErwAncientRulePipeline`, diagnostics, provenance, rule IDs, and projection input/output. Normalize current `sdk-tileset` ERW importer output into Petwars-compatible wang set, automapping rule, wall group, and diagnostic shapes.

**Day 2 - Deterministic rule application.** Implement worker-safe pure application over a small semantic grid fixture. Add golden tests for reset/place/variation order, transparent variants, rule options, deterministic variant choice, and diagnostics.

**Day 3 - IPC-backed preview.** Add the IPC contract skeleton and app service stub for rule-pack inspection/preview, returning projected data from a fixture. Add boundary tests and a live audit path that shows rule-pack diagnostics in the editor without renderer imports of rule internals.

The slice intentionally stops before full editor UI polish and playtest integration. It proves the rule contract works with the Petwars ERW Ancient Tiled pipeline and gives Phase 1/2 a stable owner boundary.

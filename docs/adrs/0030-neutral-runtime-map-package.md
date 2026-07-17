# ADR-0030: Neutral runtime map package + authoring-to-playtest handoff

- Status: Accepted
- Date: 2026-06-10
- Deciders: Tileborne core team
- Tags: runtime, core, map-package, artifact, game-host, playtest, catalog, plugin-boundary, boundary-test, research

## Context

This is the **P0 vertical-slice capstone** of the ADR-0023 slot (`t-p0-runtime-map-package-adr`, ADR-0017 row "runtime map package + authoring-to-playtest handoff"). It consumes the contracts the slot already shipped — discovered active mode (ADR-0023 §B), namespaced settings (`map.properties.<pluginId>`, §A), materialized per-plugin catalogs (ADR-0019), weapon catalogs (ADR-0018 Slice 5) — and defines the **one package format** that carries an authored map into every runtime: editor playtest, local multiplayer host, `apps/game-host`, and the `tileborne game build` product output (M5).

### Current handoff reality (the seams this ADR closes)

- **The gameplay package is plugin-owned and BR-shaped.** `packages/plugin-battle-royale/src/types/artifact.ts` (`ExportedArtifact`) carries genuinely neutral data — object placements, spawn points, player models, overlay visuals, weapon visuals, tileset pack — but as a **BR schema** with a **closed `ObjectPlacementRole` enum** (`spawn-point | shrink-zone-anchor | loot-crate | trap | decoy`). A second genre cannot reuse any of it without importing BR.
- **The editor artifact is gameplay-blind.** `packages/services-build` `PlaytestArtifact`/`PlaytestArtifactManifest` is a directory + `{ mapId, projectId, plugins, integrityHash }` — no catalog, no placements, no settings projection. The gameplay-aware data is re-derived per consumer.
- **The runtime ingests untyped JSON.** `apps/game-host` room boot takes `runtimeArtifact?: JsonObject` (`rooms/room-object.ts:89`) and trusts the plugin to decode it; the desktop playtest host separately receives `objectTypes` + `projectObjectTypeIds` as loose handler args (`handlers.ts` playtest:start). Two parallel, partially-typed handoffs.
- **Catalog merge is deferred.** `PluginLoaderService.loadDeclarative` already materializes per-plugin `gameObjectCatalogs` (ADR-0019), but no engine owner merges them (cross-plugin + project entities, origin precedence) into a **runtime registry**; consumers each re-resolve.

## Decision

`packages/core` owns a durable, neutral **`RuntimeMapPackage`** schema; `packages/runtime` owns the **worker-safe loader + runtime catalog registry**; `packages/services-build` **assembles** it; every runtime **boots from it**. Plugins contribute only a namespaced mode-data projection and validation. Product repos supply `maps/` and config — never logic.

### Package shape (all `Schema.Class`, branded ids, content-addressed)

```
RuntimeMapPackage
├─ manifest        # packageId, projectId, mapId, activeMode (GameModeId), schemaVersion,
│                  # engine version, per-entry sha-256 content hashes, createdAt
├─ map             # the persisted TileborneMap (ADR-0008 versioned schema)
├─ catalog         # MERGED runtime game-object registry: cross-plugin + project entities,
│                  # origin tagged (plugin id | project), ids unique across origins (no-shadowing)
├─ placements      # neutral object placements: { objectId, typeId: GameObjectTypeId, x, y,
│                  # instanceProperties } — NO role enum; gameplay roles derive from the
│                  # placed type's catalog components (spawn-point, loot-source, hazard, …)
├─ settings        # the map's namespaced authoring settings (map.properties.<pluginId>, §A)
├─ visuals         # resolved render-ready projections: player models, overlay visuals,
│                  # weapon visual bindings (ADR-0026/0028 outputs)
├─ assets          # content-addressed referenced assets + tileset pack (sha-256, reusing the
│                  # ADR-0015 bundled-asset and tileset referenced-asset packaging)
└─ modeData        # modeData.<pluginId>: the active mode's OPAQUE-to-engine projection
                   # (e.g. BR zone schedule, loot tables) — schema'd + validated BY the plugin
```

- **Placements are component-driven, not role-enumerated.** The BR `ObjectPlacementRole` closed enum is hard-cut: a placement references a `GameObjectTypeId`; what it _means_ (spawn point, loot crate, hazard) is read from the type's catalog components. New genres add meaning by adding catalog components — zero package-schema edits.
- **`modeData` mirrors the settings-namespace decision** (ADR-0023 §A): keyed by `pluginId`, written by the plugin's exporter, decoded by the plugin's runtime; the engine validates only that the section is well-formed JSON + hashed. Genuinely neutral data may NOT hide in `modeData` (boundary rule below).
- **Catalog merge.** `packages/runtime` gains `buildRuntimeCatalogRegistry(loadedPlugins, projectCatalog)`: consumes the **already-materialized** `LoadedDeclarativePlugin.gameObjectCatalogs` (never re-resolves `data.indexPath`), merges cross-plugin with duplicate detection (ADR-0019 `mergeGameObjectCatalogs` precedent), tags origin, and appends project entities under the **NO-SHADOWING** rule: a project entity colliding with a plugin-owned id **fails the merge** with an error naming the id and owning plugin — the same rejection the editor's `upsertType` already enforces. _(Revised at the M2 review: the original "project entities override plugin-shipped ones" precedence is dropped so every id has exactly one owner; authors duplicate a plugin type as a project entity with its own id instead.)_ The registry is the single runtime catalog consumer surface (lookup by `GameObjectTypeId`, by component tag, by family).

### Handoff flow (one producer, N consumers)

1. **Assemble (editor / CLI).** `services-build.assembleArtifact` becomes `assembleRuntimeMapPackage`: resolve active mode (existing ADR-0023 path) → merge catalogs → project placements from the map's object layers → copy referenced assets content-addressed → call the active plugin's exporter for `modeData.<pluginId>` + validation → write package + manifest hashes.
2. **Load (any runtime).** `packages/runtime` ships the worker-safe `loadRuntimeMapPackage` (decode + hash-verify + version-gate per ADR-0008): used identically by the desktop playtest host, the local multiplayer host, and `apps/game-host` room boot. The `runtimeArtifact: JsonObject` pass-through and the loose `objectTypes`/`projectObjectTypeIds` handler args are **hard-cut** in favor of the typed package.
3. **Run.** The host hands the plugin its `modeData` section + the catalog registry + placements; the plugin spawns its world from them (BR: spawn points from placements-with-spawn-component, zone from its modeData).
4. **Ship (M5).** `tileborne game build` emits the same package next to the built client — the product repo's `maps/` directory is a directory of `RuntimeMapPackage`s.

## Plugin-neutral architecture

| Concern                                                  | Runtime owner                    | First-fix owner                                          | Canonical long-term owner                          |
| -------------------------------------------------------- | -------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `RuntimeMapPackage` schema + manifest + hashes           | every host's decode              | BR `ExportedArtifact` (neutral parts)                    | `packages/core` (`src/map-package/`)               |
| Worker-safe loader + hash/version verify                 | playtest host, game-host, build  | per-consumer ad-hoc decode                               | `packages/runtime`                                 |
| Runtime catalog registry (merge + no-shadowing + lookup) | host boot                        | unconsumed `LoadedDeclarativePlugin.gameObjectCatalogs`  | `packages/runtime` (`buildRuntimeCatalogRegistry`) |
| Package assembly                                         | editor playtest start, CLI build | `services-build` playtest artifact + BR `exportArtifact` | `packages/services-build`                          |
| `modeData.<pluginId>` projection + validation            | plugin exporter + plugin runtime | BR `exportArtifact` whole-format ownership               | the game-mode plugin                               |
| Maps + mode/settings values                              | product config                   | —                                                        | product repos (`maps/`), no logic                  |

Forbidden edges and required boundary tests:

- `packages/core/src/map-package/**` + the `packages/runtime` loader/registry contain **no plugin/brand literals, no closed role/genre enums** (placement meaning = catalog components only); `modeData` keys derive from `pluginId`.
- Neutral data may not live in `modeData` (no placements/spawn points/visuals inside it) — boundary test inspects the BR exporter's section for known-neutral keys.
- The game-host room and playtest host accept **only** the typed package (no `JsonObject` artifact param survives).
- Effect v4 (`Schema.Class`, branded ids, `Schema.TaggedErrorClass` for load/verify failures); loaders worker-safe (no Node-only imports in decode paths beyond fs at the host edge).

## Definition of done (this ADR)

- ADR written + indexed; decisions as PlanDB contexts; M2 slices enumerated (below); no code here.

## Implementation slices (M2, `t-br10-m2-mappkg`)

1. **(core)** `RuntimeMapPackage` + manifest + placement/visuals/settings/modeData schemas, content-hash + version fields, `Schema.TaggedErrorClass` failures. `vitest --run` round-trips.
2. **(runtime)** `buildRuntimeCatalogRegistry` (merge materialized catalogs + project entities, origin precedence, lookups) + worker-safe `loadRuntimeMapPackage` (decode, hash verify, version gate). `vitest --run`.
3. **(services-build)** `assembleRuntimeMapPackage` (active mode → catalogs → placements → assets → plugin `modeData` callout → hashes); plugin exporter contract narrowed to the `modeData` projection + validation. `vitest --run`.
4. **(hosts)** Desktop playtest host + local multiplayer host + `apps/game-host` room boot consume the typed package; hard-cut `runtimeArtifact: JsonObject` + loose `objectTypes`/`projectObjectTypeIds` args.
5. **(plugin — BR)** Migrate `ExportedArtifact`: neutral parts (placements, player models, overlay/weapon visuals, tileset) move to the package; closed `ObjectPlacementRole` enum hard-cut (roles from components); BR keeps zone/loot in `modeData`. Playtest + multiplayer parity.
6. **(boundary-tests)** Package neutrality (no plugin literals / closed enums), no-neutral-data-in-modeData, typed-package-only hosts.

## Risks and mitigations

1. **Big-bang migration.** Mitigation: slices land engine-first (1–3) while hosts keep the old path until slice 4 flips them in one hard cut; BR parity suites gate slice 5.
2. **`modeData` becoming a second untyped artifact.** Mitigation: plugin-side schema + validation required by the exporter contract; boundary test for known-neutral keys.
3. **Catalog merge conflicts.** Mitigation: ADR-0019 duplicate detection + origin tagging; project/plugin id collisions fail the merge outright (no-shadowing, decided at the M2 review), matching the editor's `upsertType` gate.
4. **Hash/versioning overhead.** Mitigation: reuse the existing `ContentHash` + ADR-0008 version-gate machinery; per-entry hashes only.

## References

- [ADR-0008](./0008-project-map-schema-versioning.md) (versioning), [ADR-0015](./0015-bundled-asset-ownership-and-live-fixes.md) (asset packaging), [ADR-0019](./0019-game-object-catalog.md) (catalog + merge), [ADR-0023](./0023-genre-neutral-game-mode-contracts.md) (active mode + namespace), [ADR-0028](./0028-entity-first-authoring-pipeline.md) (entity-first visuals), [ADR-0029](./0029-neutral-gameplay-event-stream.md) (events).

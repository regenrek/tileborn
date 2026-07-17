# ADR-0025: Editor object & loot authoring UX

- Status: Proposed
- Date: 2026-06-02
- Deciders: Tileborne core team
- Tags: editor-ui, catalog, game-objects, loot, collision, validation, ipc, renderer, plugin-boundary, boundary-test, research

## Context

ADR-0019 shipped the neutral **game-object catalog** in `packages/core` (`GameObjectType`, the `GameObjectComponent` tagged-union, `GameObjectCatalog`, `validateCatalog`, branded ids), hard-cut `MapObject.kind` to a `GameObjectTypeId` (`packages/core/src/map/index.ts:166`), and made the catalog _registrable_: `PluginLoaderService.loadDeclarative` resolves + decodes each plugin's `gameObjectCatalogs` into `MaterializedGameObjectCatalog` (`packages/services-plugin/src/model.ts:72-89`, `packages/services-plugin/src/catalog.ts:64-102`), and `mergeGameObjectCatalogs` (`packages/plugin-api/src/catalog-registry.ts:82-126`) merges them into a `MergedGameObjectCatalog`.

ADR-0017 row 7 (P0) assigns **editor object/loot authoring UX** to the shared OSS engine: `apps/desktop/src/renderer` + `packages/ipc-contracts` + app services own the React/shadcn surface; the BR plugin contributes object/loot content; `petwars-product` authors maps/content in the editor only.

This ADR is **design only**. It makes the shipped catalog _usable_ in the editor. It does not implement code.

### Current authoring reality (what we extend, not reinvent)

This session built the generic placement scaffolding the catalog now plugs into:

- **Working Palette "Markers & Tools" group.** Palette items are an abstract `PaletteActionItem` (`apps/desktop/src/renderer/lib/palette-actions.ts:15-33`) keyed purely on `objectKind` + presentation; selecting one builds a `plugin-object` brush (`paletteActionBrushIntent`, `:51-57`). The set of items is wired in one app-composition file, `plugin-palette-contributions.ts` (`:13-15`), which **hardcodes a direct plugin import** (`BATTLE_ROYALE_PALETTE_ACTIONS` from `@tileborne/plugin-battle-royale/authoring`).
- **Placement.** The viewport controller (`editor-viewport-controller.ts`) renders/places `MapObject`s; the BR authoring panel stamps `MapObject.kind = gameObjectTypeIdForKey(action.objectKind)` (`battle-royale-authoring-panel.tsx:55`, `packages/core/src/catalog/well-known.ts:37-42`).
- **Inspector authoring panel.** `battle-royale-authoring-panel.tsx` renders _map-level_ BR settings through the generic, plugin-owned `AuthoringSettingsForm` mechanism (`apps/desktop/src/renderer/lib/authoring-settings-form.ts`), plus marker placement counts and the per-project player-model roster.
- **IPC DTOs.** `packages/ipc-contracts` map/asset contracts already reuse `@tileborne/core` Effect schemas across the boundary (`contracts/maps.ts:3` reuses `TileborneMap`; `contracts/assets.ts` reuses `PackCapability`).

### The gap this ADR closes

The catalog is registrable but **invisible to the editor**:

1. There is **no IPC channel** exposing the merged catalog to the renderer; `MergedGameObjectCatalog` lives only in the main process via `services-plugin`.
2. Palette items are a **hardcoded plugin import**, not a projection of the catalog. The author can place a marker, but cannot _browse_ catalog object types, see their components, or place a type the catalog defines.
3. There is **no loot-source, collision-footprint, import/export, or validation surface** — exactly the residual ADR-0017 row 7 gap ("item stat presets, collision footprint presets, import/export of object catalog fragments, validation reports").

## Decision

Adopt a **catalog-driven editor authoring surface**, owned by `apps/desktop/src/renderer` + a `apps/desktop/src/main` app service, consuming the merged catalog over a new `packages/ipc-contracts` `catalog` contract. The renderer browses/places `GameObjectType`s, binds loot tables and collision presets, imports/exports project catalog fragments, and reads a validation report — all by consuming **projected IPC DTOs**, never by importing `services-plugin` or running the merge itself.

### Authoring UX model

1. **Catalog browser (palette).** A Working Palette "Objects" group is a **projection of the merged catalog** (`catalog:resolve` DTO), grouped by the open `family`/`category` tags. Selecting a type builds a catalog-object brush carrying the resolved `GameObjectTypeId`. This **hard-cuts the hardcoded `PLUGIN_PALETTE_CONTRIBUTIONS` import**: object kinds now flow from the public `RuntimeGameObjectCatalogContribution` slot (ADR-0019), so a new game-mode plugin surfaces objects with zero editor edits.
2. **Placement.** Reuses the existing viewport placement flow; the brush stamps `MapObject.kind = GameObjectTypeId` directly (the DTO already carries the resolved id — no `gameObjectTypeIdForKey` round-trip). Per-instance `properties` overrides validated against the type's `instanceDefaults` + component schemas.
3. **Inspector object panel.** Selecting a placed `MapObject` resolves its `GameObjectType` from the DTO and renders its components read-only (collision footprint summary, hazard, interactable) with per-instance overrides edited through the generic `AuthoringSettingsForm` mechanism. Map-level BR settings stay in the plugin-owned panel.
4. **Loot sources.** A type carrying `LootSourceComponent` surfaces a loot-table picker (from the resolved `lootTables`) + per-instance grant/interaction overrides. Loot-table **definitions** are read-only catalog content; only the _binding_ and per-instance overrides are editor-authored.
5. **Collision presets.** Footprints are authored at the **object-type level** via `CollisionFootprintComponent` (no new primitive — a preset _is_ an object-type carrying a footprint). The editor surfaces a preset picker + a footprint preview overlay in the viewport, the `reviewed` flag, and per-instance footprint adjustment where the type permits.
6. **Catalog import/export.** `catalog:export` serializes the **project-authored catalog fragment** (types/loot the author defined or customized for the project) to a `GameObjectCatalog` JSON pack; `catalog:import` decodes (`decodeGameObjectCatalog`) + validates (`validateCatalog`) an incoming pack and returns a validation report before persisting. Plugin-shipped catalogs are never mutated by import/export.
7. **Validation report.** A drawer runs `catalog:validate` over the project fragment merged with the plugin catalogs and renders the structured issues (`DuplicateObjectTypeError` / `UnknownReferenceError` / coherence), each click-navigable to the offending object type or placed `MapObject`. This is the P0 seed of the P1 diagnostics surface (`t-p1-editor-diagnostics-plan`, same ADR-0025 umbrella).

### IPC DTO shape(s) added to `packages/ipc-contracts`

A new `packages/ipc-contracts/src/contracts/catalog.ts`. Following the maps/asset precedent (ADR-0002), it **reuses the pure `@tileborne/core` catalog schemas across the boundary** rather than maintaining a parallel flattened view (single source of truth):

```ts
// Browse/inspect projection of one merged catalog entry.
const GameObjectCatalogEntryView = Schema.Struct({
  objectType: GameObjectType, // reused from @tileborne/core
  origin: Schema.Literals(['plugin', 'project']),
  sourcePluginId: Schema.optional(PluginId), // present when origin = "plugin"
});

// tileborne:catalog:resolve — the merged (plugin + project) catalog for one project.
const CatalogResolveRequest = Schema.Struct({ projectId: ProjectId });
const CatalogResolveResponse = Schema.Struct({
  objectTypes: Schema.Array(GameObjectCatalogEntryView),
  lootTables: Schema.Array(LootTable), // reused from @tileborne/core
  items: Schema.Array(ItemDefinition), // reused from @tileborne/core
});

// Structured, navigable validation report (its own ipc-contracts type).
class CatalogValidationIssue extends Schema.Class<CatalogValidationIssue>('CatalogValidationIssue')(
  {
    kind: Schema.Literals(['duplicate-type', 'unknown-reference', 'coherence']),
    objectTypeId: Schema.optional(GameObjectTypeId),
    refKind: Schema.optional(Schema.String),
    missingId: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}
class CatalogValidationReport extends Schema.Class<CatalogValidationReport>(
  'CatalogValidationReport',
)({
  ok: Schema.Boolean,
  issues: Schema.Array(CatalogValidationIssue),
}) {}

// tileborne:catalog:validate — { projectId } -> { report }
// tileborne:catalog:import   — { projectId, catalogJson } -> { imported, report } (requiresApproval)
// tileborne:catalog:export   — { projectId } -> { catalogJson }
```

Channels follow the established `tileborne:<domain>:<camelCaseAction>` convention and realize the ADR-0017 expected additions (`catalog:resolve-runtime-catalog`/`catalog:validate-game-object-catalog`, `editor:object-catalog-import|export`). Branded ids reuse `@tileborne/core` (`GameObjectTypeId`, `LootTableId`, `ProjectId`, `PluginId`). All four contracts register in a new `CatalogIpcRegistry`.

### Renderer ownership & how it consumes `MaterializedGameObjectCatalog`

- **`apps/desktop/src/main` catalog app service** is the only code that touches `services-plugin`: it calls `PluginLoaderService.listDeclarative()` → each `LoadedDeclarativePlugin.gameObjectCatalogs: MaterializedGameObjectCatalog[]`, collects `CatalogContributionInput[]`, adds the project-authored fragment, runs the shared `mergeGameObjectCatalogs` → `MergedGameObjectCatalog`, then **projects** to the view DTOs (`resolve`) and runs `validateCatalog`/merge → report (`validate`). It owns fragment persistence for import/export.
- **`apps/desktop/src/renderer`** owns the palette projection (pure `catalog-palette-projection.ts`), the inspector object panel, the collision-preset picker + viewport footprint overlay, the import/export UI, and the validation drawer. It consumes only the `catalog:*` IPC DTOs — never `services-plugin`, the merge helper, or `@tileborne/core/catalog` internals beyond types.

### Plugin-neutral architecture

| Concern                                                    | Runtime owner        | First-fix owner                                 | Canonical long-term owner                                                          |
| ---------------------------------------------------------- | -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Catalog→editor projection + validation report DTOs         | renderer authoring   | hardcoded `PLUGIN_PALETTE_CONTRIBUTIONS` import | `packages/ipc-contracts` (`contracts/catalog.ts`)                                  |
| Merge plugin + project catalogs for the editor             | main process         | n/a (no editor merge today)                     | `apps/desktop/src/main` catalog app service (via shared `mergeGameObjectCatalogs`) |
| Browse / place / inspect / loot-bind / collision-preset UI | renderer             | BR authoring panel marker counts                | `apps/desktop/src/renderer`                                                        |
| Concrete catalog content (object types, loot, presets)     | plugin contributions | BR `palette-actions` + `object-types.json`      | `packages/plugin-battle-royale` via `RuntimeGameObjectCatalogContribution`         |

Forbidden edges and required boundary tests:

- `apps/desktop/src/renderer/**` catalog code must not import `services-plugin`, `mergeGameObjectCatalogs`, Node/Electron, or plugin deep paths; it consumes `catalog:*` IPC DTOs only.
- No `petwars`/`grassland`/`erw:`/`.pwmap`/plugin-name literals in renderer catalog code or in `packages/ipc-contracts/src/contracts/catalog.ts`.
- The catalog browser must be driven by the `resolve` DTO, not a hardcoded plugin import (boundary test asserts `plugin-palette-contributions.ts`' hardcoded BR import is removed).
- New contracts use Effect v4: `Schema.Class`/`Schema.Struct` + branded ids; reuse `@tileborne/core` schemas across IPC rather than duplicating them.

## Non-goals

- **Runtime consumption** of the catalog (placement → actual gameplay behavior, cross-plugin _runtime_ registry) — the runtime-map-package capstone (`t-p0-runtime-map-package-adr`). The editor merge here is read-only for authoring/validation and uses the same helper; it is not the runtime registry.
- **Combat balance** (weapon damage/range/cooldown) — ADR-0018.
- **Loot/inventory runtime** (pickup/collection) — `t-p0-inventory-loot-adr` / simulation.
- **Deeper diagnostics** (minimap validation, generated-map checks, loadout simulator) — `t-p1-editor-diagnostics-plan` (P1, extends this ADR's validation surface).
- **Player-model authoring** — already shipped; ADR-0026 extends it.

## Implementation slices (follow-up `code` tasks)

All shared-engine. Boundary tests are scaffolded early (slice 2) per ADR-0017 DoD to guard subsequent renderer code. Each slice is small and independently reviewable; the ADR-0019 catalog impl resource-exhausted as one task, so this graph is deliberately sliced thin.

1. **(ipc-contracts)** `contracts/catalog.ts`: `GameObjectCatalogEntryView`, `CatalogValidationIssue`/`Report`, resolve/validate/import/export request+response + channels + `CatalogIpcRegistry`. `vitest --run` encode/decode round-trips + registry wiring. **← recommended first slice.**
2. **(boundary-tests)** Forbidden-edge tests: no plugin/brand literals in `contracts/catalog.ts`; renderer catalog dir may not import `services-plugin`/merge helper/Node/Electron; browser must be DTO-driven.
3. **(desktop/main)** Catalog app service + `resolve`/`validate` handlers: list declarative plugins, collect `MaterializedGameObjectCatalog`s + project fragment, `mergeGameObjectCatalogs`, project to DTOs, `validateCatalog` → report. `vitest --run` with a fake loader.
4. **(renderer)** Pure `catalog-palette-projection.ts` (resolve DTO → palette items grouped by family/category) + Working Palette "Objects" group + catalog-object brush; hard-cut the hardcoded `PLUGIN_PALETTE_CONTRIBUTIONS` import. `vitest --run` projection tests.
5. **(renderer)** Inspector catalog-object panel: component summaries + per-instance overrides via `AuthoringSettingsForm`; loot-table picker + grant/interaction overrides. `vitest --run`.
6. **(renderer + viewport)** Collision-preset picker + footprint preview overlay in `editor-viewport-controller`; `reviewed` toggle + per-instance footprint adjust. `vitest --run`.
7. **(desktop/main + ipc-contracts)** `catalog:import`/`catalog:export` handlers + renderer UI: export project fragment → JSON; import → decode + validate + persist, returns report. `vitest --run`.
8. **(renderer)** Validation-report drawer: runs `catalog:validate`, renders issues, click-to-navigate to offending type/object. `vitest --run`.

## Risks and mitigations

1. **Duplicate catalog projection / second source of truth.** Mitigation: reuse `@tileborne/core` schemas across IPC; the only new types are the thin `EntryView` wrapper + the validation report.
2. **Editor vs runtime merge divergence.** Mitigation: both call the shared `mergeGameObjectCatalogs`; the editor merge is explicitly read-only/non-authoritative-for-runtime.
3. **Renderer reaching into `services-plugin`.** Mitigation: main-process app service is the sole `services-plugin` consumer; renderer-import boundary test.
4. **BR leakage into the editor surface.** Mitigation: browser driven by the public catalog slot, not a plugin import; no-brand-literal boundary tests on renderer catalog code + `contracts/catalog.ts`.
5. **Coupling to ADR-0019 slice 6.** Full neutrality of the BR markers needs BR's `object-types.json` migrated to a typed catalog pack (`t-s5oh`); ADR-0025 slices consume whatever the merged catalog contains, so they are not blocked, but the hardcoded-import hard-cut (slice 4) soft-depends on that content existing.

## Definition of done (for this ADR / the design)

- ADR-0025 written in MADR-lite style and indexed in `docs/adrs/README.md`.
- Authoring UX model, the `catalog` IPC DTO shapes, renderer ownership, `MaterializedGameObjectCatalog` consumption, and non-goals recorded.
- Key decisions captured as PlanDB `decision` contexts.
- Ordered implementation slices enumerated for a follow-up `code` subgraph; **no code implemented** here.

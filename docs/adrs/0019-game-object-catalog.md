# ADR-0019: Game-object catalog

- Status: Accepted
- Date: 2026-06-01
- Deciders: Tileborne core team
- Tags: catalog, game-objects, schema, simulation, editor-ui, ipc, plugin-boundary, boundary-test, research

## Context

ADR-0017 (petwars feature parity roadmap) identifies the **neutral game-object catalog** (row 3, P0) as one of two foundational parallel roots (the other being ADR-0018 combat simulation). PlanDB context `c-d7zz` records that the catalog is the single best first design task: it is the schema foundation that unblocks the most downstream P0/P1 work (it feeds combat data shapes, inventory/loot, gameplay IPC, editor object authoring, the runtime map package capstone, and the plugin content data registry).

This ADR is **design only**. It defines the neutral schema, ownership, and implementation slices; it does not implement code.

### Current modeling reality (what we build on, not reinvent)

Tileborne already has the _placement_ and _visual_ halves of object modeling, but no neutral _gameplay definition_ (catalog) half:

- **Placement / instance** — `packages/core/src/map/index.ts:148-158`. `MapObject` is an untyped placed instance: `kind: Schema.String`, `properties: JsonObject`, optional `placement: MapObjectPlacement`. Object layers reference instances by `ObjectId` (`packages/core/src/map/index.ts:48-54`). There is no typed definition behind `kind` — it is a free string.
- **Visual / asset identity** — `packages/sdk-tileset/src/schemas/placeable.ts:51-60`. `Placeable` owns render frames, clips, size, placement mode, and Tiled provenance. This is _pixels_, not _gameplay semantics_.
- **Branded id factory** — `packages/core/src/ids.ts:24-137`. `definePrefixedId(prefix, brand)` produces `<prefix>:<uuid>` branded schemas (`AssetId`, `PlaceableId`, `ObjectId`, …). There are no catalog/definition ids yet.
- **Plugin contribution slots** — `packages/plugin-api/src/contributions.ts`. Several object/content slots already exist but carry untyped `JsonObject` payloads:
  - `ObjectKindContribution` (`:114-122`): `schema`+`defaults` as raw `JsonObject` (JSON-Schema-shaped).
  - `EditorObjectTypeContribution` (`:169-170`), `EditorPresetContribution` (`:172-173`): declarative slots whose `data` points at a JSON index.
  - `ServerLootTableContribution` (`:321-322`), `ServerWeaponCatalogContribution` (`:333-334`): declarative slots, untyped `data`.
  - The slot factory (`defineDeclarativeContributionSlot`, `:53-62`) is the established pattern: a declarative contribution carries `id`, `kind: "declarative"`, optional `display`, and `data: JsonObject`.
- **BR plugin object types** — `packages/plugin-battle-royale/schemas/object-types.json` defines `types[]` with `id`, `displayName`, `category`, a JSON-Schema `propertiesSchema`, and `defaults`. It is wired through the editor `objectTypes` declarative slot via `data.indexPath` (`packages/plugin-battle-royale/tileborne-plugin.json:99-112`), and a spawn tool references it by `objectTypeContributionId` (`:81-83`). This is JSON-Schema-shaped, not Effect Schema, and carries no typed gameplay semantics (collision footprint, loot grant, hazard, etc.).

### Primary behavioral evidence (the shape to neutralize)

The private petwars catalog (`/Users/kregenrek/projects/games/petwars/shared/src/game-object-definitions/types.ts`) is the richest existing behavioral model: `ObjectFamily`/`GameplayRole`/`RuntimeBehavior` unions (`:88-118`), `MapPhysicsProfile` + `GameObjectCollisionFootprint` (`:133-188`), `LootGrantProfile`/`BreakableCrateDefinition` (`:151-162`), `WeaponEquippedVisualDefinition` with hand/muzzle anchors (`:190-199`), per-role gameplay object variants (`:223-289`), and `GameObjectInstance` referencing an `objectDefinitionId` (`:291-311`). Numeric balance (weapon damage/range/ammo, status effects, abilities — `:313-380`) lives alongside it but is _behavior_, not _catalog structure_.

Two lessons from this evidence:

1. The catalog is genuinely needed and its component shapes (collision footprint, loot source, breakable, hazard, interactable, equipped visual, spawn) are reusable and brand-neutral.
2. petwars bakes a **closed** family/role enum and mixes numeric balance into the definitions. Tileborne must not copy the closed enum (ADR-0017 Risk 2: over-generalized engine) nor own balance (that is ADR-0018 + plugin data, per `c-xem3` lane rules).

## Decision

Tileborne adopts a **component-based, brand-neutral game-object catalog** owned by `packages/core`. The catalog is the typed **definition / type registry** layer that sits behind `MapObject` placements. It is pure, worker-safe, React-free Effect-v4 schema + a pure validator. It defines _what object types exist, how they sit in the world, and what static data they carry_ — never numeric gameplay balance, which stays with ADR-0018 combat simulation and plugin content.

### Owning package: `packages/core` (not a new `packages/simulation`)

ADR-0017 left the owner as "`packages/core` or `packages/simulation`". This ADR decides **`packages/core`**, for dependency-ordering reasons:

- The catalog schema is consumed by `packages/ipc-contracts`, `packages/runtime`, `packages/sdk-tileset` (editor index), `apps/desktop` (editor authoring), the future `packages/simulation` (combat/inventory), and `apps/game-host`. **All of these already depend on `@tileborne/core`** and none should depend on `packages/simulation`.
- `packages/simulation` does not exist yet (ADR-0018 introduces it for deterministic _systems_). Placing a schema that the editor and IPC layers must import inside a simulation/tick package would invert dependencies (the editor would pull in tick systems just to read object definitions).
- `packages/core` is already the SSOT for durable schemas and branded IDs (ADR-0008, ADR-0013). The catalog is durable, identity-bearing data — it belongs with maps, ids, and project schemas.

Concretely: a new `packages/core/src/catalog/` module owns the schemas, branded IDs, and validator. `packages/simulation` (ADR-0018) and the inventory/loot ADR **consume** catalog definitions to drive runtime behavior; they do not own catalog structure.

### Schema shape (proposed)

Catalog **structure** is engine-owned and closed; catalog **content** (concrete object types) is open and plugin-owned. Object semantics are expressed as a set of typed **components**, not a closed family enum, so plugins add new gameplay kinds without engine edits.

Branded IDs (new in `packages/core/src/ids.ts` via `definePrefixedId`):

```ts
// packages/core/src/ids.ts (additions)
export const GameObjectTypeId   = /* gobj:<uuid>   */;
export const ItemDefinitionId   = /* item:<uuid>   */;
export const LootTableId        = /* loot:<uuid>   */;
export const CatalogId          = /* catalog:<uuid> */;
// (WeaponDefinitionId, StatusEffectId, AbilityId are reserved by ADR-0018/inventory-loot,
//  referenced from the catalog by id but defined there.)
```

Component variants (one `Schema.TaggedClass` per component; the union is open at the content level via plugin-registered component data):

```ts
// packages/core/src/catalog/components.ts (proposed)

// Where the object sits in the collision/physics world. Reused by sim + editor + map validation.
class CollisionFootprintComponent extends Schema.TaggedClass(...)("collision-footprint", {
  source: Schema.Literals(["manual", "tiled", "generated"]),
  reviewed: Schema.Boolean,
  parts: Schema.Array(CollisionFootprintPart), // {x,y,w,h, blocksMovement/Projectiles/Vision}
}) {}

// Binds gameplay semantics to a render identity (sdk-tileset Placeable / AssetId). No frames here.
class VisualRefComponent extends Schema.TaggedClass(...)("visual-ref", {
  placeableId: Schema.OptionFromUndefinedOr(PlaceableId),
  assetId: Schema.OptionFromUndefinedOr(AssetId),
  width: Schema.Number, height: Schema.Number,
  anchors: Schema.Record(Schema.String, Anchor2D), // open anchor map (e.g. "hand", "muzzle")
}) {}

class SpawnPointComponent  extends Schema.TaggedClass(...)("spawn-point",  { data: JsonObject }) {}
class LootSourceComponent  extends Schema.TaggedClass(...)("loot-source",  {
  lootTableId: Schema.OptionFromUndefinedOr(LootTableId),
  interactionMode: Schema.Literals(["auto", "tap", "hold"]),
  grants: Schema.Record(Schema.String, Schema.Boolean), // open grant flags, no closed loot enum
}) {}
class BreakableComponent   extends Schema.TaggedClass(...)("breakable",    { hp: Schema.Number, dropTableId: Schema.OptionFromUndefinedOr(LootTableId) }) {}
class HazardComponent      extends Schema.TaggedClass(...)("hazard",       { data: JsonObject }) {}
class InteractableComponent extends Schema.TaggedClass(...)("interactable", { kind: OpenTag, radiusPx: Schema.Number, parameters: JsonObject }) {}
class EquippableComponent  extends Schema.TaggedClass(...)("equippable",   { slot: OpenTag, anchors: Schema.Record(Schema.String, Anchor2D) }) {}

const GameObjectComponent = Schema.Union([ /* the above */ ]);
```

The object-type definition and the catalog pack:

```ts
// packages/core/src/catalog/object-type.ts (proposed)

// Open classification tags (branded strings, NOT closed unions) so plugins extend freely.
const FamilyTag   = Schema.String.pipe(Schema.brand("FamilyTag"));   // e.g. "obstacle", "loot"
const CategoryTag = Schema.String.pipe(Schema.brand("CategoryTag")); // editor grouping

class GameObjectType extends Schema.Class(...)("GameObjectType", {
  id: GameObjectTypeId,
  schemaVersion: Schema.Int,
  label: Schema.String,
  family: FamilyTag,
  category: Schema.OptionFromUndefinedOr(CategoryTag),
  layerHint: Schema.OptionFromUndefinedOr(Schema.String), // soft hint, not authoritative ordering
  components: Schema.Array(GameObjectComponent),
  // per-type authoring defaults for MapObject.properties overrides
  instanceDefaults: JsonObject,
}) {}

// A plugin-shipped (or engine-shipped) content pack of definitions.
class GameObjectCatalog extends Schema.Class(...)("GameObjectCatalog", {
  id: CatalogId,
  schemaVersion: Schema.Int,
  objectTypes: Schema.Array(GameObjectType),
  // loot-table + item *definition* schemas live here too (data shapes only; see "Boundaries").
  lootTables: Schema.OptionFromUndefinedOr(Schema.Array(LootTable)),
  items: Schema.OptionFromUndefinedOr(Schema.Array(ItemDefinition)),
}) {}
```

Validator + tagged errors (pure, worker-safe):

```ts
// packages/core/src/catalog/validate.ts (proposed)
class DuplicateObjectTypeError extends Schema.TaggedErrorClass(...) { /* id */ }
class UnknownReferenceError    extends Schema.TaggedErrorClass(...) { /* from, ref kind, missing id */ }
class CatalogValidationError   extends Schema.TaggedErrorClass(...) { /* aggregated issues */ }

// Validates uniqueness of GameObjectTypeIds, that LootSource.lootTableId / Breakable.dropTableId
// resolve within the pack (or a provided extra-pack resolver), and that component combos are coherent.
export const validateCatalog: (catalog: GameObjectCatalog, deps?: { resolveLootTable; resolveAsset }) => ...
```

### Plugin registration slot (how a mode registers catalog entries)

Plugins register concrete catalog content through a **public declarative slot**, validated against the core schema — extending the ADR-0015 bundled-data precedent and the existing contribution-slot factory. The long-term general data-registry home is `t-p1-plugin-data-registry-plan`; this ADR defines the P0 catalog-specific slot:

```ts
// packages/plugin-api/src/contributions.ts (proposed addition)
export const RuntimeGameObjectCatalogContribution = defineDeclarativeContributionSlot(
  'RuntimeGameObjectCatalog',
);
// data: a GameObjectCatalog content pack (or { indexPath } to one), decoded + validated
// against @tileborne/core's GameObjectCatalog schema by the registry.
```

The engine merges all contributed catalogs into a single resolved registry (plugin-neutral IDs, duplicate detection via `DuplicateObjectTypeError`), then exposes the merged catalog to editor authoring, IPC resolution, the runtime map package, and the simulation. Plugins ship **content**; the engine owns **structure + merge + validation**.

> **Implementation status / scope split (2026-06-01).** The catalog schema, the public `RuntimeGameObjectCatalogContribution` slot, the per-plugin `data.indexPath` resolver, and **per-plugin** materialization are implemented: `PluginLoaderService.loadDeclarative` resolves + decodes each plugin's `gameObjectCatalogs` on load, so `LoadedDeclarativePlugin.gameObjectCatalogs` carries materialized, schema-validated `GameObjectCatalog`s (not raw `{ indexPath }`). The **cross-plugin MERGE into a single runtime registry** and the **runtime CONSUMER** that reads it are deliberately **deferred to the runtime-map-package capstone** (`t-p0-runtime-map-package-adr`), which must consume the materialized per-plugin catalogs from `loadDeclarative` rather than re-resolving `indexPath`.

### Relationship to existing `MapObject` / placeable / marker concepts (layer, with one hard-cut)

The catalog **layers** cleanly and unifies the three existing concepts:

- **`MapObject` = instance, `GameObjectType` = definition.** `MapObject.kind: Schema.String` is **hard-cut** (pre-release, no migration shim) to reference a catalog entry. The instance keeps placement (`x/y/layerId/placement`) and per-instance overrides in `properties` (validated against the type's `instanceDefaults` + component schemas). This removes the only untyped seam in the object model.
- **`Placeable` (sdk-tileset) = render identity.** The catalog's `VisualRefComponent` references a `PlaceableId`/`AssetId`; it does **not** duplicate frames/clips. Catalog owns gameplay semantics; placeable owns pixels. No duplication.
- **"Marker" concept.** petwars-style spawn/POI/zone markers become ordinary catalog object-types carrying `SpawnPointComponent` / `InteractableComponent` placed as `MapObject`s. There is **no separate marker primitive** — markers unify into the catalog.
- **Hard-cut the ad-hoc JSON-Schema path.** The current `ObjectKindContribution` `schema`/`defaults` `JsonObject` and the `EditorObjectType` `object-types.json` JSON-Schema index are superseded by the typed `RuntimeGameObjectCatalogContribution`. Pre-release allows removing the old path rather than maintaining both.

### Boundaries: what the catalog owns vs combat/inventory/loot

- **Catalog (this ADR, `packages/core`)** owns _structure + identity + static authoring data_: object-type definitions, components, collision footprints, visual/equip anchors, and the **data shapes** for loot tables and item definitions (so the editor and runtime can author/serialize them).
- **Combat sim (ADR-0018, `packages/simulation`)** owns _numeric weapon/projectile behavior, falloff, cooldown, ammo runtime_. It references catalog/item ids; it does not define catalog structure.
- **Inventory/loot (`t-p0-inventory-loot-adr`, folds into 0018 or 0019)** decides the home for _runtime_ inventory/pickup/collection systems. **Recommendation:** loot-table + item **schemas** stay in the catalog (0019, content data); inventory/pickup/collection **runtime** lives in simulation (0018-adjacent). That task makes the final call.

## Plugin-neutral architecture

| Concern                                              | Runtime owner                        | First-fix owner                                | Canonical long-term owner                                                                                             |
| ---------------------------------------------------- | ------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Catalog schema + branded IDs + validator             | runtime map load + editor validation | current BR `object-types.json` / `objectKinds` | `packages/core` (`src/catalog/`)                                                                                      |
| Plugin catalog content registration                  | runtime + editor merge               | existing `EditorObjectType` declarative slot   | `packages/plugin-api` (`RuntimeGameObjectCatalogContribution`), generalized later by `t-p1-plugin-data-registry-plan` |
| Concrete catalog content (object types, loot, items) | plugin runtime/editor contributions  | BR `schemas/object-types.json`                 | `packages/plugin-battle-royale` (and future mode plugins)                                                             |

Forbidden edges and required boundary tests:

- `packages/core/src/catalog/**` must not import `packages/plugin-battle-royale`, `apps/desktop`, `apps/game-host`, `packages/simulation`, private petwars paths, or contain `petwars`/`grassland`/`erw:`/`.pwmap` literals or any closed BR family/role enum.
- The catalog must contain **no numeric gameplay balance** (no weapon damage/range/cooldown, no status-effect tick math). Those reference-in by id from ADR-0018.
- Catalog packs must **not** reuse `AssetId`/`AssetPackManifestAsset` as the carrier for non-asset catalog data (ADR-0015 boundary); catalog data uses its own `CatalogId`/`GameObjectTypeId`.
- Worker-safe: no React, Electron, Pixi, `node:fs`, or `node:crypto` in catalog entry points (runtime + game-host load it in workers).
- Effect v4: `Schema.Class` for definitions, `Schema.TaggedClass` for component variants, `Schema.TaggedErrorClass` for validation failures, branded IDs from `@tileborne/core`.
- Boundary tests: forbidden-token check on `packages/core/src/catalog/**`; assertion that family/category are open branded strings, not closed literal unions; assertion that no balance fields exist on catalog schemas.

## Definition of done (for this ADR / the design)

- ADR-0019 written in MADR-lite style and indexed in `docs/adrs/README.md`.
- Neutral catalog schema, plugin registration slot, owning-package decision, and the `MapObject`/placeable/marker unification recorded.
- Key decisions captured as PlanDB `decision` contexts.
- Concrete implementation slices enumerated (below) for a follow-up `code` subgraph; **no code implemented** here.

## Implementation slices (follow-up `code` tasks)

All shared-engine unless noted. Boundary tests precede code per ADR-0017 DoD.

1. **(core)** `packages/core/src/catalog/` — branded IDs (`GameObjectTypeId`, `ItemDefinitionId`, `LootTableId`, `CatalogId`) + `GameObjectType`, component tagged-union, `GameObjectCatalog`, loot-table/item schemas. `vitest --run` schema decode/encode round-trips.
2. **(core)** Pure `validateCatalog` + tagged errors (`DuplicateObjectTypeError`, `UnknownReferenceError`, `CatalogValidationError`) + reference resolution (loot-table, drop-table, visual/asset refs). `vitest --run` validator suite.
3. **(core)** Hard-cut `MapObject.kind: Schema.String` → `GameObjectTypeId` reference + instance-override validation against component schemas / `instanceDefaults`.
4. **(plugin-api)** `RuntimeGameObjectCatalogContribution` declarative slot + a merge/validate registry helper; hard-cut the ad-hoc `ObjectKindContribution` / `EditorObjectType` JSON-Schema `object-types.json` path.
5. **(boundary-tests)** Forbidden-edge tests: no plugin/brand literals or closed family enums in `packages/core/src/catalog/**`; no balance fields; no `AssetId` reuse for catalog data; worker-safe import check.
6. **(plugin — BR)** Replace `packages/plugin-battle-royale/schemas/object-types.json` with a typed `GameObjectCatalog` content pack (spawn-point, loot-crate, shrink-zone-anchor as catalog definitions with components), registered via the new slot.

Slices 1–5 are **shared engine**; slice 6 is **BR plugin** content (proves neutrality by registering through the public slot). petwars-product consumes the result: maps reference catalog entries, no logic.

## Downstream unblocked

Per PlanDB `c-d7zz`, the catalog is a foundational root (a bottleneck blocking 9 downstream tasks). Catalog **alone** directly unblocks:

- **`t-p0-editor-object-authoring-adr`** (← catalog) — the first directly-downstream P0 task needing only the catalog.
- **`t-p1-plugin-data-registry-plan`** (← catalog) — generalizes the catalog content slot to all plugin data.

Combined with the parallel **ADR-0018 combat** root, the catalog then unblocks `t-p0-inventory-loot-adr` and `t-p0-game-mode-contracts-adr` (both ← catalog + combat), and feeds the P0 capstone `t-p0-runtime-map-package-adr` (← catalog + game-mode + gameplay-ipc + editor-object-authoring).

## Risks and mitigations

1. **Over-generalized engine** (ADR-0017 Risk 2). Mitigation: component-based + open family/category tags; ship only components needed by ≥2 modes or by editor/runtime boundaries; balance stays plugin/sim data.
2. **Duplicate catalog owners** (ADR-0017 Risk 3). Mitigation: single owner `packages/core`; plugins own content instances only; merge registry detects duplicates.
3. **BR leakage into core.** Mitigation: forbidden-token + no-closed-enum + no-balance-field boundary tests on `packages/core/src/catalog/**`.
4. **Asset-registry confusion** (ADR-0015). Mitigation: catalog data uses `CatalogId`/`GameObjectTypeId`, never `AssetId`, as its carrier.
5. **`MapObject.kind` hard-cut breakage.** Mitigation: pre-release, no shipped maps depend on the old free-string `kind`; convert in the same slice and update fixtures.

# ADR-0028: Entity-first authoring pipeline

- Status: Proposed
- Date: 2026-06-09
- Deciders: Tileborne core team
- Tags: catalog, entity, editor-ui, visual-role, cli, plugin-boundary, hard-cut, research

## Context

The intended authoring pipeline for game content is:

1. **Import assets** (sprites, animated or static) — works today (sdk-tileset,
   asset library, Sprite Studio).
2. **Define an entity** (RPG-Maker/Unity/Godot-style object definition) and
   assign a sprite to it.
3. **Assign capabilities** to the entity (is a weapon, is a pickup, deals
   damage, …) — via an editor AND programmatically (CLI, agent-driven).
4. **Author attachment anchors ON the entity** (muzzle, grip, hand, …) — the
   weapon entity owns its muzzle/grip; the player model owns its hand.

### What already exists (build on, do not reinvent)

- **`GameObjectType` (ADR-0019) IS the entity concept.** It is component-based
  (`packages/core/src/catalog/`): `visual-ref` (placeableId/assetId + anchors),
  `equippable` (slot + anchors), `collision-footprint`, `loot-source`,
  `breakable`, `hazard`, `interactable`, `spawn-point`. Plugin catalogs merge
  into a resolved registry; the ADR-0025 implementation (status still
  Proposed) built the IPC projection
  (`catalog:resolve/validate/import/export`), palette browsing, inspector
  read-only component panel, and the validation drawer.
- **Weapon balance (ADR-0018)** lives in `packages/simulation` shapes with
  plugin-injected numbers (`WeaponDefinition`, keyed by `WeaponDefinitionId`).
  The catalog references weapons by id (`weapon-grant`), never embeds balance.
- **Visual metadata (ADR-0026)** lives in `core/asset/visual-role.ts`:
  `VisualAssetRoleRef`, `RenderProfile`, `AttachmentAnchor`
  ({point, rotationDeg, zOffset}), and `WeaponVisualBinding` (keyed by
  `WeaponDefinitionId` — already per-weapon in the schema!).

### The gaps (why the current abstraction is wrong)

1. **No entity authoring surface.** Catalog content only enters via
   plugin-shipped JSON or whole-fragment import. There is no "create entity,
   assign sprite, add capabilities" editor and no CLI command group for it
   (`packages/cli` has 13 command groups; none manage the catalog).
2. **Anchors are bound to project-global ROLES, not entities.** The Visual Role
   Editor edits ONE `equipped-weapon` / `projectile` / `pickup` /
   `muzzle-flash` / `impact-vfx` role per project. But the equipped weapon
   changes at runtime — visuals and anchors must resolve per weapon ENTITY
   (by `WeaponDefinitionId`), not from a singleton role.
3. **Duplicate anchor ownership.** `catalog/components.ts` `Anchor2D` ({x,y})
   competes with `asset/visual-role.ts` `AttachmentAnchor`
   ({point, rotationDeg, zOffset}). Two shapes for the same concept.

## Decision

Adopt an **entity-first authoring pipeline**: `GameObjectType` becomes the
single authoring entity behind all four pipeline steps. Visual identity,
capabilities, and attachment anchors are authored ON the entity. Per-kind
project-global visual roles for weapon-family visuals are **hard-cut** and
replaced by per-entity resolution.

### 1. One anchor contract, one anchor map (core hard cut)

`AttachmentAnchor` ({point, rotationDeg, zOffset}) is the single anchor
shape, owned by `packages/core`. **Units: `point` is normalized 0..1 in
sprite-local space** (matching `visual-role.ts` validation). The catalog's
`Anchor2D` (object-local _pixels_) is deleted; migrating existing catalog
content (e.g. BR's `"pickup": {x:24,y:24}` on a 48px sprite) requires an
explicit pixel→normalized conversion against the visual's width/height —
values are converted, never copied.

**Anchors live ONLY on `visual-ref.anchors`** (sprite-local geometry belongs
to the visual). `EquippableComponent.anchors` is deleted; `equippable` keeps
`slot` and gains `attachAnchor: AttachmentAnchorName` (default `"grip"`) —
a _name_ referencing the visual-ref anchor map, not a second map. This
removes the small-scale anchor duplicate the old shape would have kept.
Anchor names stay open branded strings ("hand", "muzzle", "grip", …).

### 2. Entities are render-complete

`VisualRefComponent` gains optional `renderProfile: RenderProfile`
(scale/pivot/footprint/shadow/nameplate) and optional
`rotationOffsetDeg: number` (for sprites not authored facing right) so an
entity fully describes how it renders. The Placeable keeps owning
frames/clips (pixels); the entity owns gameplay-relevant render metadata
(ADR-0019 split unchanged).

### 2b. Player model gains a named anchor map (core schema change)

Today the `hand` anchor lives on the _equipped-weapon role's_ anchor map and
is read as a weapon-sprite-local point by the BR projector; `PlayerModelRef`
carries only `anchor`/`hitbox`/`muzzle` and the defined-but-unconsumed
`PlayerModelVisualRef.anchors` map. This ADR makes it explicit:
`PlayerModelRef` gains `anchors: AttachmentAnchorMap` (model-local,
normalized) including `hand` — and this is the ONLY player-model anchor map:
the unconsumed `PlayerModelVisualRef` is **deleted**, and
`PlayerModelRef.muzzle` is **deleted** (the weapon entity's `muzzle` is the
single projectile/flash origin; BR has no unarmed firing). The projector
composes **player `hand` × weapon `grip`**: the weapon sprite is positioned
so its `grip` point sits on the player model's `hand` point. This is a
render-behavior change and is verified by the weapon-attachment preview +
projector tests.

### 3. Project-authored entities (the user's write path)

Users create entities in the **project catalog fragment** (persisted in
project settings, same merge path ADR-0025 defined: plugin catalogs ⊕ project
fragment). Plugin-shipped entities are read-only in the editor with
"duplicate as project entity".

The fragment is the ONLY write path, but today its read/write + merge logic
lives in `apps/desktop/src/main/catalog/catalog-service.ts` — an app-internal
service the CLI cannot import (the CLI composes its runtime from shared
packages only). The **whole catalog service** (fragment read/write AND the
plugin-catalog merge/resolve orchestration) therefore **moves to a shared
package** (`packages/services-app`, which gains prod deps on
`services-plugin` + `plugin-api` — acyclic); desktop main (IPC handlers) and
the CLI both compose the same service, so CLI `list|show|validate` reuse the
exact merge path instead of re-orchestrating it. Concurrent writers (editor open while CLI writes)
are handled as **last-write-wins on the project manifest** with the editor's
existing manifest reload; the CLI prints a warning when it detects the
project is likely open (lock/heuristic optional, not a blocking mechanism).
This is acceptable pre-release; a manifest revision check can harden it
later.

### 4. Weapon visuals resolve per entity (hard cut of global roles)

**4a. Weapon identity component (new).** `WeaponGrant` today exists only as
a `GrantRef` inside `loot-source`/`items` (pickup semantics); there is no
"this entity IS weapon X" join. A new tagged component is added to the
`GameObjectComponent` union:

```ts
// packages/core/src/catalog/components.ts (addition)
class WeaponRefComponent extends Schema.TaggedClass(...)("weapon-ref", {
  weaponId: WeaponDefinitionId,            // ADR-0018 balance join (by id)
  // companion visuals: plain entities referenced BY ID (first
  // GameObjectTypeId cross-reference in the component union)
  projectileEntityId: Schema.optional(GameObjectTypeId),
  muzzleFlashEntityId: Schema.optional(GameObjectTypeId),
  impactVfxEntityId:  Schema.optional(GameObjectTypeId),
  pickupEntityId:     Schema.optional(GameObjectTypeId),
  muzzleFlashDurationMs: Schema.optional(Schema.Number), // VFX timing lives
  impactVfxDurationMs:   Schema.optional(Schema.Number), // on the referencing side
}) {}
```

`validateCatalog` resolves the companion ids within the merged catalog
(same `UnknownReferenceError` machinery as loot-table refs) and adds one
cross-consistency rule for the bidirectional weapon↔pickup join: if
`weapon-ref.pickupEntityId` points at an entity whose `loot-source`
`grantRefs` contains a `weapon-grant`, that grant's `weaponId` must equal
the referencing weapon's `weaponId` (coherence issue otherwise). Companion
entities are ordinary entities with `visual-ref` (the projectile entity's
`rotationOffsetDeg` lives on its own visual-ref, per §2). The pickup
companion solves the "one visual-ref cannot be both rifle and loot crate"
problem: the world-pickup look is its own entity.

**4b. BR ships weapon entities**: one `GameObjectType` per weapon carrying
`visual-ref` (sprite + `muzzle`/`grip` anchors + render profile),
`equippable` (slot "weapon", attachAnchor "grip"), and `weapon-ref`
(weaponId + companion entity ids).

**4c. Target shape: `ResolvedWeaponVisuals` (roleKind-free).** The existing
`WeaponVisualBinding` cannot be the derivation target: its
`WeaponVisualRef`/`ProjectileVisualRef`/`VfxVisualRef` wrappers embed full
`VisualAssetRoleRef`s whose `roleKind` fields are _validated against the
very role kinds this ADR cuts_ — deriving them would smuggle the cut
literals back into resolution paths. `WeaponVisualBinding` and its
ref-wrappers are **deleted** alongside the role kinds and replaced by a
plain resolved render shape in core:

```ts
// derived per weapon from the merged catalog; no roleKind anywhere.
// Render identity = the ids the catalog owns (placeableId/assetId, at least
// one present — AssetLibraryReference is NOT derivable here because the
// catalog does not know packIds); visual-refs with neither id yield no
// resolved visual (derivation reports an issue).
class ResolvedEntityVisual { placeableId?; assetId?; width; height; renderProfile?; anchors; rotationOffsetDeg }
class ResolvedWeaponVisuals {
  weaponId: WeaponDefinitionId,
  equipped: ResolvedEntityVisual,           // from the weapon entity
  projectile?: ResolvedEntityVisual,        // from companion entities
  muzzleFlash?: ResolvedEntityVisual & { durationMs },
  impactVfx?:  ResolvedEntityVisual & { durationMs },
  pickup?:     ResolvedEntityVisual,
}
```

The pure derivation function (`deriveWeaponVisuals(mergedCatalog)`) lives in
core next to the catalog (worker-safe, no plugin literals).

**4d. Anchor composition.** The weapon entity owns `grip` (where the hand
holds it) and `muzzle` (projectile/flash origin); the player model owns
`hand` (§2b). The projector places the weapon sprite by composing player
`hand` × weapon `grip`, and spawns flash/projectiles at the weapon `muzzle`.
Fallback geometry guesses are removed (ADR-0026 cleanup direction).

**4e. Runtime carriage: baked into the runtime artifact.** Neither
`packages/runtime` nor `apps/game-host` loads the catalog today, the
cross-plugin runtime merge was explicitly deferred by ADR-0019, and the
plugin-api merge helper is not worker-safe. Therefore the catalog never
travels to the game-host: at playtest-prepare/export time the **main
process** resolves the merged catalog (plugin entities ⊕ project fragment),
runs `deriveWeaponVisuals`, and bakes the `ResolvedWeaponVisuals[]` (plus
entity render metadata for placed objects) **into the runtime artifact**
that already flows to the game-host/projector. The projector resolves
snapshot `weaponId` → artifact `ResolvedWeaponVisuals` (ADR-0014 unchanged;
only the data source moves).

**4f. Role removal.** The global `equipped-weapon`, `projectile`, `pickup`,
`muzzle-flash`, `impact-vfx` visual-role kinds, their validation wrappers,
and their editor pages are **removed** (pre-release hard cut, no compat
shim). Genuinely entity-independent roles (`shield`, `shadow`, `hazard`,
`player-model`) remain role-shaped.

### 5. Entity Editor (workbench)

A new workbench tab "Entity Editor" (same shell pattern as the Visual Role /
Player Model editors, ADR-0026):

```text
left rail            center canvas                    right properties
-----------          ----------------------------     -------------------------
entity list          Sprite Geometry Canvas:          capability panel:
(merged catalog,     entity sprite preview,           add/remove components,
 origin badges)      draggable anchor handles,        typed forms per component,
create entity        footprint overlay                visual-ref asset assignment,
                                                      anchor list + numeric edit
```

- Capabilities = the `GameObjectComponent` union, edited via typed forms
  (no raw JSON for known components; `hazard.data`/`spawn-point.data` stay
  open JSON by design).
- Anchors are edited on the canvas (reuses `sprite-geometry-canvas`) and
  live on the entity's `visual-ref`/`equippable` components.
- The asset step integrates with the existing flow: "assign active asset"
  plus an asset picker (Placeable/AssetId).

### 6. CLI / agent management

A new `tileborne catalog` command group (in `packages/cli`):

```
catalog list|show         — merged catalog incl. origin (plugin/project)
catalog create            — new project entity (label/family/category)
catalog set-visual        — bind placeable/asset + size
catalog add-component     — add/replace a typed component (JSON payload)
catalog remove-component
catalog set-anchor        — set named anchor (x y [rotation] [z]) on a component
catalog validate          — structured report (reuses validateCatalog)
catalog export|import     — project fragment round-trip
```

All commands support `--json` for agent consumption and write through the
same service path as the editor.

## Ownership

| Concern                                                                    | Runtime owner                      | First-fix owner                                | Canonical long-term owner                                                      |
| -------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Entity schema, unified anchor contract, `weapon-ref` component, validation | map load + editor validation       | `Anchor2D`/`AttachmentAnchor` duplication      | `packages/core` (`catalog/`, `asset/visual-role.ts`)                           |
| `ResolvedWeaponVisuals` shape + `deriveWeaponVisuals` (pure, worker-safe)  | artifact bake at prepare/export    | global-role resolution in `weapon-visuals.ts`  | `packages/core` (`catalog/`)                                                   |
| Catalog service (fragment persistence + plugin merge/resolve)              | project settings + merged registry | desktop-internal `catalog-service.ts`          | `packages/services-app` shared service, composed by desktop main IPC + CLI     |
| Entity Editor UI                                                           | renderer workbench                 | Visual Role Editor singleton pages             | `apps/desktop/src/renderer` (generic; plugin data via policies)                |
| Weapon entity content (incl. companion entities)                           | BR runtime bundle                  | BR `game-object-catalog.json` + bundled assets | `packages/plugin-battle-royale`                                                |
| Resolved visuals carriage to game-host/projector                           | runtime artifact                   | none (catalog never reaches runtime today)     | BR artifact schema (`types/artifact.ts`) + prepare/export bake in main process |
| CLI catalog commands                                                       | CLI process                        | none (missing)                                 | `packages/cli`                                                                 |

### Competing owners that are wrong

- The Visual Role Editor must not remain the authoring surface for
  weapon-family visuals (singleton role ≠ runtime reality).
- `Anchor2D` must not survive as a second anchor contract.
- The CLI must not get its own catalog persistence/validation path.
- Plugin projectors must not keep hardcoded geometry fallbacks once entity
  metadata exists.

## Boundaries and boundary tests

- `packages/core/src/catalog/**` stays free of plugin/product literals,
  numeric balance, React/Electron/Node (unchanged from ADR-0019).
  `deriveWeaponVisuals` is worker-safe and roleKind-free by construction
  (the role kinds it would need are deleted in the same cut).
- Renderer entity-editor code must not import plugin executable code.
- Boundary test: no `equipped-weapon`/`muzzle-flash`/`impact-vfx`
  global-role literal survives in renderer/runtime resolution paths after
  the hard cut (made structurally enforceable by deleting
  `WeaponVisualBinding` + its roleKind-validated wrappers).
- Anchor units: any anchor persisted through catalog components is
  normalized 0..1; migration of pixel-space `Anchor2D` content converts
  values against the visual's dimensions (validated, never copied).
- Replay/combat parity (BR `__replay__`) must stay green across the
  weapon-as-entity cut — visuals move, simulation semantics do not.

## Implementation slices (PlanDB, parent `t-oemh`)

1. `t-isoc` ADR-0028 (this document) + review `t-sh2s` (+ `t-04hg` fix-r1,
   `t-ppad` review-r2).
2. `t-i4da` Core contracts: unified anchors (normalized units, single map on
   `visual-ref`), render-complete `visual-ref` (+rotationOffsetDeg),
   `weapon-ref` component, `PlayerModelRef.anchors`, `ResolvedWeaponVisuals`
   - `deriveWeaponVisuals`, project entity fragment service move to
     `services-app`, `validateCatalog` companion-ref resolution. Review `t-p4ur`.
3. `t-sznd` Entity Editor workbench (create/assign sprite/capabilities/anchors,
   `catalog:upsert-type` IPC). Review `t-eobm`.
4. `t-kv1v` Weapon-as-entity hard cut (BR weapon + companion entities,
   artifact bake of resolved visuals, projector consumption via hand×grip
   composition, role + `WeaponVisualBinding` deletion). Review `t-c48h`.
5. `t-rztw` CLI catalog command group. Review `t-lw9k`.
6. `t-eihx` Live proof: full pipeline end-to-end (editor + CLI + playtest).

## Non-goals

- Replacing Sprite Studio import/slicing (step 1 works).
- Moving weapon balance into the catalog (stays ADR-0018 plugin data).
- Skeletal animation/retargeting.
- A general plugin data registry (still `t-p1-plugin-data-registry-plan`).

## Consequences

Positive:

- The authoring mental model matches established engines: define entity,
  assign sprite, add capabilities, place/equip it.
- Weapon switching renders correctly by construction — visuals live on the
  weapon entity that the snapshot references.
- Agents can manage game content programmatically through a stable CLI.
- One anchor contract, one write path, no global-role/entity duplication.

Negative:

- The just-built Visual Role Editor shrinks substantially (sunk cost; the
  Sprite Geometry Canvas and persistence patterns are reused).
- BR content (`game-object-catalog.json`, bundled weapon assets) needs a
  content migration to weapon entities.
- The hard cut touches editor, BR plugin, runtime projector, and IPC at once;
  replay parity and boundary tests gate the cut.

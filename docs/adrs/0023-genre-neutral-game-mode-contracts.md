# ADR-0023: Genre-neutral game-mode contracts — settings, mode discovery + pickup/equippable

- Status: Accepted
- Date: 2026-06-04
- Accepted: 2026-06-10 (implementation started under PlanDB `t-br10-m1-modes`)
- Deciders: Tileborne core team
- Tags: game-mode, settings, mode-discovery, catalog, loot, plugin-boundary, editor-ui, runtime, boundary-test, research

## Context

ADR-0017 (petwars feature parity roadmap) row 5 ("Non-BR game-mode contracts") names this work **shared engine (contract) + plugin (impl)**: `packages/plugin-api` + `packages/runtime` own the neutral mode contract and `apps/game-host` the orchestration; BR + future game-mode plugins implement modes; `petwars-product` selects a mode via config (ADR-0017 "Ownership classification" row 5). The ADR-0017 follow-up table allocates the **ADR-0023** slot to "Runtime map package + non-BR game-mode contracts + authoring-to-playtest handoff" (PlanDB `t-p0-game-mode-contracts-adr`, `t-p0-runtime-map-package-adr`).

This ADR is the **genre-neutral game-mode-contracts** decision under that slot, design-only. It specifies: (1) a genre-neutral **settings-form contribution** + a neutral **persistence namespace** replacing the hardcoded `battleRoyale` keys; (2) **manifest-driven mode/projector/panel discovery** + an **"active game mode"** concept replacing the hardcoded BR-id switch; (3) a first-class **asset/pickup decoupling** contract (item/equippable "pickup grants `<weaponId>`") on the existing catalog. The **runtime-map-package capstone** + authoring-to-playtest handoff remain a sibling within the same slot (`t-p0-runtime-map-package-adr`) and are referenced, not redefined, here. It implements no code.

The umbrella goal (the approved plan): make Tileborne a **genre-neutral 2D game maker** where a top-down shooter and a Zelda-like are each authored as a plugin on neutral primitives with **zero engine edits**, with BR (`petwars-product`) as the reference/verification product.

### Current modeling reality (what we build on, not reinvent)

Three hardcoded BR seams block a second genre:

- **Hardcoded plugin resolution (mode discovery).** `apps/desktop/src/renderer/lib/playtest-plugin-bridge.ts:117-161` (`resolvePlaytestPlugin`) is a `switch (pluginId)` with a **single `case BATTLE_ROYALE_PLUGIN_ID`** that wires the projector, bundled assets, render manifest, and frame codecs. Its own header (`:10-12`) flags: "When a second plugin appears, reconsider whether this should become a lazy id-list discovery layer instead of growing the switch." The editor inspector is equally hardcoded: `apps/desktop/src/renderer/components/shell/right-inspector.tsx:126-128` renders `<BattleRoyaleAuthoringPanel>` gated on `battleRoyaleEnabled` (a literal id check, `:34-37`).
- **BR-specific settings persistence.** Per-map settings live under a hardcoded `map.properties.battleRoyale` namespace (`packages/plugin-battle-royale/src/authoring/map-settings.ts:31-44`, `applyBattleRoyaleAuthoringSettings:92-115` writes `properties.battleRoyale.zone.schedule.*` + `properties.maxPlayers`). The **generic mechanism already exists but is TS-only / not manifest-discovered**: `apps/desktop/src/renderer/lib/authoring-settings-form.ts` defines a neutral `AuthoringSettingsForm<T>` (fields + `toDraft`/`parseDraft`/`invalidMessage`) and BR exports `BATTLE_ROYALE_AUTHORING_SETTINGS_FORM` (`map-settings.ts:60-86`); the inspector renders it generically — but it is imported as a **TS symbol** (`battle-royale-authoring-panel.tsx:11-15,40-41`), not discovered from the manifest, and the persistence key is still the literal `battleRoyale`.
- **Asset/pickup not decoupled as a contract.** The catalog (ADR-0019, Accepted) already has the right _pieces_ but no neutral "pickup grants weapon" join: `packages/core/src/catalog/components.ts` ships `LootSourceComponent` (`lootTableId` + `grants: Record<string, boolean>`, `:71-75`), `EquippableComponent` (`slot` + attach `anchors`, `:99-102`), `BreakableComponent` (`dropTableId`, `:78-81`), and `object-type.ts` ships `ItemDefinition` (`:52-57`) + `LootTable` (`:41-45`). Weapons are already asset-decoupled (`WeaponDefinition` carries no sprite; ADR-0018). What is missing is the **first-class contract** that says "this pickup, when collected, grants weapon/equippable `<id>`", so an asset is content-by-id reusable as sprite **or** weapon-visual **or** pickup, none hard-bound.

Note: **weapon-catalog loader materialization** (mirroring `resolvePluginGameObjectCatalogs` → `weaponCatalogs` on the loaded plugin) is ADR-0018 Slice 5 and is **already being implemented by a parallel worker** — this ADR consumes it, it does not redefine it (`RuntimeWeaponCatalogContribution` already exists at `contributions.ts:308-311`).

### Lessons (mirroring ADR-0019 / ADR-0018)

1. The mechanisms are genuinely reusable and brand-neutral (generic settings form, declarative discovery, catalog components) — they just stop one step short of being manifest-discovered + namespaced + joined.
2. The current slices bake **the plugin id** (BR switch, `battleRoyaleEnabled`) and **the persistence key** (`battleRoyale`) into the engine/renderer. The engine must own **discovery + namespace + the join contract** as data, never a closed plugin-id or settings key.

## Decision

Tileborne adopts **genre-neutral game-mode contracts**: (A) a manifest-discovered **settings-form contribution** persisted under a **neutral per-plugin namespace**, (B) **manifest-driven mode/projector/panel discovery** with an **"active game mode"** per project/map, and (C) a first-class **pickup-grants-equippable** contract on the existing catalog. Together these let a new genre plugin load — settings, panels, projector, runtime system, weapons/items — with **zero engine edits**. BR is migrated onto all three to prove the neutral path.

### A. Genre-neutral settings-form contribution + neutral persistence namespace

Promote the TS-only `AuthoringSettingsForm` to a **manifest-discovered declarative contribution** with schema'd data, extending the existing `EditorSettingsPanelContribution` precedent (`packages/plugin-api/src/contributions.ts:153-154`) and the `defineDeclarativeContributionSlot` factory:

```ts
// packages/plugin-api/src/contributions.ts (proposed)
export const EditorGameSettingsFormContribution =
  defineDeclarativeContributionSlot('EditorGameSettingsForm');
// data: a schema'd settings-form declaration (the neutral AuthoringSettingsForm
// shape promoted to durable data): { scope: "map" | "project", fields: [...],
// defaults, validation } decoded by a settings-form registry. The editor renders
// + validates it generically (it already does this for the TS form today).
```

**Neutral persistence namespace.** Settings persist under a **plugin-id-scoped** namespace instead of the hardcoded `battleRoyale` key:

- per-map settings → `map.properties.<pluginId>` (e.g. `map.properties["tileborne.battle-royale"]`).
- per-project settings → `project.settings.<pluginId>`.

The engine owns the namespace + read/write/validate; the plugin owns the field set + defaults + validation policy (as data). This hard-cuts the literal `battleRoyale` key and the literal `maxPlayers` top-level key (folded into the namespaced object). The settings-form **value kinds** reuse a field-descriptor shape (key, label, type, min/max/step, default, conditional visibility) — see "References" (ct-js `IExtensionField`, GDevelop behavior property descriptors, LDtk field-defs).

### B. Manifest-driven mode/projector/panel discovery + "active game mode"

Replace the hardcoded BR-id switch with **manifest-driven discovery** and an explicit **active game mode**:

- **Discovery.** `resolvePlaytestPlugin`'s `switch (pluginId)` is replaced by a **registry** that resolves, from each enabled plugin's manifest, its runtime system + `RenderableEntityProjector` factory + render manifest + frame codecs + editor settings panels — by contribution, not by id literal. (The renderer keeps the ADR-0014 invariant that one boundary file maps a resolved plugin to an opaque `RenderableEntityProjector<unknown>`; that file becomes id-agnostic discovery instead of a BR `case`.)
- **Active game mode.** A neutral `GameModeId` (open branded string) + an **active-mode selection** per project (and optionally per map) identifies which discovered mode plugin owns playtest/inspector/settings for that project/map. The inspector renders the **active mode's** settings-form contribution (discovered) instead of the hardcoded `<BattleRoyaleAuthoringPanel>`; `battleRoyaleEnabled` is removed.

```ts
// packages/core/src/mode/active-mode.ts (proposed, durable schema)
export const GameModeId = Schema.String.pipe(Schema.brand("GameModeId")); // open, e.g. a pluginId acting as a mode
class ActiveGameMode extends Schema.Class(...)("ActiveGameMode", {
  modeId: GameModeId,             // which discovered plugin/mode is active
  // (per-mode settings live under project.settings.<pluginId> / map.properties.<pluginId>)
}) {}
```

A plugin declares it provides a game mode via its contributions (runtime system + projector + settings form + panels); the engine discovers and offers it as a selectable active mode. No engine edit is needed to add a genre.

### C. First-class pickup → equippable/weapon contract (asset/pickup decoupling)

Define a neutral **"pickup grants `<id>`"** join on the existing catalog, so assets stay content-referenced-by-id and reusable in any role:

- A **`LootSourceComponent`** / loot-table `grants` entry references an `ItemDefinitionId` (or a `WeaponDefinitionId`/`EquippableComponent`-bearing object-type id). The grant is **by id**, never an embedded asset.
- An **`ItemDefinition`** (catalog) may carry an `equippable` semantics (slot) + a `grants` reference to a `WeaponDefinitionId` (ADR-0018 weapon). Collecting the pickup grants the weapon/equippable by id; the simulation (ADR-0018) + inventory/loot P0 own the runtime grant application; the catalog owns the **structure** of the join.
- An **asset** (sdk-tileset `Placeable`/`AssetId`) is referenced by `VisualRefComponent` and is therefore reusable as: a plain map sprite, a weapon's equipped visual (via `EquippableComponent.anchors` muzzle/hand), **and** the world-pickup visual — all three by the same id, none hard-bound to a gameplay role.

This is expressed as catalog data (no new runtime engine owner): the contract is "loot `grants` → `ItemDefinition`/`WeaponDefinition` by id; `ItemDefinition` may declare `equippable` + a granted weapon id". The catalog schema gains the typed reference fields + validation that the referenced ids resolve (extending ADR-0019's `validateCatalog` reference checks). Numeric balance stays plugin/ADR-0018 data.

### How two genres plug in with ZERO engine edits

| Step                                        | Top-down shooter plugin                                                                           | Zelda-like plugin                                                                        | Engine edit? |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------ |
| Declare actions + default bindings          | `Move`/`Aim`/`PrimaryAction`(fire)/`Reload`/`SlotN` via `RuntimeInputMapContribution` (ADR-0024)  | `Move`/`Interact`/`PrimaryAction`(melee)/`SecondaryAction`(bow)/`Dash` via the same slot | none         |
| Declare weapons/items                       | `RuntimeWeaponCatalogContribution` (ADR-0018) + `RuntimeGameObjectCatalogContribution` (ADR-0019) | same slots, different content (sword/bow + pots that grant items)                        | none         |
| Declare settings                            | `EditorGameSettingsForm` (e.g. score limit, time limit) → `map.properties.<pluginId>`             | `EditorGameSettingsForm` (e.g. dungeon ruleset) → same namespace                         | none         |
| Provide runtime system + projector + panels | `RuntimeSystemContribution` + projector + settings panel, discovered from manifest                | same                                                                                     | none         |
| Pickups                                     | loot `grants` → weapon/item ids; asset reused as sprite/pickup/equipped visual                    | pots break → `grants` item; chest grants weapon id                                       | none         |
| Select mode                                 | `ActiveGameMode { modeId: <shooter pluginId> }` per project/map                                   | `ActiveGameMode { modeId: <zelda pluginId> }`                                            | none         |

The engine owns discovery + namespace + the join + the resolver (ADR-0024); each genre is pure plugin content + systems.

## Plugin-neutral architecture

| Concern                                                 | Runtime owner                                  | First-fix owner                                                              | Canonical long-term owner                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Settings-form contribution + schema'd data              | editor inspector render + decode               | TS-only `AuthoringSettingsForm` + BR `BATTLE_ROYALE_AUTHORING_SETTINGS_FORM` | `packages/plugin-api` (`EditorGameSettingsForm`) + a settings-form registry                                                       |
| Neutral settings persistence namespace                  | editor map/project read-write                  | hardcoded `map.properties.battleRoyale` (`map-settings.ts`)                  | `packages/core` (map/project) + app services (`map.properties.<pluginId>` / `project.settings.<pluginId>`)                        |
| Mode/projector/panel discovery + active mode            | renderer playtest + inspector + game-host boot | `resolvePlaytestPlugin` switch + hardcoded `<BattleRoyaleAuthoringPanel>`    | `packages/plugin-api`/`packages/runtime` discovery + `packages/core` `ActiveGameMode`; renderer boundary file becomes id-agnostic |
| Pickup → equippable/weapon join (structure)             | runtime grant (sim) + editor authoring         | unused `LootSource`/`Equippable`/`ItemDefinition` for this purpose           | `packages/core/src/catalog` (typed refs + validation); ADR-0018 owns runtime grant application                                    |
| Game-mode content (settings values, modes, loot, items) | plugin runtime/editor contributions            | BR settings + object types + loot                                            | `packages/plugin-battle-royale` (and future mode plugins)                                                                         |
| petwars-product                                         | (consumes)                                     | —                                                                            | selects active mode + settings values via config/maps; no logic (ADR-0017 row 5)                                                  |

Forbidden edges and required boundary tests:

- `packages/core/**` and `packages/plugin-api/**` must not contain `petwars`/`grassland`/`erw:`/`.pwmap`/`battleRoyale`-literal/plugin-name persistence keys; the settings namespace key is **derived from `pluginId`**, never a literal mode name.
- The renderer must not name a concrete plugin id outside the single ADR-0014 boundary file, and that file must resolve plugins by **discovery**, not a per-id `case`. Boundary test: no `BATTLE_ROYALE_PLUGIN_ID` branch in inspector/playtest resolution; `battleRoyaleEnabled` removed.
- The catalog must carry the pickup-grant **structure only** (id refs + validation), **no numeric balance** (ADR-0019 boundary preserved); runtime grant application is ADR-0018 / inventory-loot P0.
- Effect v4: `Schema.Class`/`Schema.TaggedClass` for the settings-form declaration, `ActiveGameMode`, and grant refs; `Schema.TaggedErrorClass` for decode/validation; branded ids (`GameModeId`, existing `ItemDefinitionId`/`WeaponDefinitionId`/`LootTableId`).
- Boundary tests: forbidden-token + no-literal-namespace + discovery-not-switch + catalog-no-balance + reference-resolution checks; a "two-genre" fixture test asserting a second mode plugin loads (settings + panel + projector discovered) with no engine source change.

## Migration impact on Battle Royale

- BR settings move from `map.properties.battleRoyale.*` + top-level `maxPlayers` to `map.properties["<br pluginId>"]` via an `EditorGameSettingsForm` contribution carrying today's field set (`maxPlayers`, `waitSec`, `shrinkSec`, `holdSec`, `shrinkPhases`, `damagePerSecOutside`). Pre-release hard-cut of the `battleRoyale` key + the bespoke `applyBattleRoyaleAuthoringSettings` writer (replaced by the generic namespaced writer); update fixtures + the playtest export reader.
- The hardcoded `<BattleRoyaleAuthoringPanel>` inspector wiring + `battleRoyaleEnabled` are removed; BR's panel is discovered as the active mode's settings form + panels.
- `resolvePlaytestPlugin`'s BR `case` becomes a discovered entry; BR becomes one selectable `ActiveGameMode`.
- BR registers its pickups via the loot `grants` → weapon/item id join (loot crate grants a weapon id) instead of any BR-special-case decode.

## Reconciliation with the ADR-0017 allocation

The ADR-0023 slot also covers "runtime map package + authoring-to-playtest handoff" (`t-p0-runtime-map-package-adr`, the P0 capstone). This ADR scopes **non-BR game-mode contracts** (settings + discovery + pickup join); the runtime-map-package capstone remains a **sibling** within the slot and consumes these contracts (the discovered active mode + namespaced settings + materialized catalogs) at handoff time. Numbering stays consistent (ADR-0023); the ADR-0017 follow-up table is updated to mark the game-mode-contracts portion written and to note the runtime-map-package capstone still open under the same slot.

## Definition of done (for this ADR / the design)

- ADR-0023 written in MADR-lite style (Proposed) and indexed in `docs/adrs/README.md`; ADR-0017 follow-up table updated (game-mode-contracts written; runtime-map-package capstone noted open).
- The settings-form contribution + neutral namespace, manifest-driven discovery + active-mode concept, and the pickup→equippable/weapon join recorded; the two-genre zero-engine-edit path documented.
- Key decisions captured as PlanDB `decision`/`constraint` contexts.
- Implementation slices enumerated (below) for follow-up `code` subgraphs; **no code implemented** here.

## Implementation slices (follow-up `code` tasks)

All shared-engine unless noted. Boundary tests gate the BR migration per ADR-0017 DoD. Pre-release hard-cuts allowed.

1. **(plugin-api + core)** `EditorGameSettingsForm` declarative slot + schema'd settings-form declaration + a settings-form registry; neutral `map.properties.<pluginId>` / `project.settings.<pluginId>` read/write/validate helpers in core/app services. `vitest --run` decode + namespaced round-trip.
2. **(plugin-api + runtime + core)** Manifest-driven mode/projector/panel discovery registry + `GameModeId`/`ActiveGameMode` schema + active-mode selection storage. `vitest --run` discovery + active-mode resolution.
3. **(renderer)** Hard-cut `resolvePlaytestPlugin` BR `case` → discovery; remove `<BattleRoyaleAuthoringPanel>`/`battleRoyaleEnabled`; inspector renders the active mode's discovered settings form + panels.
4. **(core)** Catalog pickup→grant: typed `grants` → `ItemDefinitionId`/`WeaponDefinitionId` + `ItemDefinition.equippable`/granted-weapon ref + `validateCatalog` reference resolution. `vitest --run` validator.
5. **(boundary-tests)** Forbidden-token / no-literal-namespace / discovery-not-switch / catalog-no-balance / two-genre fixture tests.
6. **(plugin — BR)** Migrate BR settings to `EditorGameSettingsForm` + namespaced persistence; register BR as a discovered `ActiveGameMode`; wire BR loot-crate → weapon-id grant. Playtest parity vs current behavior.
7. **(plugin — sample genre, examples)** A minimal second genre plugin (tiny top-down shooter OR Zelda-like) declaring its own actions/weapons/items/settings + runtime system, proving zero-engine-edit neutrality.

Slices 1–5 are **shared engine**; slices 6–7 are **plugin** (BR migration + the neutrality-proof sample). `petwars-product` consumes the result: selects the active mode + settings values via config/maps, no logic.

## Downstream unblocked / relationships

- Enabler for the whole umbrella plan: mode discovery is the prerequisite that lets input (ADR-0024), generic settings, weapons (ADR-0018), and the sample genre plugin all load without engine edits.
- Consumes ADR-0019 catalog (Accepted), ADR-0018 weapon materialization (in progress, parallel worker), and ADR-0024 input contributions.
- Feeds the runtime-map-package capstone (`t-p0-runtime-map-package-adr`) and the petwars-product verification playtest.

## References / prior art

Mined from the curated `tileborn` reference cache (`~/Library/Caches/search-context/refs/`) per the search-context skill. Patterns extracted, not code copied.

- **ct-js — `ct-js__ct-js/src/node_requires/IExtensionField.d.ts:1-80`** + **`src/node_requires/resources/modules/`** (catmods). A fully **data-driven settings-field descriptor** (`type`, `key`, `default`, `min/max/step`, `options`, conditional `if`, nested `group`/`array`/`map`/`table`) that the editor renders generically, shipped by pluggable modules. Direct prior art for promoting `AuthoringSettingsForm` to a **schema'd, manifest-discovered** settings-form contribution.
- **GDevelop — `4ian__GDevelop/GDJS/Runtime/runtimebehavior.ts:51-60`** (a `RuntimeBehavior` constructed from `behaviorData` = properties-as-data) + **`GDevelop.js/types/gdeventsbasedbehavior.js`** + **`gdbehaviorsshareddata.js`**. A _behavior/extension_ is a data-declared, property-schema'd unit attached to objects with **zero engine edits** — the canonical "mechanic/genre as a discovered data+systems plugin" model behind active-mode discovery.
- **LDtk — `deepnight__ldtk/src/electron.renderer/data/def/EntityDef.hx`** + **`EnumDef.hx`** + **`ui/FieldDefsForm.hx`**. Typed **entity definitions** + **open enums** + **field-def-driven generic forms**, with a definition/instance split. Grounds the catalog definition+open-tag model and the schema-driven settings form.
- **Tiled — `mapeditor__tiled/src/libtiled/objecttemplate.h`** (reusable **object templates** referenced by instances) + **`src/libtiled/propertytype.h`** + **`src/tiled/propertytypeseditor.*`** (project-level **custom property _type_ registry**). Grounds the decoupled definition/instance model and a **neutral, namespaced typed-property registry** (→ `map.properties.<pluginId>` / `project.settings.<pluginId>`).

What to study, not copy: the _definition/instance decoupling_, _data-declared property schemas the editor renders generically_, and _project-scoped typed property namespaces_. What to avoid: any closed mode/genre enum or per-game persistence key as the public contract.

## Risks and mitigations

1. **Over-generalized engine** (ADR-0017 Risk 2). Mitigation: ship discovery + namespace + the join the BR migration + one sample genre need; the mode/settings _content_ stays plugin data; mode id + family tags are open.
2. **Plugin-id / settings-key leakage into the engine.** Mitigation: namespace derived from `pluginId`; discovery-not-switch + no-literal-namespace boundary tests; `battleRoyale`/`BATTLE_ROYALE_PLUGIN_ID` removed from engine/renderer paths.
3. **Duplicate settings/catalog owners** (ADR-0017 Risk 3). Mitigation: one settings-form registry + one catalog owner (`packages/core`); plugins own content only.
4. **Genre-neutrality unproven by BR alone.** Mitigation: a mandatory second sample genre plugin (slice 7) is the real verification that the abstraction holds.
5. **Catalog scope creep into balance.** Mitigation: catalog carries the grant _structure_ (id refs + validation) only; runtime grant + numbers are ADR-0018 / inventory-loot.
6. **Settings migration breakage.** Mitigation: pre-release hard-cut of `battleRoyale` keys with fixtures + export reader updated in the same BR migration slice.

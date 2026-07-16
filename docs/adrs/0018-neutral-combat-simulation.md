# ADR-0018: Neutral combat simulation

- Status: Proposed
- Date: 2026-06-03
- Deciders: Tileborne core team
- Tags: simulation, combat, weapon-runtime, deterministic, worker-safe, runtime, plugin-boundary, boundary-test, research

## Context

ADR-0017 (petwars feature parity roadmap) names the **neutral combat simulation** (row 1, P0) as one of two foundational parallel roots — the other being ADR-0019 (game-object catalog), now Accepted. PlanDB task `t-p0-sim-combat-adr` carries this ADR. This is a **design-only** ADR: it defines the neutral combat model, its owning package, plugin injection, catalog consumption, and implementation slices. It implements no code.

ADR-0017's ownership lanes (the keystone classification) place this work in the **shared OSS engine**: the engine owns deterministic combat _systems_ + neutral weapon/ability/status _schemas_; the BR plugin owns _balance numbers_ and wires the neutral systems; `petwars-product` is a thin consumer that selects a weapon set via authored content and never holds combat logic (ADR-0017 row 1, "Ownership classification").

### Current modeling reality (what we build on, not reinvent)

Tileborne already ships a **BR-only** combat slice; ADR-0014 owns its wire/render. The residual is the _neutral, catalog-driven_ layer beneath it.

- **BR damage/death/respawn** — `packages/plugin-battle-royale/src/ecs/damage-system.ts:136-174` (`applyDamage`), `:329-344` (`runDamageSystem`). Friendly-fire keys on a closed `matchMode: "solo" | "duo" | "squad"` (`:18-28`) — a BR concept that must not leak into the engine.
- **BR projectile** — `packages/plugin-battle-royale/src/ecs/projectile-system.ts:201-220` (spawn), `:278-327` (advance + hit). A single hardcoded projectile delivery; no hitscan/pellet/charge/bounce/pierce/explosive/beam/melee families.
- **BR balance constants** — `packages/plugin-battle-royale/src/constants.ts:73-91` (`PROJECTILE`, `DAMAGE`) and the per-room override schema `packages/plugin-battle-royale/src/battle-royale-config.ts:27-60`. These are numbers; they belong to the plugin.
- **Plugin wiring** — `packages/plugin-battle-royale/src/runtime-adapter.ts:97-161` runs movement → projectile → zone → damage each `onTick`, then emits a snapshot. The systems own state objects (`createDamageSystemState`, `createProjectileSystemState`).
- **Runtime ECS + loop** — `packages/runtime/src/ecs/world.ts` (`World`, archetype columns, `query`), `packages/runtime/src/ecs/systems.ts` (`SystemScheduler`, dependency-ordered), `packages/runtime/src/runtime/game-runtime.ts:89-110` (fixed-tick `update(dt, tick)` then plugin dispatch). The runtime owns the world/loop; plugins run systems.
- **Deterministic clock + RNG** — `packages/runtime/src/clock/deterministic-clock.ts:34-58` (virtual clock + seeded LCG `random()`); BR has its own seeded `rng.ts`. Determinism primitives exist; combat must reuse the seeded-RNG discipline rather than `Math.random`.
- **Catalog (ADR-0019, `packages/core`)** — `packages/core/src/catalog/components.ts` defines `CollisionFootprintComponent` (`blocksMovement/Projectiles/Vision`, `:23-47`), `EquippableComponent` (slot + attach anchors, `:99-102`), `BreakableComponent` (`hp`, `dropTableId`, `:78-81`), `HazardComponent`, `LootSourceComponent`. ADR-0019 explicitly **reserved** `WeaponDefinitionId`, `StatusEffectId`, `AbilityId` for "ADR-0018/inventory-loot, referenced from the catalog by id but defined there" (`docs/adrs/0019-game-object-catalog.md:63-64`).
- **Snapshot / projector path (ADR-0014)** — the plugin captures world state into `WelcomeSnapshot`/`DeltaSnapshot` + `PlayerKilled`/`GameOver` (`packages/plugin-battle-royale/src/server/snapshot-emitter.ts`, `packages/ipc-contracts/src/protocols/battle-royale.ts:86-121`); the runtime applies frames; the plugin's `RenderableEntityProjector` (`packages/plugin-battle-royale/src/renderer/battle-royale-projector.ts:255-316`) turns them into `RenderableEntity[]` (`packages/runtime/src/plugin/renderable-entity.ts:41-74`). **Combat results must flow through this path — no new rendering channel.**

### Lessons (mirroring ADR-0019)

1. The combat _systems_ (damage resolution, weapon firing, delivery families, falloff/LOS/knockback) are genuinely reusable and brand-neutral.
2. The current BR slice bakes a closed match-mode enum and numeric balance into the systems. The engine must own **algorithms + schemas**, never **numbers or closed mode enums** (ADR-0017 Risk 2 over-generalization; Risk 7 BR drift).

## Decision

Tileborne adopts a **deterministic, brand/mode-neutral combat simulation** of pure systems + neutral domain schemas, owned by a **new `packages/simulation`** package. It is React-free, Electron-free, Node-free, Pixi-free, worker-safe Effect-v4 code. It owns _how combat is resolved_ (damage, hit resolution, weapon firing state, delivery families, falloff/LOS/knockback) and the _schemas_ for weapon/ability/status definitions — never the numeric balance (plugin data) and never a closed game-mode enum.

### Owning package: new `packages/simulation` (not `packages/core`)

ADR-0017 left the owner as "`packages/core` or new `packages/simulation`". ADR-0019 already resolved the split by precedent: it put durable, identity-bearing **schema** in `packages/core` and stated that "`packages/simulation` (ADR-0018) introduces it for deterministic _systems_" and that core "should not depend on `packages/simulation`" (`0019-game-object-catalog.md:41-49`). This ADR honors that split and creates `packages/simulation` for the deterministic systems:

- **Combat is stateful tick logic** (RNG, cooldown timers, projectile integration, ordered hit resolution) — a different concern from the durable, declarative catalog schema. Placing tick systems in `packages/core` would force every catalog/IPC/editor importer to pull combat tick code (the exact inversion ADR-0019 rejected).
- **No dependency cycle.** `packages/runtime` owns the ECS `World` + loop + net and **consumes** systems; plugins consume systems. Therefore `packages/simulation` must **not** depend on `packages/runtime`. It depends only on `@tileborne/core` (catalog ids + `CollisionFootprintComponent`/`EquippableComponent`/`BreakableComponent`) and is worker-safe — so the same systems run in the renderer playtest host, in workers, and in `apps/game-host`.
- **Decoupled from the concrete ECS.** Systems operate over a minimal neutral **`CombatWorldView` port** (read/write health, positions, entities; spawn/destroy) — mirroring the existing `PluginWorld` abstraction — and over explicit typed inputs. The runtime/plugin adapt their world to the port. This keeps simulation a pure data-in / data-out library, maximally testable and worker-safe, and avoids binding it to `runtime`'s `World` class.

Concretely: a new `packages/simulation/src/` owns the combat domain schemas, branded ids (`WeaponDefinitionId`, `StatusEffectId`, `AbilityId`, reserved by ADR-0019), the deterministic systems, and the `CombatWorldView` port. The runtime/plugin **drive** the tick; the plugin supplies balance data; results flow back into the plugin's snapshot.

### Neutral combat model

All schemas are `Schema.Class`; variants are `Schema.TaggedClass` unions; failures are `Schema.TaggedErrorClass`; ids are branded (Effect v4, per ADR-0017).

**Vitality + damage resolution.**

- A neutral `HealthComponent { current, max }` vitality pool (no team/role coupling). Damage reduces `current`; defeat at `current <= 0`.
- `resolveDamage(target, amount, source, policy)` is a pure function returning the new health + an optional result (`DamageApplied` / `EntityDefeated`). Friendly-fire / team gating is supplied by a mode-injected **`HitResolutionPolicy`** (e.g. "are these two entities hostile?") — there is **no** closed `solo/duo/squad` enum in the engine; team identity is an open neutral value the policy interprets.

**Damage delivery families (tagged union).** A neutral `DamageDelivery` `Schema.TaggedClass` union models _how_ a weapon reaches targets, with neutral geometric/temporal parameters only (values injected from plugin weapon data):

- `hitscan` (instant ray, LOS-gated), `projectile` (integrated travel + ttl), `pellet` (multi-sample spread), `charge` (windup → release scaling), `bounce` (reflect N times off blocking geometry), `pierce` (penetrate N targets), `explosive` (AoE radius + falloff), `beam` (continuous per-tick application), `melee` (short-range cone/arc).
- Cross-cutting neutral helpers: **falloff** (damage-over-distance via an injected curve), **line-of-sight** (ray test against catalog `CollisionFootprintComponent.blocksProjectiles`/`blocksVision`), **knockback** (impulse on hit). The simulation owns the _resolution algorithms_; the _numbers_ are plugin data.

**Weapon firing runtime.** A neutral per-weapon firing state machine: `cooldownTicks`, `ammo` pool, `magazine` capacity, `reload` duration, with tick-advanced timers held in neutral components. A `WeaponDefinition` schema (+ `WeaponDefinitionId`) describes the _shape_ of a weapon (delivery family + parameter slots + ammo/reload/cooldown fields); plugins provide concrete instances with the actual numbers. Inventory/ammo _ownership_ (slots, magazines, pickups) is the separate inventory P0 (see Non-goals); combat only reads/decrements an ammo counter the inventory system owns.

**Status effects / abilities (P0 hook only).** A neutral application surface (`StatusApplied` result + `StatusEffectId`/`AbilityId` ids reserved) is defined so combat can emit status applications, but the full DoT/shield/slow/reveal/silence runtime is **P1** (`t-p1-status-abilities-plan`) extending this ADR — not built here.

**Deterministic tick + worker-safety.**

- All systems are pure functions over explicit state. **No `Date.now`, no `Math.random`** — an injected seeded RNG port (reusing the seeded-LCG discipline of `DeterministicClock.random`) is the only entropy source. Fixed-tick, `dt`-scaled integer-stable math, with stable iteration order (sorted by entity / id) so replays are bit-identical. This mirrors the reset/place/variation ordering discipline of `t-erw-engine-eval` (ADR-0016), which is linked as a soft (`suggests`) upstream of this task.
- No React, Pixi, Electron, `node:fs`, or `node:crypto` in any entry point — the same systems run in the renderer playtest host and in `apps/game-host` workers.

### How plugins inject balance / weapon / ability data + rules

- **Schemas (engine) vs values (plugin).** `packages/simulation` owns `WeaponDefinition` / `AbilityDefinition` / `StatusEffectDefinition` schemas + branded ids. The BR plugin (and future mode plugins) ship **instances with the numbers** as plugin content data.
- **Registration slot.** A new public **declarative** plugin slot `RuntimeWeaponCatalogContribution` (and ability/status counterparts) in `packages/plugin-api`, mirroring ADR-0019's `RuntimeGameObjectCatalogContribution` and the established `defineDeclarativeContributionSlot` factory (`packages/plugin-api/src/contributions.ts:53-62`). The engine decodes + validates contributed weapon data against the `@tileborne/simulation` schemas and feeds it to the systems. The existing untyped `ServerWeaponCatalogContribution` (`:335-336`, raw `JsonObject`) is **hard-cut** (pre-release) in favor of the typed slot; the long-term general data-registry home remains `t-p1-plugin-data-registry-plan`.
- **Rules injection.** Team / friendly-fire / hostility decisions are supplied by the mode as a neutral `HitResolutionPolicy` object passed into the systems (the neutralized successor to today's `RoomRulesConfig`), with **no** closed mode enum engine-side.

### How it consumes the catalog (ADR-0019) by id

Combat **references catalog entries by branded id**; it never redefines catalog structure and carries no catalog balance:

- `CollisionFootprintComponent` (`blocksProjectiles` / `blocksVision`) → LOS + projectile/beam blocking.
- `EquippableComponent` anchors (`muzzle` / `hand`) → delivery origin for projectile/hitscan spawn.
- `BreakableComponent.hp` → breakable objects take combat damage; `dropTableId` is handed to the loot system on defeat (loot resolution itself is the inventory/loot P0).
- `HazardComponent` → hazard damage application surface.
  The catalog supplies _structure_; plugin weapon data supplies _numbers_; the simulation joins them at runtime by id.

### How results reach rendering (existing snapshot/projector path — no new path)

1. Simulation systems mutate neutral state (health/position components) and produce neutral **combat result values** (`WeaponFired`, `DamageApplied`, `EntityDefeated`, `ProjectileSpawned/Moved/Expired`, `StatusApplied`).
2. The **plugin** maps those neutral results + mutated state into its **existing snapshot emitter** — the ADR-0014 `WelcomeSnapshot`/`DeltaSnapshot` + `PlayerKilled`/`GameOver` frames (`server/snapshot-emitter.ts`). The runtime's snapshot store + the plugin's `RenderableEntityProjector` then render exactly as today.
3. The **neutral wire-level gameplay event stream** (`tileborne:gameplay:events`, branded gameplay ids) is explicitly **ADR-0024's** scope. ADR-0018 stops at producing neutral result _values_ and the plugin folding them into its own snapshot — it does not add a new IPC channel or rendering path.

### Non-goals (explicit)

- **Inventory / loot / pickup runtime** — DECIDED 2026-06-10: folds into **this ADR** (the `packages/simulation` lane); see the "Addendum: authoritative inventory & loot runtime" section below. Combat _reads/decrements_ an ammo counter and hands a `dropTableId` to loot on defeat; slot/magazine/pickup/collection ownership is the addendum's scope.
- **Balance numbers** = plugin data (BR weapon/zone tuning), never engine constants.
- **Neutral gameplay wire-event protocol + HUD widgets** = ADR-0024; **editor object/loot authoring + diagnostics** = ADR-0025.
- **Full status-effect / ability runtime** = P1 (`t-p1-status-abilities-plan`); only the application hook + ids here.
- **Game-mode contracts (respawn/score/teams), matchmaking, audio, replay, netcode** = ADR-0023 / ADR-0027 / ADR-0028. Combat emits results; modes decide consequences.

## Plugin-neutral architecture

| Concern                                                                                     | Runtime owner                               | First-fix owner                                            | Canonical long-term owner                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Combat systems (damage resolution, weapon firing, delivery families, falloff/LOS/knockback) | runtime/worker tick paths                   | current BR `damage-system.ts` / `projectile-system.ts`     | `packages/simulation` (new)                                                                                 |
| Weapon/ability/status **schemas** + branded ids                                             | simulation load + plugin data decode        | BR `constants.ts` / `battle-royale-config.ts` (as numbers) | `packages/simulation`                                                                                       |
| Weapon/ability/status **content (numbers)**                                                 | plugin runtime contributions                | BR `PROJECTILE`/`DAMAGE` constants + override schema       | `packages/plugin-battle-royale` (and future mode plugins)                                                   |
| Plugin weapon-data registration slot                                                        | runtime + editor merge                      | untyped `ServerWeaponCatalogContribution`                  | `packages/plugin-api` (`RuntimeWeaponCatalogContribution`), generalized by `t-p1-plugin-data-registry-plan` |
| Combat results → rendering                                                                  | plugin snapshot emit + projector (ADR-0014) | BR `snapshot-emitter.ts` / `battle-royale-projector.ts`    | `packages/plugin-battle-royale` snapshot/projector; neutral wire events deferred to ADR-0024                |

Forbidden edges and required boundary tests:

- `packages/simulation/**` must not import `packages/plugin-battle-royale`, `apps/desktop`, `apps/game-host`, `packages/runtime`, or `packages/ipc-contracts`; and must not contain `petwars`/`grassland`/`erw:`/`.pwmap`/plugin-name literals or any closed BR mode/role enum (no `solo`/`duo`/`squad`).
- The simulation must contain **no numeric gameplay balance constants** (no default `damage = 25`, no default cooldown). Defaults come only from injected `WeaponDefinition` data; boundary test asserts no balance literals.
- **Worker-safe:** no React, Pixi, Electron, `node:fs`, or `node:crypto`; the only entropy source is an injected seeded RNG (no `Math.random` / `Date.now`). Boundary test asserts worker-safe imports + no ambient entropy.
- **No `packages/runtime` dependency** (avoid the runtime→simulation cycle); simulation depends only on `@tileborne/core`.
- Effect v4: `Schema.Class` for components/definitions, `Schema.TaggedClass` for delivery + result variants, `Schema.TaggedErrorClass` for failures, branded ids from `@tileborne/core` / `@tileborne/simulation`.
- Determinism test: a fixed seed + fixed input log yields a bit-identical result-stream across two runs (mirrors `t-erw-engine-eval` ordering discipline).

## Definition of done (for this ADR / the design)

- ADR-0018 written in MADR-lite style (Proposed) and indexed in `docs/adrs/README.md`.
- Neutral combat model, owning-package decision (`packages/simulation`), plugin injection + catalog-by-id consumption, and the results→snapshot path recorded.
- Key decisions captured as PlanDB `decision` contexts.
- Concrete implementation slices enumerated (below) for a follow-up `code` subgraph; **no code implemented** here.

## Implementation slices (follow-up `code` tasks)

All shared-engine unless noted. Boundary tests gate the BR migration per ADR-0017 DoD. Pre-release hard-cuts allowed.

1. **(simulation)** Package scaffold `packages/simulation/` + branded ids (`WeaponDefinitionId`, `StatusEffectId`, `AbilityId`) + neutral `HealthComponent` + `resolveDamage` core + injected `HitResolutionPolicy` (open team/hostility, no closed enum) + seeded-RNG port + `CombatWorldView` port. `vitest --run` schema round-trips + deterministic damage resolution.
2. **(simulation)** Weapon firing runtime: `WeaponDefinition` schema + cooldown/ammo/magazine/reload tick state machine. `vitest --run`.
3. **(simulation)** `DamageDelivery` tagged-union + resolvers — hitscan, projectile, pellet, charge, bounce, pierce, explosive (AoE), beam, melee — plus falloff curve, LOS via catalog `CollisionFootprintComponent`, knockback. `vitest --run` per family.
4. **(simulation)** Combat result value types (`WeaponFired`/`DamageApplied`/`EntityDefeated`/projectile lifecycle/`StatusApplied`) + deterministic `runCombatTick` orchestrator over `CombatWorldView`. `vitest --run` fixed-seed replay (bit-identical).
5. **(plugin-api)** Typed `RuntimeWeaponCatalogContribution` (+ ability/status) declarative slot + decode/validate against `@tileborne/simulation` schemas; hard-cut the untyped `ServerWeaponCatalogContribution` `JsonObject` path.
6. **(boundary-tests)** Forbidden-edge / worker-safe / no-balance-constant / no-closed-enum / no-runtime-dependency tests for `packages/simulation/**`. Gates slice 7.
7. **(plugin — BR)** Migrate BR projectile/damage to consume `packages/simulation` systems with BR weapon/balance data via the new slot; keep BR snapshot emit + zone + room rules in the plugin; map neutral results into the existing BR snapshot. Deterministic replay parity vs current BR behavior.

Slices 1–6 are **shared engine**; slice 7 is **BR plugin** (proves neutrality by driving the shared systems through the public slot). `petwars-product` consumes the result: it selects a weapon set via authored content/config, no logic.

**Recommended first slice: Slice 1** — the package scaffold + health/damage core + RNG/world ports + hit-resolution policy. It is the smallest shippable neutral boundary and the foundational root that the weapon firing runtime (2), delivery families (3), and orchestrator (4) build on.

## Downstream unblocked

Combat is one of two foundational P0 roots (with ADR-0019 catalog). Per ADR-0017's dependency wiring, completing this ADR + impl unblocks (combined with catalog where noted):

- `t-p0-inventory-loot-adr` ← catalog + **combat**.
- `t-p0-game-mode-contracts-adr` ← catalog + **combat**.
- `t-p0-gameplay-ipc-adr` ← catalog + **combat** + inventory-loot.
- P1: `t-p1-status-abilities-plan` (← combat + catalog, extends this ADR), `t-p1-weapon-pet-assets-plan` (← catalog + combat), `t-p1-telemetry-debug-plan` (← combat + gameplay-ipc), `t-p1-input-keybinds-plan` (← combat).
- P2: `t-p2-audio-mixer-plan` / `t-p2-replay-plan` (← combat).

## Addendum (2026-06-10): authoritative inventory & loot runtime

Resolves `t-p0-inventory-loot-adr`: the **authoritative inventory / loot / pickup runtime folds into this ADR's lane (`packages/simulation`)**, not ADR-0019. ADR-0019 stays a durable, declarative _schema_ owner (it already carries the structure: `LootSourceComponent` + typed `grantRefs`, `BreakableComponent.dropTableId`, `ItemDefinition`/`LootTable`, the ADR-0023 §C pickup-grants join); inventory/loot _resolution_ is stateful, deterministic tick logic — seeded-RNG loot rolls, pickup-candidate resolution, drop-on-defeat — exactly the concern class `packages/simulation` was created for. Placing it in `packages/core` would re-create the inversion ADR-0019 rejected.

### Current reality (what got neutralized)

> **Implementation status (2026-06-11): slices 1–4 below are implemented.** The neutral module lives in `packages/simulation` (`inventory.ts`, `ammo.ts`, `loot.ts`, `grants.ts`, `inventory-ops.ts`), the boundary suite enforces the rules (`packages/boundary-tests/src/tests/inventory-boundary.test.ts`), and the BR system was migrated in M3 S4 with a zero-test-change parity gate.

The runtime existed **BR-only** before M3: `packages/plugin-battle-royale/src/ecs/inventory-loot-system.ts` owned weighted loot rolls (`rollLootEntry`), capacity-bounded inventories with drop-oldest overflow, item drop → world-pickup spawn, sequenced drop/interact input consumption, ammo-reserve stacks, and pickup prompts/toasts — wired to BR constants (`INVENTORY`, `LOOT_PICKUP_RADIUS`) and BR item kinds. Since M3 S4 it drives the neutral simulation systems with that BR content. `packages/simulation/src/weapon.ts` already owned the magazine/reload tick state the inventory feeds.

### Neutral model (engine = algorithms + schemas; plugin = content + numbers)

- **Schemas (`packages/simulation`).** `InventoryState { slots, capacity }` (open item ids, no item-kind enum), `AmmoReserve { stacks: { ammoKind: open string, amount } }`, `LootTable`/`LootTableEntry` consumed **by id from the catalog**, and neutral result values (`ItemGranted`, `ItemDropped`, `ItemConsumed`, `PickupSpawned`, `InventoryRejected`) mirroring the combat result-value discipline.
- **Systems (`packages/simulation`).** Pure, seeded-RNG functions: `rollLootTable` (weighted, deterministic), `resolvePickupCandidates` (radius/body distance), `applyGrantRef` (interprets the catalog's typed `item-grant`/`weapon-grant` refs — the runtime half of ADR-0023 §C), capacity/overflow policy, `dropOnDefeat` (consumes `BreakableComponent.dropTableId`). Same worker-safety + determinism rules as combat (no `Math.random`/`Date.now`, stable ordering, injected RNG).
- **Authority.** Server-authoritative: `apps/game-host` (and the local playtest host) drives the systems each tick from sequenced player input; the renderer only projects inventory state from snapshots — never resolves a pickup.
- **Content (plugin).** Loot-table entries, item definitions, pickup radii, stack sizes, capacities = BR (or any mode plugin) data via the existing catalog/weapon contribution slots. No numeric balance in the engine.
- **Wire contracts.** Inventory/loadout snapshot schemas exist in `ipc-contracts` (`PlaytestRuntimeInventory` et al.); the event expression is **ADR-0029 (gameplay event stream)** scope; this addendum stops at neutral result values the plugin folds into its ADR-0014 snapshot, exactly like combat.

### Ownership delta

| Concern                                                     | Runtime owner                  | First-fix owner               | Canonical long-term owner                                     |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------------- |
| Inventory/loot/pickup systems (roll, grant, drop, capacity) | game-host + playtest host tick | BR `inventory-loot-system.ts` | `packages/simulation`                                         |
| Loot/grant **structure** (tables, grant refs, drop refs)    | catalog decode + validation    | (done)                        | `packages/core/src/catalog` (ADR-0019/0023 §C)                |
| Loot/item **content + numbers**                             | plugin contributions           | BR constants + catalog JSON   | `packages/plugin-battle-royale` (and future mode plugins)     |
| Inventory wire schemas                                      | IPC decode                     | BR protocol fields            | `packages/ipc-contracts` (snapshots exist; events = ADR-0029) |

Boundary rules extend unchanged to the inventory module: no plugin/brand literals, no closed item-kind/tier enums (open strings/ids), no balance constants, worker-safe, catalog referenced by id only.

### Implementation slices (M3, `t-br10-m3-inventory`)

1. **(simulation)** Neutral inventory/loot module: schemas + `rollLootTable` + `resolvePickupCandidates` + capacity/overflow + result values. `vitest --run` deterministic fixed-seed tests.
2. **(simulation)** Grant application + authoritative ops: `applyGrantRef` (catalog `item-grant`/`weapon-grant`), equip/swap/drop/consume command resolution over sequenced input, `dropOnDefeat`. `vitest --run`.
3. **(boundary-tests)** Inventory module: worker-safe / no-balance / no-closed-enum / no-plugin-literal / catalog-by-id checks.
4. **(plugin — BR)** Migrate `inventory-loot-system.ts` to drive the neutral systems with BR content/numbers; deterministic parity vs current behavior.

## Risks and mitigations

1. **Over-generalized engine** (ADR-0017 Risk 2). Mitigation: ship only delivery families + helpers needed by BR today and plausibly a second mode; balance + closed mode rules stay plugin data; team identity is an open neutral value, not an enum.
2. **BR leakage into the engine.** Mitigation: forbidden-token + no-closed-enum + no-balance-constant boundary tests on `packages/simulation/**`.
3. **Determinism regressions.** Mitigation: injected seeded RNG only (no `Math.random`/`Date.now`), stable iteration order, fixed-seed replay test mirroring `t-erw-engine-eval`.
4. **Dependency inversion / cycle.** Mitigation: `packages/simulation` depends only on `@tileborne/core`; runtime/plugins depend on simulation, never the reverse; systems operate over the `CombatWorldView` port, not `runtime`'s `World`.
5. **New rendering path drift.** Mitigation: combat produces neutral result _values_ only; the plugin folds them into the existing ADR-0014 snapshot/projector path; the neutral wire event stream is deferred to ADR-0024.
6. **Scope creep into inventory/status.** Mitigation: combat owns the ammo-decrement read + status-application hook only; inventory runtime = inventory P0, full status runtime = P1.

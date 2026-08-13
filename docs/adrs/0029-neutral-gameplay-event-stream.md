# ADR-0029: Neutral gameplay event stream

- Status: Accepted
- Date: 2026-06-10
- Deciders: Tileborne core team
- Tags: ipc-contracts, gameplay-events, hud, audio, telemetry, replay, plugin-boundary, research

## Context

`t-p0-gameplay-ipc-adr` (ADR-0017 row "gameplay IPC") originally scoped "gameplay events, inventory/loadout snapshots, status and ability events, catalog references, and branded IDs". Most of that surface **now exists** and is hereby confirmed as the contract:

- **Snapshots/state**: `packages/ipc-contracts/src/contracts/playtest.ts` ships neutral `PlaytestRuntimeLocalPlayer` (health, shield, armor, weapon w/ ammo+magazine+reload, inventory, pickup prompt/toast, damage indicator, stats, status effects, ability cooldowns), scoreboard, minimap, zone status — consumed by the ADR-0027 HUD chassis.
- **HUD events**: `PlaytestRuntimeHudEvent` (tagged union: `PlayerKilled`, `PickupCollected`, …) feeds the kill feed / toasts.
- **Simulation result values** (ADR-0018 Slice 4): `CombatResult` union (`WeaponFired` / `DamageApplied` / `EntityDefeated` / projectile lifecycle / `StatusApplied`) in `packages/simulation` — neutral, deterministic, but **not wire schemas**.

What remains open (the ADR-0027 README note: "the neutral gameplay-event-stream contract remains open"): a **canonical, consumer-agnostic gameplay event stream**. Today event-shaped data reaches consumers ad-hoc: the HUD ring buffer gets `PlaytestRuntimeHudEvent`, while audio (M7 SFX triggers), telemetry (`t-p1-telemetry-debug-plan`), and replay (P2) have **no contract at all** and would each invent their own.

## Decision

`packages/ipc-contracts` owns a single **`GameplayEvent` tagged-union wire schema** — the canonical event stream every gameplay consumer (HUD, audio, telemetry, replay, debug overlays) reads. One producer path, N consumers, no per-consumer event vocabularies.

- **Shape.** `Schema.TaggedClass` variants mirroring (not importing) the simulation result-value set plus match/zone lifecycle: `WeaponFired`, `DamageApplied`, `EntityDefeated`, `ItemGranted`, `ItemDropped`, `ItemConsumed`, `StatusApplied`, `StatusExpired`, `ZonePhaseChanged`, `MatchPhaseChanged`. Every variant carries `tick: Schema.Int` + the relevant **branded ids** (`WeaponDefinitionId`, `StatusEffectId`, `ItemDefinitionId`, … from `@tileborne/core`/`@tileborne/simulation` — replacing the plain-`Schema.String` ids in the current event union). The set is extensible by new variants, never by plugin-specific payload bags.
- **Producer.** The game-mode plugin's runtime adapter folds simulation result values + its own mode lifecycle into `GameplayEvent`s each tick (same fold point as today's snapshot emit, ADR-0014/0018). The engine never synthesizes gameplay semantics.
- **Transport.** Events ride the existing snapshot/frame channel as standalone `GameplayEventFrame` messages ordered alongside welcome/delta/game-over frames — **no new IPC channel** and no `gameplayEvents` array on `DeltaSnapshot`. Runtime HUD state may expose a bounded `gameplayEvents` view derived from received event frames for consumers that render or scan recent events. `PlaytestRuntimeHudEvent` is superseded by (re-expressed as a projection of) `GameplayEvent`; pre-release hard-cut, no dual vocabulary.
- **Consumers.** HUD chassis (kill feed/toasts — existing), audio mixer (M7: SFX trigger = event subscription), telemetry/replay (P1/P2: persist the stream). Consumers filter by `_tag`; unknown variants are skipped (open evolution).
- **Accepted fire feedback cadence.** Weapon-fire audio and fire VFX are driven from accepted gameplay/snapshot state, not raw input edges. A held fire input may emit every client frame, but consumers only play `weapon.fire` or show fire feedback when an accepted `WeaponFired` event or its authoritative weapon/projectile snapshot appears; cooldown/ammo state defines cadence.
- **Ordering and replay.** Producers emit gameplay event frames at the committed gameplay tick, before or with the snapshot frames that expose the same committed state. Consumers dedupe by canonical gameplay event key and keep only a bounded recent event window; stale event frames older than the current runtime tick are ignored so frame replays do not trigger duplicated HUD/audio work or unbounded memory growth.
- **Boundaries.** `ipc-contracts` carries structure + branded ids only — no balance, no closed mode/team enums (team stays an open string), no plugin literals. Mirrors the ADR-0018/0019 split: simulation owns result _values_, ipc-contracts owns the _wire_ expression, plugins own the _fold_.

## Plugin-neutral architecture

| Concern                                                  | Runtime owner                  | First-fix owner                                 | Canonical long-term owner                  |
| -------------------------------------------------------- | ------------------------------ | ----------------------------------------------- | ------------------------------------------ |
| `GameplayEvent` union + branded-id wire schemas          | frame decode both ends         | `PlaytestRuntimeHudEvent` (HUD-only vocabulary) | `packages/ipc-contracts`                   |
| Event production (sim results + mode lifecycle → events) | game-host / playtest host tick | BR snapshot-emitter ad-hoc kill/pickup emit     | game-mode plugin runtime adapter           |
| Event consumption (HUD/audio/telemetry/replay)           | each consumer                  | HUD ring buffer                                 | each consumer package, filtering by `_tag` |

## Definition of done (this ADR)

- ADR written + indexed; existing `PlaytestRuntime*` snapshot/state schemas confirmed as the contract (no rewrite).
- `GameplayEvent` decision recorded as PlanDB decision context; slices enumerated; no code here.

## Implementation slices (follow-up `code` tasks)

1. **(ipc-contracts)** `GameplayEvent` tagged union + branded ids; supersede `PlaytestRuntimeHudEvent` (hard-cut re-expression). `vitest --run` decode round-trips.
2. **(plugin — BR + runtime hosts)** BR adapter folds `CombatResult` + inventory results + zone/match lifecycle into `gameplayEvents`; HUD chassis consumes the projection. Parity vs current kill feed/toasts.
3. **(consumers, deferred to owning milestones)** audio (M7) subscribes for SFX; telemetry/replay (P1/P2) persist the stream.

## Risks and mitigations

1. **Event-vocabulary sprawl.** Mitigation: variants mirror simulation result values + lifecycle only; new variants need a consuming feature.
2. **Dual vocabularies (HUD vs stream).** Mitigation: pre-release hard-cut of `PlaytestRuntimeHudEvent` as an independent union in slice 1.
3. **Plugin payload bags.** Mitigation: no `JsonObject` escape hatch on variants; boundary test forbids it.

## References

- [ADR-0018](./0018-neutral-combat-simulation.md) (result values + inventory addendum), [ADR-0027](./0027-hud-framework-ownership-split.md) (HUD chassis + state schema), [ADR-0014](./0014-runtime-rendering-via-plugin-projector.md) (snapshot path), [ADR-0024](./0024-gameplay-input-keybinds.md) (input sibling of this slot).

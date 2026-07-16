# ADR-0031: Canonical gameplay behavior authoring and runtime ownership

- Status: Accepted
- Date: 2026-07-14
- Deciders: Tileborne core team
- Tags: behavior, typescript-sdk, event-editor, runtime, determinism, electron-boundary

## Context

Tileborne needs gameplay authoring that works for code-first creators, agents,
and non-programmers without producing two engines. The editor also has strict
Electron boundaries: project code cannot be trusted as renderer, preload, or
main-process application code. A genre plugin may contribute gameplay
capabilities, but Battle Royale cannot own contracts required by future game
modes.

## Decision

Native TypeScript through `@tileborne/game-sdk` is the only handwritten
gameplay language. Tileborne will not create a custom textual DSL and will not
create a restricted TypeScript dialect. Restrictions belong to the SDK
capability surface, compiler/import policy, and isolated runtime.

The visual editor persists a versioned `BehaviorDefinition` resource using a
WHEN / IF / DO event-sheet model. TypeScript persists as source. Each behavior
has exactly one canonical source kind (`visual` or `typescript`); conversion
from visual to TypeScript is a one-way eject. Arbitrary TypeScript is never
round-tripped into visual data.

Both source kinds compile into `BehaviorModuleArtifact`s, are listed by the
same `BehaviorManifest`, and execute through one scheduler in
`packages/runtime`. The required `RuntimeMapPackage.behaviors` section carries
the typed manifests, visual definitions, and compiled module metadata. Raw
TypeScript does not execute from the package.

Project gameplay modules never execute in Electron renderer, preload, or main.
Desktop orchestration may compile and transfer packages through typed IPC, but
execution belongs to the authoritative isolated game worker used by desktop
playtest, local multiplayer, game-host, and shipped artifacts.

The behavior execution owner is a separate failure domain from the room or
simulation owner. Desktop uses a supervised Node worker thread. Cloudflare uses
a dedicated behavior Worker reached through the `BEHAVIOR_RUNTIME` service
binding, and local multiplayer mirrors it with a separately supervised workerd
process. The room carries the last committed scheduler snapshot across calls;
timeouts, isolate termination, and heap failure cannot commit partial state or
stall the room, and the replacement behavior worker restores that snapshot.
Shipped behavior modules are parser-transformed at build time into inert,
statically bundled factories. The behavior service does not import or execute
project module top-level code during bootstrap; it invokes one factory only
after receiving an attributable, supervised target-behavior request.

### Existing vocabularies remain canonical

- Behavior event registry entries expose the canonical `GameplayEvent` stream
  owned by `packages/ipc-contracts` under ADR-0029. They are discoverable
  authoring metadata, not a second wire-event union. Plugins fold their runtime
  results into that stream; behavior code subscribes to it.
- Behavior validation produces core `BehaviorDiagnostic` data. Desktop and
  build owners project it into the existing `ReadinessDiagnostic` contract,
  whose source/navigation vocabulary now includes `behavior`. There is no
  separate behavior problems report.

### Schema and migration policy

- `BehaviorDefinition.schemaVersion` and
  `RuntimeBehaviorPackage.schemaVersion` evolve independently.
- Persisted definitions decode only through
  `decodePersistedBehaviorDefinitionJson`.
- Every supported old version must have an explicit sequential migration.
  Unknown and future versions fail loudly; readers never guess or silently
  coerce.
- Runtime map package schema v4 introduces the required `behaviors.json`
  entry. Outer package readers continue to enforce an exact version and
  integrity hash for every section.

## Ownership

| Concern                                                                                  | Runtime owner                    | First-fix owner            | Canonical long-term owner                 |
| ---------------------------------------------------------------------------------------- | -------------------------------- | -------------------------- | ----------------------------------------- |
| Durable behavior ids, definitions, manifests, references, diagnostics, registry metadata | all persistence/build boundaries | ad-hoc project/plugin data | `packages/core/src/behavior`              |
| Handwritten authoring types and capability discovery                                     | creator IDE / agent              | plugin-local helpers       | `packages/game-sdk`                       |
| Visual WHEN / IF / DO presentation                                                       | Electron renderer                | ad-hoc plugin panel        | `apps/desktop` generic Event Editor       |
| Compile, import policy, package assembly                                                 | desktop/CLI build orchestration  | per-host source loading    | `packages/services-build`                 |
| Module execution, deterministic clock/RNG/timers, budgets, scheduling                    | authoritative game worker        | plugin runtime callbacks   | `packages/runtime`                        |
| Gameplay event transport                                                                 | playtest/game-host frame channel | HUD-only event shapes      | `packages/ipc-contracts` `GameplayEvent`  |
| Actionable authoring/build problems                                                      | readiness consumers              | local component errors     | existing `ReadinessDiagnostic` projection |

## Rejected competing owners

- A custom Tileborne textual language or a restricted-TypeScript dialect.
- Separate visual and TypeScript execution runtimes.
- Electron renderer, preload, or main as a project gameplay runtime.
- Battle Royale or any other genre plugin owning generic behavior contracts.
- Loose `modeData` JSON as the behavior source or runtime payload.
- Generated TypeScript and visual JSON both claiming canonical ownership of the
  same behavior.

## Cleanup direction

Add the public SDK, compiler, isolated scheduler, build integration, and visual
editor on top of these contracts. Replace plugin-local behavior helpers as each
capability is registered. Do not add compatibility adapters that create a
second event vocabulary, diagnostic report, source kind, or scheduler.

## Consequences

Creators and agents keep standard TypeScript tooling while the runtime controls
imports, time, randomness, timers, and resources. Non-programmers get a typed
event sheet driven by the same registry. A free-form Blueprint clone and
specialized state-machine/quest/AI graphs remain follow-up presentation layers
over this same contract.

## References

- [ADR-0001](./0001-plugin-ui-model-declarative-first.md)
- [ADR-0003](./0003-electron-process-boundary-rules.md)
- [ADR-0029](./0029-neutral-gameplay-event-stream.md)
- [ADR-0030](./0030-neutral-runtime-map-package.md)

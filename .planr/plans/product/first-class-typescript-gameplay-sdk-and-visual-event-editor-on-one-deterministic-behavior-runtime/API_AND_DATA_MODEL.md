# API And Data Model

## Objects

- `BehaviorId`, `BehaviorVersion`, `BehaviorSourceKind` (`visual` or `typescript`).
- `BehaviorDefinition`: versioned serializable visual source with triggers,
  conditions, actions, branches, local state, references, and capability metadata.
- `BehaviorModule`: compiled executable contract with manifest, handlers, state
  schema, required capabilities, source map, and content hash.
- `BehaviorManifest`: identity, versions, dependencies, deterministic/runtime
  requirements, diagnostics metadata, and originating plugin/project.
- `BehaviorRegistry`: materialized core and plugin contributions for events,
  conditions, actions, field schemas, docs/icons, validation, and runtime handlers.
- `BehaviorDiagnostic`: stable severity/code/message, behavior/source/block path,
  entity/reference target, and navigation/fix metadata.
- `BehaviorRuntimeContext`: tick/clock, seeded RNG, timers, queries, state, refs,
  commands/actions, event emission, cancellation, and execution budget.

## Commands

- Create, duplicate, rename, delete, validate, save, and convert behavior.
- Compile/bundle TypeScript or compile visual definition to `BehaviorModule`.
- Discover registry capabilities and generate declarations/documentation.
- Start/stop/hot-reload behavior; pause, step, continue, inspect, and clear state.
- Assemble/load RuntimeMapPackage behaviors with hash and version verification.

## Events

- Authoring lifecycle: created, changed, validated, saved, converted.
- Build lifecycle: compile-started/succeeded/failed and hot-reload-applied/rejected.
- Runtime lifecycle: instance-started/stopped/paused, handler-entered/exited,
  action-emitted, state-changed, diagnostic-raised, budget-exhausted.
- Gameplay semantics continue through the canonical `GameplayEvent` stream rather
  than a second HUD/audio/replay vocabulary.

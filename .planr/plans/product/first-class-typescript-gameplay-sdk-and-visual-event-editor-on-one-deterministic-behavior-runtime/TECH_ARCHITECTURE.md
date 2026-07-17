# Technical Architecture

## Components

- `packages/core`: durable behavior ids, schemas, manifests, visual definitions,
  versions, registry metadata, diagnostics, and RuntimeMapPackage additions.
- `packages/game-sdk` (new): public native TypeScript authoring API, generated
  types/docs, test harness, and stable developer/agent surface.
- `packages/plugin-api`: declarative event/condition/action/capability contribution
  contracts; no generic ownership in a genre plugin.
- `packages/services-build`: visual and TypeScript compilation, import policy,
  source maps, hashes, declaration generation, package assembly, and diagnostics.
- `packages/runtime`: worker-safe loader, materialized registry, scheduler,
  deterministic context, action validation, budgets, hot reload, and inspection.
- `packages/ipc-contracts`: typed authoring/debug transport and existing canonical
  GameplayEvent transport; no executable code crosses to the renderer.
- `apps/desktop` and `packages/ui`: Event Editor, source-oriented UX, Problems,
  runtime inspector, and presentation-only state.
- `apps/game-host` and shipped game runtime: authoritative execution of the same
  modules loaded from RuntimeMapPackage.

## Data Flow

Visual source -> schema validation -> visual compiler -> BehaviorModule

TypeScript source -> restricted resolver/bundler -> BehaviorModule

BehaviorModule + registry + RuntimeMapPackage -> runtime loader -> scheduler ->
validated actions/state transitions -> simulation -> GameplayEvent/frame stream ->
editor/game client consumers.

The visual source or TypeScript source is canonical per behavior. Generated
modules and conversion output are derived artifacts and never competing sources.

## Failure Modes

- Unknown/version-incompatible contribution: validation blocks execution and
  preserves the unresolved source for repair.
- Forbidden import or ambient capability: compile fails with stable diagnostic.
- Compile failure during hot reload: current valid module remains active.
- Runtime exception/runaway loop/action flood: budget interrupts and isolates the
  behavior, records diagnostic and trace, and leaves host/editor responsive.
- Hash/version mismatch in package: runtime refuses to boot affected behavior.
- Divergent host/client result: authoritative host owns execution; clients consume
  replicated state/events rather than executing privileged behavior independently.

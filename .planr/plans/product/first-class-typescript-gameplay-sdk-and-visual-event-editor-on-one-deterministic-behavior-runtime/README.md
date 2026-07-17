# First-class TypeScript gameplay SDK and visual Event Editor on one deterministic behavior runtime

## Summary

Create Tileborne's canonical gameplay-logic authoring system: native TypeScript
through a first-class `@tileborne/game-sdk` and a creator-friendly visual Event
Editor. Both authoring surfaces target one typed behavior contract, one build
pipeline, and one deterministic runtime used by desktop playtest, multiplayer,
game-host, and shipped artifacts.

## Goals

- Make native TypeScript the only handwritten gameplay language.
- Give non-programmers an RPG-Maker-style WHEN / IF / DO event-sheet editor.
- Keep visual and code behaviors semantically equivalent at the runtime boundary.
- Provide deterministic, isolated, diagnosable execution with hot reload and tests.
- Make the system genre-neutral and usable by Battle Royale and future top-down
  plugins without moving generic ownership into either plugin.

## Non-Goals

- A custom Tileborne textual DSL or restricted TypeScript dialect.
- A general Unreal-Blueprint-style free-form node canvas in this goal.
- Arbitrary Node.js, Electron, filesystem, network, or renderer execution.
- Lossless TypeScript-to-visual round-tripping.
- Implementing a complete future top-down game plugin.

## Assumptions

- Visual behaviors remain canonical declarative resources; TypeScript behaviors
  remain canonical source files. Visual-to-TypeScript conversion is one-way.
- Existing typed project content, readiness diagnostics, GameplayEvent stream,
  RuntimeMapPackage, plugin contributions, and build/ship workflows are extended
  rather than replaced.
- The live Electron dev server is user-managed as required by project policy.

## Scope Decision

Ship the shared contracts, SDK, isolated deterministic runtime, packaging,
debugging, visual event-sheet UI, one-way conversion, documentation, and end-to-end
proof as one vertical goal. Specialized graph editors for state machines, quests,
dialogue, AI, or shaders are follow-up scopes built on the same registry.

## Verification

Automated contract, SDK, compiler, runtime, build, boundary, UI, accessibility,
and artifact tests plus a live Electron oracle. The oracle authors equivalent
TypeScript and visual behaviors, runs both in playtest through the same runtime,
observes their actions and diagnostics, saves/reopens the project, and executes a
built artifact without renderer/main-process script execution.

## Acceptance Criteria

- One typed behavior model and registry owns events, conditions, actions, state,
  references, capabilities, and diagnostics.
- TypeScript and visual behaviors execute through the same scheduler and produce
  observable equivalent results for the reference flow.
- The Event Editor supports WHEN / IF / DO, nested branches, sequencing, state,
  entity/asset pickers, validation, and playtest inspection without raw IDs.
- Runtime isolation and deterministic APIs are enforced by tests and boundaries.
- The same authored behavior survives save/reopen, RuntimeMapPackage assembly,
  desktop playtest, game-host execution, and shipped artifact execution.

## Refinement 2026-07-14T15:16:26.208563Z

USER DECISION: Native TypeScript via @tileborne/game-sdk is the only handwritten gameplay language. Do not create a custom textual DSL or a restricted TypeScript dialect.

## Refinement 2026-07-14T15:16:26.66515Z

USER DECISION: V1 visual authoring uses an RPG-Maker/Event-Sheet WHEN-IF-DO model. A universal Unreal Blueprint-style free-form node canvas is deferred; future specialized graphs must reuse the same contracts.

## Refinement 2026-07-14T15:16:27.107552Z

SOURCE OF TRUTH: Visual behaviors persist as typed BehaviorDefinition resources; TypeScript behaviors persist as source. Both compile to one BehaviorModule and run in one scheduler. Visual-to-TypeScript conversion is one-way; no TS-to-visual round trip.

## Refinement 2026-07-14T15:16:27.592445Z

SECURITY AND DETERMINISM: Project gameplay code never executes in Electron renderer, preload, or main. It runs through a restricted authoritative worker/runtime with SDK-owned clock, RNG, timers, imports, actions, and resource budgets.

## Refinement 2026-07-14T15:16:28.216969Z

GOAL ORACLE: In a live Electron session, author equivalent visual and TypeScript behaviors, prove both run through the same playtest runtime with equivalent visible action/state/event results and actionable diagnostics, save/reopen, then build and execute the artifact outside workspace-only resolution.

## Refinement 2026-07-14T18:09:25.325808Z

USER-AUTHORIZED LOOP EXTENSION (2026-07-14): Continue after the first 10 maker iterations were exhausted. Add a second tranche of 10 maker iterations (effective cumulative budget 20). The goal scope, acceptance criteria, live Electron oracle, review requirements, and stop condition are unchanged.

## Refinement 2026-07-15T16:46:10.555612Z

User-authorized continuation on 2026-07-15: add 10 maker iterations after the first 20 were exhausted. Cumulative maker iteration budget is now 30. Goal scope, acceptance criteria, review independence, and stop condition remain unchanged.

## Refinement 2026-07-15T20:33:11.796433Z

User-authorized continuation on 2026-07-15: add 10 maker iterations after the first 30 were exhausted. Cumulative maker iteration budget is now 40. Goal scope, acceptance criteria, review independence, and stop condition remain unchanged.

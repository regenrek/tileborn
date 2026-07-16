# Architecture Decisions

## ADR-001

Status: accepted for this plan

Decision: Native TypeScript through `@tileborne/game-sdk` is the only handwritten
gameplay language. Visual authoring persists typed declarative behavior resources.
Both compile to one `BehaviorModule`; no custom DSL or restricted TS dialect.

Consequences: Existing TypeScript tooling and agent knowledge are retained. The
product must own a stable SDK and sandbox boundary. Visual-to-code conversion is
one-way; arbitrary code does not round-trip to blocks.

## ADR-002

Status: accepted for this plan

Decision: V1 visual authoring is an ordered RPG-Maker/Event-Sheet WHEN / IF / DO
editor. A universal free-form Blueprint canvas is deferred; future specialized
graphs reuse the same behavior registry and contracts.

Consequences: The first UI is faster to make accessible, readable, debuggable, and
usable for common gameplay triggers. Advanced data-flow use cases remain follow-up.

## ADR-003

Status: accepted for this plan

Decision: Project behaviors never execute in Electron renderer, preload, or main.
They compile and run through a restricted worker/runtime boundary with deterministic
context APIs, authoritative-host execution, and resource/action budgets.

Consequences: More explicit capability and transport contracts are required, but
malformed or untrusted project code cannot compromise editor process boundaries and
multiplayer/replay behavior remains reproducible.

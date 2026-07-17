# Product Specification

## Problem

Tileborne can author maps, assets, content, and mode settings, but it lacks a
canonical creator-facing way to author reusable gameplay logic. A code-only API
would exclude non-programmers; an independent visual system would create a second
runtime and source of truth; a custom DSL would impose compiler, tooling, and
learning costs. The product needs one behavior model that serves creators,
professional developers, agents, playtest, multiplayer, and shipping.

## Users

- Creators who build complete games without writing code.
- TypeScript developers who need full typing, tests, refactoring, and debugging.
- Coding agents that need discoverable capabilities, examples, and deterministic
  validation rather than undocumented editor-only actions.
- Plugin authors who add genre-specific events, conditions, actions, and templates
  through a neutral contract.

## Requirements

1. Native TypeScript is the sole handwritten gameplay scripting language, exposed
   through a public `@tileborne/game-sdk`; no custom textual DSL or restricted
   TypeScript subset is introduced.
2. The visual Event Editor uses an ordered event-sheet interaction model: WHEN
   event, optional IF conditions, and sequenced DO actions with nesting and else
   branches. A free-form Blueprint canvas is out of scope.
3. Visual behaviors persist as versioned typed `BehaviorDefinition` resources;
   TypeScript persists as source and compiles to a versioned `BehaviorModule`.
   Both target one executable runtime contract.
4. Visual-to-TypeScript conversion is explicit and one-way. The editor never
   pretends arbitrary TypeScript can be reconstructed as visual blocks.
5. A typed registry exposes core and plugin-contributed events, conditions,
   actions, fields, capabilities, icons, docs, validation, and runtime handlers.
6. Scripts never execute in Electron renderer, preload, or main. Compilation and
   execution use owned worker/runtime boundaries with restricted imports and no
   ambient Node/Electron/filesystem/network authority.
7. Deterministic context APIs own clock/ticks, random values, timers, queries,
   state transitions, and emitted actions. Direct nondeterministic globals are
   rejected or unavailable; runtime budgets terminate runaway behaviors safely.
8. Diagnostics cover schema, references, imports, compilation, capabilities,
   runtime exceptions, budget exhaustion, and incompatible versions. Problems
   navigate to the owning source or visual block and participate in readiness.
9. SDK tooling includes generated declarations/docs, examples, test harness,
   source maps, hot reload, agent-readable capability discovery, and stable errors.
10. RuntimeMapPackage/build output content-addresses behavior inputs and runs the
    same contract in desktop playtest, local multiplayer, game-host, and shipped
    artifacts.
11. The Event Editor supports keyboard access, searchable add menus, drag/reorder,
    entity/asset/content pickers, empty/error/loading states, undo/redo, dirty/save
    lifecycle, runtime values, breakpoints, and step/continue controls.
12. Core behavior contracts remain genre-neutral. Battle Royale proves plugin
    contributions and Example Arena or an equivalent neutral fixture proves the
    system does not require BR-owned literals.

## Success Criteria

- A creator authors a working zone/key/door or extraction behavior visually,
  without JSON editing, raw IDs, or code, and sees it run in live playtest.
- A developer authors the equivalent behavior in native TypeScript with correct
  autocomplete, focused tests, diagnostics, hot reload, and source locations.
- Both behaviors are loaded by the same scheduler, emit the same canonical action
  and GameplayEvent shapes, and behave consistently in authoritative multiplayer.
- Saving/reopening and building preserve references and behavior versions; the
  built artifact executes the selected behavior without workspace-only resolution.
- Boundary/security tests prove project code cannot execute in renderer, preload,
  Electron main, or import forbidden platform capabilities.
- Automated suites and the live Electron oracle are logged, an independent review
  closes complete, and `planr plan audit` reports the goal contract holds.

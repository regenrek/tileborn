# QA Acceptance Tests

## Acceptance

- Schema/version round trips for visual definitions, manifests, diagnostics, and
  RuntimeMapPackage behavior payloads.
- SDK type tests and example compile tests prove inference, autocomplete contracts,
  invalid usage diagnostics, and agent-readable capability discovery.
- Golden equivalence fixture compiles visual and TypeScript versions of the same
  behavior and proves identical validated action/state/event traces.
- Runtime tests cover deterministic RNG/timers, state, ordering, event recursion,
  hot reload, exceptions, cancellation, and budget enforcement.
- Boundary/security tests reject renderer/main execution and forbidden imports.
- UI tests cover authoring, pickers, branches, reordering, keyboard/focus, undo/redo,
  validation navigation, conversion warning, save lifecycle, and runtime inspection.

## Regression

- Existing map/content authoring, readiness, playtest, multiplayer, game-host,
  build/ship, copied packaged-app smoke, and plugin boundary suites remain green.
- Projects with no behaviors continue to load and run.
- Missing/incompatible contributions fail explicitly without data loss.
- Behavior execution is authoritative and does not create a client-side duplicate.

## Manual Scenarios

Live Electron Goal Oracle:

1. Create/open a Battle Royale project and author a visual zone/key/door or
   extraction flow using WHEN / IF / DO and typed pickers.
2. Author an equivalent TypeScript behavior with the SDK; compile/test it and
   demonstrate actionable source diagnostics followed by a successful hot reload.
3. Playtest both through the same runtime, inspect branch/state/action traces, and
   verify equivalent visible gameplay results.
4. Introduce and repair a missing reference and a runaway behavior; prove Problems,
   navigation, isolation, and continued editor responsiveness.
5. Save, close/reopen, and rerun. Build/ship the project and execute the produced
   artifact outside workspace-only module resolution.
6. Record screenshots/logs plus automated receipts, then obtain independent review.

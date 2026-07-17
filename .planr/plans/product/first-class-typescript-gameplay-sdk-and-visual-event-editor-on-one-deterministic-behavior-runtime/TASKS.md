# Tasks

### TASK-001: Lock canonical behavior architecture and contracts

Goal:
Record ownership and implement the durable, genre-neutral behavior schemas,
versions, diagnostics, registry metadata, and RuntimeMapPackage contract.

Acceptance criteria:
- ADRs and package ownership reject a custom DSL, restricted TS, dual runtimes,
  renderer/main execution, and BR-owned generic contracts.
- Visual definitions, manifests, source kinds, references, diagnostics, and package
  payloads have typed schemas with migrations/version policy and round-trip tests.
- Existing GameplayEvent and readiness ownership is reused without dual vocabulary.

### TASK-002: Ship the first-class native TypeScript game SDK

Goal:
Create `@tileborne/game-sdk` as the stable handwritten gameplay authoring surface.

Acceptance criteria:
- `defineBehavior`, typed events/context/state/refs/queries/actions, deterministic
  clock/RNG/timers, lifecycle, and capability discovery have strong inference.
- Generated declarations/docs, examples, test harness, stable diagnostics, and an
  agent-readable capability inventory are available and verified.
- Forbidden APIs/imports fail clearly; valid project-safe composition stays normal
  native TypeScript rather than a proprietary subset.

### TASK-003: Build isolated deterministic compilation and runtime execution

Goal:
Compile visual and TypeScript sources to one BehaviorModule and execute them through
one authoritative scheduler outside Electron renderer, preload, and main.

Acceptance criteria:
- Restricted resolution/bundling, source maps, hashes, loader, scheduler, state,
  ordering, cancellation, hot reload, and deterministic context are tested.
- CPU/time/memory/queue/recursion/action budgets isolate failures and preserve host
  responsiveness with actionable diagnostics and last-known-good behavior.
- Golden equivalence tests prove visual and TypeScript reference behaviors produce
  identical validated action/state/event traces.

### TASK-004: Integrate behavior authoring with project, build, and runtime paths

Goal:
Make behaviors first-class project resources and carry them through save, readiness,
RuntimeMapPackage, desktop playtest, multiplayer, game-host, and Ship Game.

Acceptance criteria:
- CRUD, stable IDs, references, dependency/use sites, dirty/save/reopen lifecycle,
  import/project trust, and version diagnostics use canonical project services.
- All runtime entry points load the same packaged modules/registry and authoritative
  host path; copied artifact execution has no workspace-only resolution.
- Problems/readiness block invalid compile/reference/capability/version states and
  navigate to visual block or TypeScript source.

### TASK-005: Deliver the visual WHEN / IF / DO Event Editor

Goal:
Build the production-quality RPG-Maker/Event-Sheet visual authoring surface over the
same registry, without a free-form Blueprint canvas.

Acceptance criteria:
- Creators can build triggers, nested conditions/else branches, sequenced actions,
  local state, timers, and references using search, drag/reorder, and typed pickers.
- Real icons/previews, templates, undo/redo, keyboard/focus accessibility, empty and
  error states, validation, save lifecycle, and responsive large-list behavior work.
- Core and plugin capabilities materialize declaratively; BR and neutral fixtures
  prove no genre-specific switches leak into editor orchestration.

### TASK-006: Deliver debugging, hot reload, and one-way conversion UX

Goal:
Make both authoring modes understandable during playtest and allow an intentional
visual-to-TypeScript eject path.

Acceptance criteria:
- Runtime inspector exposes event payload, current block/source, state, branch,
  actions, diagnostics, pause/step/continue, and per-instance trace within limits.
- Successful edits hot-reload; compile failures keep last-known-good execution and
  link directly to the owning source/block.
- Convert to TypeScript warns that conversion is one-way, emits readable stable
  source, switches canonical source atomically, and never claims TS-to-visual parity.

### TASK-007: Prove plugin extensibility, security, and production documentation

Goal:
Harden the contribution boundary and document the supported creator, developer,
agent, and plugin-author workflows.

Acceptance criteria:
- Core plus Battle Royale contributions and a neutral fixture prove typed
  event/condition/action/capability registration without executable renderer UI.
- Trust, forbidden imports, nondeterminism, runaway execution, data retention, and
  process boundaries have automated adversarial tests and documented policy.
- Creator guide, SDK reference/examples, agent workflow, plugin guide, ownership,
  versioning, and deferred specialized graph roadmap are current.

### TASK-008: Run the complete live Goal Oracle and independent review

Goal:
Prove the entire authoring-to-shipping vertical in a real Electron session and
executed artifact, fix discovered failures, and close the release gate.

Acceptance criteria:
- Automated typecheck/test/build/boundary and relevant regression suites pass with
  log evidence for every touched owner.
- Live Electron evidence covers visual and TS authoring, equivalent playtest,
  diagnostics/repair, runaway isolation, inspection, hot reload, save/reopen, and
  Ship Game; the produced artifact executes outside workspace-only resolution.
- Material slices receive independent review, all findings are fixed and re-reviewed,
  no scope approvals remain open, and the final plan audit holds.

# Tasks

### TASK-001: Inventory and protect the existing candidate

Goal: Produce a path-level worktree inventory, generated/evidence/cache policy, before-state receipt, and safe integration sequence without mutating source content.

Acceptance criteria: Every changed/untracked entry is classified; unrelated user work is isolated/preserved; no destructive git action is used.

### TASK-002: Canonicalize Planr and source-plan provenance

Goal: Link this plan to `pln-d39bcb7f`, `pln-059cc827`, and the completed Working Palette build evidence; archive stale duplicate product plans with rationale.

Acceptance criteria: Plan list has one active canonical plan per concern and all reused acceptance evidence is traceable.

### TASK-003: Consolidate the implementation into reviewable commits

Goal: Reconcile package metadata, generated assets, docs, tests, and source changes on a release branch using explicit path staging and independent review gates.

Acceptance criteria: Commits are coherent, bisectable where practical, preserve all intended work, and culminate in a clean tree.

### TASK-004: Prove the hermetic baseline and close regressions

Goal: Run the full relevant workspace/CI/clean-checkout matrix and fix only evidence-backed failures at the owning layer.

Acceptance criteria: Frozen clean checkout passes required typecheck/lint/test/build/boundary/docs/CLI/game-host/desktop/package gates with receipts.

### TASK-005: Audit and harden project compatibility, backup, and recovery

Goal: Establish the canonical version/migration contract and prove backup-first atomic upgrades and recovery.

Acceptance criteria: Legacy/current/future/corrupt fixtures and phase fault injection pass; restore is verified and original data survives every failure.

### TASK-006: Finish creator onboarding and actionable recovery UX

Goal: Make first project, readiness repair, save/reopen, diagnostics, crash/draft recovery, and Ship Game understandable and keyboard accessible.

Acceptance criteria: A fresh-profile creator completes the primary flow without repository knowledge; all error states retain data and offer an owned next action.

### TASK-007: Define and enforce production performance budgets

Goal: Measure and gate large-library/project workflows including 2,000+ assets, references, behaviors, save/reopen, playtest start, and Ship.

Acceptance criteria: Budgets, fixtures, environment metadata, traces, and regression gates are documented; bounded/on-demand loading is proven.

### TASK-008: Close or explicitly gate release engineering capabilities

Goal: Audit packaging, native platforms, signing/notarization, updates, crash reporting, provenance/checksums, deploy/publish, and rollback from repo evidence.

Acceptance criteria: Each capability is implemented and proven or assigned an explicit blocker/limitation; no unsupported platform or service is advertised.

### TASK-009: Run the final production oracle and independent review

Goal: Execute fresh-checkout/fresh-profile Electron authoring through isolated shipped-artifact boot, followed by findings-first independent review.

Acceptance criteria: All oracle steps and artifact endpoints pass; review findings are fixed or formally block release; final audit holds with a binary go/no-go report.

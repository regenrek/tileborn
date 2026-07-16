---
name: creator-production-hardening-release-1-0-release-candidate-integration-and-production-hardening
overview: "Build plan for Creator Production Hardening & Release 1.0 - Release-candidate integration and production hardening."
todos:
  - id: inventory
    content: "Inventory and protect the existing candidate"
    status: pending
  - id: canonicalize
    content: "Canonicalize Planr and integration provenance"
    status: pending
  - id: integrate
    content: "Consolidate source into reviewed release commits"
    status: pending
  - id: baseline
    content: "Prove the hermetic regression baseline"
    status: pending
  - id: durability
    content: "Harden project compatibility backup and recovery"
    status: pending
  - id: creator-ux
    content: "Finish onboarding readiness and recovery UX"
    status: pending
  - id: performance
    content: "Define and enforce creator performance budgets"
    status: pending
  - id: release-engineering
    content: "Close or explicitly gate release engineering gaps"
    status: pending
  - id: final-oracle
    content: "Run final Electron and isolated artifact oracle"
    status: pending
  - id: independent-review
    content: "Resolve findings and issue the go-no-go report"
    status: pending
isProject: false
stage: build
source_plan: pln-3f1dd7ac
slice: "Release-candidate integration and production hardening"
---

# Creator Production Hardening & Release 1.0 - Release-candidate integration and production hardening

## Scope Decision

Integrate the already completed TypeScript Gameplay SDK, visual Event Editor, and Battle Royale Creator Vertical into one production 1.0 release-candidate baseline. Start from the current dirty worktree, preserve every user-owned change, canonicalize planning evidence, close only evidence-backed hardening gaps, and finish with a clean committed tree plus live editor and shipped-artifact proof. Signing, publication, deployment, tagging, pushing, and private credential use remain approval-gated; when unavailable, produce an exact blocker and an honest no-go/limited-support decision.

## Ownership Target

- Git/Planr integration and release receipts: repository/release tooling and `.planr`, not product runtime code.
- Durable project format, migrations, backups, and recovery: `@tileborne/core` schemas plus `@tileborne/services-app`; renderer only presents typed IPC state.
- Gameplay/BR regressions: their existing runtime, plugin, services-build, desktop, game-host, and boundary owners from source plans `pln-d39bcb7f` and `pln-059cc827`.
- Creator onboarding/readiness/recovery: desktop renderer using canonical application-service diagnostics and existing Problems/Runtime/Ship surfaces.
- Packaging and artifact provenance: services-build/CLI/game-host for shipped games; Electron Forge/desktop main for editor distribution.
- CI/release decision: root scripts, GitHub workflows, docs release runbook, and independent Planr review.

## Existing Leverage

- Completed source plans: `pln-d39bcb7f` and `pln-059cc827`; completed Working Palette build plan `pln-1c86a23e`.
- Full Electron behavior goal oracle, Ship Game smoke, packaged runtime-closure smoke, game-host behavior isolation, CLI ship-pipeline integration, and boundary suites already exist.
- `packages/services-app/src/internal/project-revision-transaction.ts` provides journaled atomic save/recovery; `apps/desktop/src/renderer/lib/document-lifecycle.ts` provides versioned draft recovery.
- Forge already packages runtime resources and defines DMG/Squirrel/deb/rpm makers, but explicitly defers signing.
- `.github/workflows/ci.yml` already covers Linux install/typecheck/lint/test/build/boundaries/CLI/Desktop/docs/clean-checkout foundations.
- Release readiness and tracked deferrals exist in docs; this slice must reconcile them with actual evidence.

## Phase 1: Preserve and classify the candidate

- [ ] Capture branch, revision, diff/stat, tracked/untracked path inventory, ignored/generated state, and active Planr state before mutation.
- [ ] Classify every entry as intentional source/test/docs, required generated input, reproducible disposable output, Planr evidence, or unrelated user work; document policy changes.
- [ ] Prohibit reset/checkout/destructive cleanup; isolate or retain unrelated changes and record before/after equivalence.

## Phase 2: Canonicalize planning provenance

- [ ] Link all reused acceptance evidence to source plans and archive stale duplicate Working Palette product plans with rationale.
- [ ] Ensure this product/build plan is the single active hardening scope and passes `planr plan check`.

## Phase 3: Build the clean integration baseline

- [ ] Reconcile package metadata, lockfile, generators, ignored files, docs, tests, and source changes without rewriting verified systems.
- [ ] Use explicit path staging and coherent commits; run independent review at architectural/security/performance-sensitive boundaries.
- [ ] End with a clean tree reproducible from committed inputs.

## Phase 4: Run hermetic regression gates

- [ ] From a clean checkout run frozen install, format check, typecheck, lint, full tests, builds, boundaries, docs, CLI e2e, game-host smoke/bundled-worker verification, desktop/Electron smoke, packaged runtime closure, and clean-checkout smoke.
- [ ] Fix failures at the canonical owner and add/adjust only the owning regression test.
- [ ] Align local root scripts and CI so required gates cannot silently diverge.

## Phase 5: Harden project durability

- [ ] Audit current persisted schemas and define one current-version/migration registry owner and compatibility matrix.
- [ ] Add committed legacy/current/future/corrupt fixtures, backup-first ordered migration, restore verification, and unsupported-version refusal.
- [ ] Fault-inject every journal/backup phase and prove restart converges without partial writes, path escape, or source loss.

## Phase 6: Close creator UX and performance gaps

- [ ] Verify and polish fresh-profile Battle Royale onboarding, readiness repair, diagnostics navigation, save/reopen, draft/crash recovery, playtest, and Ship Game with keyboard/accessibility coverage.
- [ ] Define versioned fixtures and budgets for startup, reopen, 2,000+ assets, large references/behaviors, validation, save, playtest start, and package/Ship.
- [ ] Enforce stable count/size budgets in CI and attach calibrated native timing/trace evidence where wall-clock gating would be flaky.

## Phase 7: Audit release engineering

- [ ] For desktop packaging, per-platform install/launch, signing/notarization, updates, crash reporting, artifact provenance/checksums, deploy/publish, and rollback: identify current evidence, gap, owner, approval/credential needs, and support decision.
- [ ] Implement the minimum approved 1.0 contracts or mark the capability as an explicit blocker/known limitation; never infer support from maker configuration.
- [ ] Update creator/SDK/maintainer docs, support matrix, changelog/release handoff, privacy/secret policy, and recovery/rollback runbooks.

## Phase 8: Final oracle and review

- [ ] From a clean checkout and fresh Electron profile: create/open the canonical BR starter, edit visual and TS behaviors, repair readiness, save/reopen, recover an interruption, run multiplayer playtest/diagnostics, and Ship Game.
- [ ] Copy the shipped artifact outside the workspace, boot it, and prove health, room creation, representative behavior execution, summary/results, manifest, and checksums.
- [ ] Run supported-platform native package smoke, independent findings-first review, fix findings, and publish a binary go/no-go receipt with exact external blockers.

## Out Of Scope

- New game genres, a second gameplay runtime, universal node graphs, or TS-to-visual conversion.
- Destructive worktree cleanup or removal of unrelated user work.
- Remote analytics by default, hosted accounts/matchmaking/social systems, or unrelated editor redesign.
- Unapproved pushes, tags, releases, deploys, npm/Homebrew publication, or use of private signing/deployment credentials.

## Verification

- `planr plan check pln-3f1dd7ac` and this build plan; resulting map audit must hold with no orphan criteria.
- Before/after git receipts plus clean committed checkout and `pnpm install --frozen-lockfile`.
- `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test -- --run`, `pnpm build`, `pnpm test:boundaries`, `pnpm docs:build`, `pnpm test:cli-e2e`, `pnpm test:game-host`, `pnpm test:desktop-smoke`, `pnpm test:clean-checkout`, desktop packaged smoke, and relevant focused owner suites.
- Compatibility/migration/backup/fault-injection fixtures and security containment tests.
- Performance budget suite with fixture/environment receipt and native Electron traces for latency-sensitive flows.
- Live Electron fresh-profile creator oracle and isolated external-cwd shipped-artifact oracle.
- Native package/install/launch evidence for each platform claimed in the final support matrix.
- Independent review of source-control preservation, durability/security, creator UX/accessibility, performance, package provenance, and release decision.

## Acceptance Criteria

- No original user-owned work is lost; every initial worktree entry has a documented disposition and final intended sources are committed in reviewable commits.
- Stale duplicate Planr product plans are archived, source-plan evidence remains linked, the build map is clean, and final audit holds.
- A fresh checkout reproduces all required generated inputs and passes the complete relevant CI/regression matrix.
- Project migration is explicit, backup-first, atomic, reversible, traversal-safe, and proven across legacy/current/future/corrupt plus injected-failure cases.
- A creator can complete the Battle Royale first-run-to-Ship flow and recover from representative failures using accessible, actionable UI.
- Approved large-project performance budgets pass and on-demand/bounded loading is proven for 2,000+ assets and large behavior/reference sets.
- Every release-engineering capability is either proven with platform-native evidence or explicitly limits/blocks release with an owner; no unsupported claim remains.
- The final clean-profile Electron oracle and isolated shipped-artifact oracle pass, independent review has no unresolved release-blocking findings, and the go/no-go report is evidence-backed.

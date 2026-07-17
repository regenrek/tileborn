# Product Specification

## Problem

Tileborne's Battle Royale Creator and Gameplay SDK have passed their feature oracles, but the candidate is not yet a production baseline. The implementation is spread across a large dirty worktree (currently 230 tracked changes and 99 untracked entries), stale duplicate Planr plans obscure status, Linux-only CI does not prove every packaged desktop target, and several release capabilities are configured or documented as deferrals rather than verified guarantees. A creator also needs a dependable first-run path, actionable recovery, bounded performance at large project sizes, and confidence that projects survive upgrade and failure.

## Users

- Creators building and shipping a Battle Royale game without understanding engine internals.
- Plugin and TypeScript SDK authors extending the deterministic gameplay surface.
- Maintainers reviewing, packaging, supporting, and rolling back a release candidate.
- Coding agents that need typed contracts, deterministic diagnostics, and replayable verification commands.

## Requirements

1. **Lossless integration:** inventory and classify all modified, untracked, generated, cache, evidence, and user-owned files; remove only proven disposable output; preserve unrelated edits; create reviewable commits on a `codex/` branch or an explicitly approved branch.
2. **Canonical planning state:** retain the completed Gameplay SDK and Battle Royale plans as source evidence, retain the completed Working Palette build plan, and archive stale duplicate Working Palette product plans with a recorded rationale.
3. **Reproducibility:** a clean checkout with the pinned Node/pnpm versions must install, generate required artifacts, typecheck, lint, test, build, pass boundaries, build docs, exercise CLI/game-host/desktop smoke suites, and package without relying on ignored workspace state.
4. **Release-gap audit:** inspect and either implement or explicitly gate desktop signing/notarization, update delivery, crash handling/recovery, artifact provenance/checksums, platform-native packaging, Cloudflare deployment, npm/GitHub/Homebrew publication, and rollback. Configuration alone is not acceptance evidence.
5. **Creator UX:** provide a guided first-run Battle Royale path from project creation through content readiness, playtest, diagnostics, recovery, and Ship Game; errors identify the failing owner and a safe next action.
6. **Performance budgets:** define measurable budgets for startup, project reopen, 2,000+ asset browsing, large reference pickers, behavior editing/validation, save, playtest start, and packaging; regressions fail a stable automated or trace-backed gate.
7. **Project durability:** establish a version/migration owner and compatibility matrix; prove atomic save recovery, backup/restore, upgrade from committed legacy fixtures, unsupported-future-version rejection, and no path traversal or partial migration.
8. **Final oracle:** from a clean profile and clean checkout, create or open the canonical Battle Royale sample, author/edit gameplay, save/reopen, recover an interrupted edit, playtest multiplayer, inspect diagnostics, ship, then boot and smoke the copied artifact outside the workspace.
9. **Honest release decision:** the final report maps every requirement to evidence, names approval/credential blockers, lists supported platforms, and makes a binary go/no-go recommendation without treating a blocked external release as a local test failure.

## Success Criteria

- The working tree is clean after intentional commits; no user-owned change is lost and generated/cache policy is documented and enforced.
- `planr plan check` and the resulting build map pass; duplicate stale plans no longer appear active.
- All required local and CI gates pass from a clean checkout, with platform-specific results recorded separately.
- The creator oracle and external-cwd shipped-artifact oracle pass on the supported platform.
- Compatibility, recovery, performance, security, packaging, and rollback evidence is attached to the final Planr review.
- Signing, notarization, updates, crash reporting, publishing, and non-macOS support are each either proven or explicitly marked as release blockers/known limitations with an owner and follow-up.

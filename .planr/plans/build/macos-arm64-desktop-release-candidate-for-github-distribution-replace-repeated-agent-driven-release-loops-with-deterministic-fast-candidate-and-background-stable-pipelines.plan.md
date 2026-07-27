---
name: macos-arm64-desktop-release-candidate-for-github-distribution-replace-repeated-agent-driven-release-loops-with-deterministic-fast-candidate-and-background-stable-pipelines
overview: "Build plan for macOS arm64 desktop release candidate for GitHub distribution - Replace repeated agent-driven release loops with deterministic fast-candidate and background stable pipelines."
todos:
  - id: TASK-001
    content: "Define and test deterministic fast, stable, and advisory gate profiles with fail-closed SHA- and lockfile-bound receipts"
    status: pending
  - id: TASK-002
    content: "Replace the nineteen-job PR matrix with one affected-scope ci-fast summary check and prepare the required-check ruleset"
    status: pending
  - id: TASK-003
    content: "Add and verify the exact-SHA macOS arm64 fast prerelease pipeline and immutable candidate bundle"
    status: pending
  - id: TASK-004
    content: "Add and verify the protected background stable pipeline through its approval boundary without publishing"
    status: pending
  - id: TASK-005
    content: "Move unsupported-platform and timing-only coverage to scheduled advisory workflows that cannot block macOS"
    status: pending
  - id: TASK-006
    content: "Integrate release docs, closeout receipt reuse, dispatch handoff, timing evidence, and final audit without publishing"
    status: pending
isProject: false
stage: build
source_plan: pln-2a769f52
slice: "Replace repeated agent-driven release loops with deterministic fast-candidate and background stable pipelines"
---

# macOS arm64 desktop release candidate for GitHub distribution - Replace repeated agent-driven release loops with deterministic fast-candidate and background stable pipelines

## Scope Decision

Replace the current all-purpose release-gate loop with two explicit release
channels and a separate PR feedback path:

1. `release-fast` produces a macOS arm64 prerelease candidate from an exact
   commit after the fast deterministic gate profile.
2. `release-stable` runs the full stable profile, builds and verifies the
   supported native artifact, then waits at a protected publication boundary.
3. PR CI is not a release pipeline. It exposes one required `ci-fast` summary
   check and targets affected packages for quick feedback.

The release workflows run on GitHub after dispatch. Dispatching is a successful
agent handoff: the agent records the commit, workflow run URL, channel, and
inputs, then stops. It does not poll, rerun broad suites, or wait for every
background job unless the maintainer explicitly asks it to monitor the run.

The current desktop support policy remains authoritative. macOS arm64 is the
only candidate platform. Windows, Linux, and macOS x64 remain unsupported and
must not block PRs, a fast candidate, or a macOS stable publication. Their
future compile/package probes belong in a scheduled or manual advisory matrix
until the product policy explicitly promotes a platform to supported.

## Ownership Target

- `scripts/release-gates.mjs` owns gate definitions, profiles, commands, and
  deterministic receipt output. Workflow YAML selects profiles; it does not
  duplicate command lists.
- `.github/workflows/ci.yml` owns the single PR summary check.
- `.github/workflows/release-fast.yml` and
  `.github/workflows/release-stable.yml` are the only top-level release entry
  points.
- A small reusable workflow may own shared checkout/setup/build mechanics when
  it removes real duplication; do not build a generic workflow framework.
- `scripts/desktop-release-policy.json` and
  `scripts/desktop-release-contract.mjs` continue to own platform support,
  signing, native evidence, and publication authorization.
- `scripts/native-desktop-release-closeout.mjs` consumes a valid SHA-bound
  stable-gate receipt instead of unconditionally rerunning `pnpm release:gates`.
- `docs/desktop-release-runbook.md` and `RELEASE.md` own the human and agent
  handoff contract.

## Existing Leverage

- The release-gate manifest already centralizes nineteen gate definitions and is
  consumed locally and in GitHub Actions.
- Turbo already models package dependencies, task outputs, local caching, and
  affected-package selection.
- The native closeout already requires a detached clean checkout, exact source
  commit, external evidence directory, signed/notarized artifacts, and a
  fail-closed publication decision.
- GitHub Actions allows the repository's permitted GitHub-owned, SHA-pinned
  actions. The public repository has standard arm64 macOS runners available.
- Existing CI concurrency already cancels stale PR runs.

Measured baseline from successful GitHub run `30161541840` on commit
`3a8091c`:

| Measure | Baseline |
| --- | ---: |
| Workflow wall time | 26m 31s |
| Aggregate job time | 6,514s / 108m 34s |
| Jobs including plan | 20 |
| Required/advisory gate jobs | 17 / 2 |
| Full tests | 18m 40s |
| Clean checkout | 25m 52s |
| Desktop smoke | 13m 13s |
| Repeated dependency installs | 18 |

The clean-checkout gate itself repeats install, build, typecheck, docs, full
tests, another build, and boundaries. The release runbook then asks maintainers
to rerun the full gates and several member commands again. Recent PR histories
therefore took roughly 2.5 to 3.3 hours from the first failed run to a green
commit even though each individual run was under 30 minutes.

## Executable Tasks

- [ ] TASK-001: Define and test deterministic fast, stable, and advisory gate
  profiles with fail-closed SHA- and lockfile-bound receipts.
- [ ] TASK-002: Replace the nineteen-job PR matrix with one affected-scope
  `ci-fast` summary check and prepare the required-check ruleset.
- [ ] TASK-003: Add and verify the exact-SHA macOS arm64 fast prerelease
  pipeline and immutable candidate bundle.
- [ ] TASK-004: Add and verify the protected background stable pipeline through
  its approval boundary without publishing.
- [ ] TASK-005: Move unsupported-platform and timing-only coverage to scheduled
  advisory workflows that cannot block macOS.
- [ ] TASK-006: Integrate release docs, closeout receipt reuse, dispatch handoff,
  timing evidence, and final audit without publishing.

## Phase 1 — deterministic gate profiles

- Extend the canonical gate schema with explicit membership in `fast`,
  `stable`, and `advisory` profiles. Keep one command definition per gate.
- Add a machine-readable receipt containing schema version, profile, source
  SHA, lockfile hash, Node/pnpm versions, start/end timestamps, gate results,
  and artifact hashes where applicable.
- Make receipt validation fail closed on SHA, lockfile, profile, or schema
  mismatch. A receipt is evidence for exactly one immutable input, never a
  general cache waiver.
- Remove duplicated commands inside gate definitions where Turbo already
  expresses the dependency, such as explicit whole-repository builds before
  tasks whose graph already depends on build.
- Keep tests deterministic. Do not increase test concurrency until shared
  state and port/filesystem ownership are isolated; use affected scope and
  caching first.

Proposed initial profiles:

| Gate | Fast PR/candidate | Stable | Advisory |
| --- | :---: | :---: | :---: |
| Frozen install / lockfile | yes | yes | no |
| Format, lint, typecheck | affected | full | no |
| Unit tests | affected | full | no |
| Release policy/docs contract | yes | yes | no |
| Build | affected / mac candidate scope | full | no |
| Boundaries, CLI, game-host, bundled worker | changed owner only | yes | no |
| Desktop smoke and packaged runtime | candidate scope | yes | no |
| Hermetic services and clean-checkout oracle | no | once | no |
| Native timing/performance calibration | no | no | scheduled |
| Unsupported OS compile/package probes | no | no | scheduled/manual |

## Phase 2 — fast PR feedback

- Collapse the current nineteen-runner PR matrix into one `ci-fast` job on
  Ubuntu with one checkout, one frozen install, and a single Turbo invocation
  for affected build/lint/typecheck/test tasks.
- Fetch sufficient Git history for `turbo --affected`; verify the chosen
  base/head in the job summary.
- Retain a small path-to-owner escalation table for root configuration,
  lockfile, release scripts, and workflow changes that must force the full
  relevant scope.
- Emit one stable summary check named `ci-fast`; configure a GitHub ruleset
  that requires only this check for PR merge.
- Keep `cancel-in-progress: true` for PR branches. A new commit should
  supersede stale feedback work.

Target: median PR feedback under 8 minutes and no more than 15 minutes for the
fast profile on a broad change. Record timings for ten representative runs
before tightening the target.

## Phase 3 — fast release

- Add `workflow_dispatch` inputs for exact source SHA and version; reject a
  moving branch name or a version that disagrees with the package metadata.
- Run on pinned `macos-15` arm64, not `macos-latest`.
- Execute the fast profile, build the DMG and update ZIP once, generate the
  existing closed-schema manifest, and run the focused native candidate smoke.
- Upload the candidate, update archive, manifest, checksums, and verification
  receipt as one named artifact bundle.
- When publication is explicitly enabled by dispatch and policy, create a
  GitHub prerelease; never create or move the stable tag and never mark it
  latest.
- Use a concurrency key derived from channel plus source SHA. An identical
  dispatch is idempotent; a different source SHA creates a distinct candidate.

Target: a usable macOS arm64 prerelease candidate in under 15 minutes on a warm
cache. This is a speed target, not a permission to weaken signing or native
artifact checks.

## Phase 4 — stable release in the background

- Add a separate manual `release-stable` workflow with exact SHA/version
  inputs and `cancel-in-progress: false`.
- Run the stable gate profile once, then build and verify only the platforms
  marked supported by the machine policy. At current scope this is macOS arm64.
- Keep native platform jobs independent and parallel when more platforms
  become supported. Electron Forge artifacts must be built on their target
  operating systems.
- Store signing/notarization/publication secrets only in a
  `stable-release` GitHub environment. The publication job waits for its
  approval and is the only job with `contents: write`.
- Publish from the verified artifact bundle and receipt, never from a second
  untracked rebuild. Verify tag, release, manifest, and artifact source SHAs are
  identical before making the release non-draft.
- Produce a terminal workflow summary containing release URL, artifact
  hashes, receipt, and any failed platform/gate. The agent is not part of this
  state machine.

Target: no agent interaction between dispatch and either a protected approval
request or a terminal failure. Stable wall time may exceed the fast target
because it is intentionally asynchronous.

## Phase 5 — scheduled confidence and handoff cleanup

- Move clean-checkout timing, native performance calibration, and unsupported
  OS probes into one nightly or weekly advisory workflow.
- Keep full clean-checkout reconstruction in stable/release readiness, but
  do not run it on every PR and do not duplicate its member commands elsewhere.
- Rewrite `RELEASE.md`, the desktop release runbook, and closeout tests so
  each profile is executed at most once per SHA.
- Add `pnpm release:dispatch --channel fast|stable --sha <sha> --version
  <version>` or an equivalently small wrapper that prints a structured dispatch
  receipt and GitHub run URL.
- Define the agent stop condition: successful dispatch plus recorded run URL
  is complete. Monitoring, approval, retrying a failed job, or promoting a
  candidate requires an explicit follow-up request.
- When a job fails, rerun only the failed job or dispatch a new run after a
  source change. Never automatically loop the entire stable suite.

## Out Of Scope

- Adding support claims for Windows, Linux, or macOS x64.
- Building a bespoke CI service, queue, database, or agent supervisor.
- Replacing Electron Forge, GitHub Actions, Turbo, pnpm, or the canonical desktop
  release contract.
- Making flaky tests appear deterministic by retries, ignored failures, or
  higher concurrency.
- Requiring the fast release to meet the stable publication contract.
- Automatic stable publication without an explicit protected-environment
  approval.

## Verification

- Unit-test gate profile membership, receipt creation, receipt mismatch failure,
  and stable-only publication requirements.
- Validate every workflow with a YAML/action linter and the repository's
  SHA-pinned GitHub-owned action policy.
- On a docs-only PR, prove that `ci-fast` selects only the affected graph plus
  mandated root contracts.
- On a representative desktop change, prove that `ci-fast` runs its escalation
  set and remains the sole required summary check.
- Dispatch `release-fast` for a test version and verify the artifact bundle,
  prerelease flag, exact source SHA, signing/notarization evidence, and absence
  of a stable/latest tag mutation.
- Dispatch `release-stable` without approval and verify it stops at the protected
  environment after all stable gates and artifact checks pass.
- Approve a disposable test stable run or exercise a non-publishing dry run and
  verify the final job consumes the existing verified artifact bundle rather
  than rebuilding it.
- Prove a second dispatch for the same channel/SHA is idempotent and a new PR
  commit cancels only the obsolete PR run, never a stable release.
- Collect ten-run timing summaries and compare median, p90, aggregate runner
  time, cache hit rate, and rerun count with run `30161541840`.

## Acceptance Criteria

- Exactly two top-level release workflows exist: fast prerelease and stable
  release. PR CI and scheduled advisory checks are not presented as releases.
- PR merge requires one stable `ci-fast` status, and the repository has a ruleset
  enforcing it.
- Fast release targets only current macOS arm64 scope and reaches a candidate
  within the agreed 15-minute warm-cache budget.
- Stable publication cannot run without the full stable profile, supported
  native artifact evidence, exact SHA/version agreement, and protected
  approval.
- Unsupported OS and timing-only jobs never block Mac development or candidate
  delivery.
- No release command, closeout, runbook, or agent handoff repeats a successfully
  validated profile for the same SHA and lockfile.
- Every release attempt has one inspectable receipt and one workflow run URL;
  failures name the exact job/gate and can be retried without replaying unrelated
  work.
- The agent returns after dispatch and does not poll GitHub Actions unless the
  maintainer explicitly requests monitoring.
- Existing signing, notarization, native install/relaunch/update, publication,
  and fail-closed support-policy guarantees remain intact.

## Refinement 2026-07-27T14:10:20.885178Z

Goal constraint: preserve the checked six-phase scope and acceptance criteria. Windows, Linux, and macOS x64 stay advisory and non-blocking; signing, notarization, native verification, and protected publication approval may not be weakened. Every receipt is bound fail-closed to the exact source SHA and lockfile. Successful workflow dispatch plus recorded run URL is the agent stop condition; no CI polling, automatic broad retries, custom infrastructure, or unrelated refactors. Goal oracle: a representative PR exposes only required ci-fast; release-fast produces an exact-SHA macOS-arm64 prerelease bundle; release-stable reaches the protected approval boundary without agent interaction or publication during verification; unsupported-platform jobs remain advisory. Iteration budget: 10.

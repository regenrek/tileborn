<!-- intent-skills:start -->

## Skill Loading

Before substantial work:

- Skill check: run `pnpm dlx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Code Mode Batching

- When several already-known tool calls are independent, read-only, and non-conflicting, run them concurrently inside one `functions.exec` call using `Promise.allSettled`. Inspect every result.
- Keep dependent or adaptive calls, writes, approvals, waits or resumes, and conflicting mutations sequential. Limit fan-out and combined output.

## Proofloop

- For bounded implementation runs that need independent verification, use the
  Sol-Luna-Fable Proofloop profile at `.proofloop/project-profile.json`.
- Keep Sol as the sole writer. Luna and Fable are read-only and are selected
  only when the run contract names them.
- Proofloop does not own legacy test retirement; perform approved retirement
  before taking a new Proofloop baseline.

## Verification Policy: Operating Path First

- Prove the real operating path before adding tests, guardrails, fixtures, or
  verification infrastructure. For user-visible behavior, direct observation
  in the running product is the primary evidence.
- For ordinary feature and fix work, use at most one targeted existing
  automated check plus one live operating-path verification. Do not run broad
  root test suites, `test:all`, full Electron smoke suites, release gates, or
  repeated typecheck/lint/test cycles unless the user explicitly asks, the
  release contract requires them, or no targeted check can cover a genuinely
  cross-cutting change.
- Default to zero new test files for Electron, renderer, Pixi/canvas, and
  gameplay work. Add at most one focused regression test only when it protects
  a durable non-visual invariant and can demonstrate fail-before/pass-after.
  Creating or modifying more test files requires explicit maintainer approval.
- Never add production hooks, metrics, debug exports, event ledgers, hashes,
  proof artifacts, duplicate fixtures, or compatibility paths solely to make
  agent verification possible.
- Verify visual and feel-based behavior such as muzzle flashes, animation
  timing, spawn layout, textures, HUD state, pointer aim, and input
  responsiveness live in Electron. DOM counters, event counts, snapshots, and
  headless surrogates do not substitute for observing the rendered behavior.
- Rerun a command only after a relevant code change or to confirm a previously
  failing targeted check. Never rerun a passing command for reassurance. If the
  same check fails twice without new evidence, stop and report the blocker
  instead of entering another repair or verification loop.
- Do not start a verification command expected to take more than five minutes
  unless the user requested it or the release contract requires it. If an
  ordinary verification run stalls past that budget, terminate it once and
  report the partial result; do not keep polling unchanged state.
- Stop when the requested operating path works live, no new relevant
  console/runtime error appears, and the closest existing automated check (if
  one exists) passes. Do not escalate a working change into extra tests,
  reviews, evidence packages, or proof loops.
- Do not spawn subagents to create tests, review evidence, or repeat
  verification unless the user explicitly requests delegation.

## Live Electron Testing

- Before writing or modifying tests for user-visible Electron behavior, load
  and follow `.agents/skills/electron-live-test/SKILL.md`.
- Prefer Chrome DevTools MCP for Tileborne's Electron renderer and React shell
  when CDP inspection, console/network debugging, source-mapped renderer
  stacks, or performance traces are needed. Use Playwright Electron smoke tests
  only for an existing repeatable verification path. Keep native-devtools-mcp
  for native window chrome, OS dialogs, screenshot/OCR, Pixi/canvas visual
  targeting, or Android/native coverage that Chrome DevTools MCP and Playwright
  do not cover.
- On this machine, the Codex MCP server names are
  `chrome-devtools-tileborn`, `playwright`, and `native-devtools`.
- The dev server is user-managed. Do not start or restart it unless the user
  explicitly asks; if CDP is needed, ask the user to run
  `pnpm --filter @tileborne/desktop dev:cdp` or confirm that it is already
  running.

## Licensing

- Public OSS packages and apps use `"license": "MIT"` with the single root [`LICENSE`](./LICENSE) file (no per-package copy).
- Private workspace tools (`@tileborne/boundary-tests`, `@tileborne/test-fixtures`) use `"private": true` and `"license": "UNLICENSED"`.
- CC0 sample fixtures live under `packages/test-fixtures/fixtures/` with per-directory `PROVENANCE.md`.

## Release and CI Contract

- Pull requests have one required status only: `ci-fast`. Security checks run
  inside that summary job; do not add another required matrix or platform
  check.
- `release-fast` is the exact-SHA macOS arm64 prerelease path.
  `release-stable` is the full background path. Windows, Linux, macOS x64, and
  timing-only probes are advisory and must never block Mac development or
  candidate delivery.
- Dispatch releases with
  `pnpm release:dispatch -- --channel fast|stable --sha <40-char-sha> --version <version>`.
  A successful dispatch plus its structured receipt and GitHub run URL is the
  agent stop condition. Do not poll, broadly retry, approve, promote, or publish
  unless the maintainer explicitly asks.
- Every release receipt is fail-closed to the exact source SHA and lockfile.
  Reuse a valid receipt for that immutable input; never replay an already
  validated profile merely to satisfy an agent loop.
- Release jobs use frozen installs, SHA-pinned actions, least privilege, and no
  dependency caches. Only publication jobs may have `contents: write`.
- Signing/notarization secrets belong in build-only GitHub environments;
  publication credentials belong in separately protected publication
  environments. `stable-release` and `fast-prerelease` must have required
  reviewers configured in GitHub. Repository files cannot enforce reviewer
  membership, so verify that external setting before enabling publication.

## Security Guardrails

- Before dependency changes, installs that can run lifecycle scripts, or CI
  security-policy edits, run the `package-security-check` and `secleak-check`
  skills. Present the read-only traffic-light findings and obtain maintainer
  approval before mutation.
- The canonical local scan is `pnpm security:check`. It runs forbidden-path,
  supply-chain, BetterLeaks, and Trivy checks. Never print raw secret values.
- Enable the tracked staged-file hook once per clone with
  `git config core.hooksPath .githooks`. Do not bypass it with `--no-verify`.
- Keep pnpm 11 pinned, one pnpm lockfile, seven-day release-age gating,
  `blockExoticSubdeps: true`, `dangerouslyAllowAllBuilds: false`, and an
  explicit reviewed `allowBuilds` map.
- New or changed lifecycle scripts and `trustPolicyExclude` entries require a
  package-specific owner, reason, and review date in
  `scripts/security/security-policy-exceptions.json`.
- Never use `pull_request_target` with untrusted code, floating action tags,
  unfrozen installs, broad dependency specs, `toJSON(secrets)`, shared release
  caches, or PR-controlled artifacts in privileged publication jobs.

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

## Live Electron Testing

- When the user asks for live browser testing, live UI verification, Electron app driving, native desktop automation, MCP browser control, screenshots/OCR, or CDP interaction, load the project skill `.cursor/skills/electron-live-test/SKILL.md` and follow it.
- Prefer Chrome DevTools MCP for Tileborne's Electron renderer and React shell when CDP inspection, console/network debugging, source-mapped renderer stacks, or performance traces are needed. Use Playwright Electron smoke tests for repeatable verification. Keep native-devtools-mcp for native window chrome, OS dialogs, screenshot/OCR, Pixi/canvas visual targeting, or Android/native coverage that Chrome DevTools MCP and Playwright do not cover.
- On this machine, the Codex MCP server names are `chrome-devtools-tileborn`, `playwright`, and `native-devtools`.
- The dev server is assumed to be user-managed. Do not start or restart it unless the user explicitly asks; if CDP is needed, ask the user to run `pnpm --filter @tileborne/desktop dev:cdp` or confirm that it is already running.

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

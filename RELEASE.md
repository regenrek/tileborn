# Tileborne 1.0 Release Candidate

This file is the maintainer handoff for preparing the unreleased
`v1.0.0-rc.0`. Its desktop decision is **NO-GO**. No tag, GitHub release, npm
publish, Homebrew publish, or Cloudflare deploy has happened.

## Current decision: desktop NO-GO

The Battle Royale creator/game Ship vertical has committed evidence, but the
desktop editor distribution is **NO-GO**. macOS arm64 is the only desktop 1.0
candidate. It is not releasable until the signed/notarized DMG, manifest,
native install/relaunch, verified project backup, approved last-known-good
retained-installer rollback, publication approval, and scoped credential all
pass the canonical contract. macOS x64, Windows, Linux, automatic desktop
updates/rollback, and remote crash reporting are unsupported in 1.0.

Read [`docs/desktop-release-runbook.md`](docs/desktop-release-runbook.md) before
any desktop release operation. `scripts/desktop-release-policy.json` is the
machine-readable support owner; Forge maker configuration is never evidence.

## Version Policy

- Release-candidate tag: `v1.0.0-rc.0`.
- MIT-licensed first-party app and package manifests use `1.0.0-rc.0`.
- Private workspace-only test tools stay private and unpublishable:
  `@tileborne/boundary-tests` and `@tileborne/test-fixtures` remain
  `0.0.0` with `UNLICENSED`.
- Bundled plugin manifests and sample asset-pack manifests keep their content
  versions until a plugin/content migration intentionally changes those
  runtime contracts.

## Required Local Gates

Run from a clean checkout before tagging:

```bash
git status --short --branch
pnpm install --frozen-lockfile
pnpm release:gates
pnpm docs:build
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
pnpm audit --audit-level moderate
git diff --check
```

Then inspect the fail-closed baseline explicitly:

```bash
pnpm release:desktop:policy
pnpm release:desktop:status
```

An evidence-free checkout must remain NO-GO. Do not suppress dependency audit
findings or desktop blocker codes. Any accepted advisory exception requires an
explicit, dated release-owner decision; it is not implied by an older handoff.

## Approval Boundaries

Do not run these without explicit maintainer approval:

```bash
git tag -a v1.0.0-rc.0 -m "Tileborne 1.0.0-rc.0"
git push origin v1.0.0-rc.0
npm publish
gh release create v1.0.0-rc.0
wrangler deploy
```

Cloudflare deploy also requires out-of-band `CLOUDFLARE_API_TOKEN`,
`HANDOFF_SIGNING_KEY`, and any Alchemy production secrets.

Desktop publication additionally requires protected Apple signing/notarization
inputs, an approved Team ID, a scoped `GH_TOKEN`, and a one-run
`TILEBORNE_DESKTOP_PUBLISH_APPROVED=1`. Secret presence is not approval. The
desktop contract verifies active GitHub auth, but does not tag, upload, or
publish. Never commit keys, tokens, `.env` files, project backups, support
bundles, native traces, or release receipts.

## Worktree preservation and classification

The production-hardening integration started from an intentionally dirty tree.
Its immutable pre-mutation receipt is Planr context `ctx-118489a3` at commit
`6d554778d2ecb370373f080f6624f9ffaee32d79`. The receipt records the complete
sorted path and content fingerprints; later cleanup and integration work must
prove equivalence against it instead of assuming that an untracked path is
disposable.

The 588 baseline worktree entries have this deterministic disposition:

| Classification                                        | Tracked | Untracked | Policy                                                                                                                                                                                         |
| ----------------------------------------------------- | ------: | --------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intentional source, tests, docs, or repository config |     229 |       145 | Preserve as release-candidate input. Inclusion in a commit still requires the later integration review and owning verification.                                                                |
| Required generated input                              |       1 |         2 | Preserve `pnpm-lock.yaml` plus the generated Game SDK capability source and documentation. Regenerate the SDK outputs only from `capabilities.registry.json`.                                  |
| Planr evidence and orchestration                      |       0 |       210 | Preserve the 206 `.planr` paths and four Planr worker/reviewer configs under `.claude` and `.codex`. Keep them separate from product-source decisions until Planr provenance is canonicalized. |
| Reproducible disposable output                        |       0 |         1 | `.pnpm-store/v11/index.db` is a local package-manager cache. It is ignored, but not deleted, by this integration.                                                                              |
| Unrelated user work                                   |       0 |         0 | None was identified in the captured baseline. Any newly discovered or ambiguous path defaults to preservation and requires an explicit owner decision.                                         |

The source/test/docs class is path-bounded to the captured changes under
`apps/`, `packages/`, and the explicitly allowlisted public root `docs/` contracts, together
with `.gitignore`, `package.json`, and `tsconfig.base.json`. The generated class
is limited to `pnpm-lock.yaml`, `packages/game-sdk/CAPABILITIES.md`, and
`packages/game-sdk/src/generated/capabilities.ts`; the latter two declare their
generator in `packages/game-sdk/scripts/generate-capabilities.mjs`. This is a
classification and preservation policy, not blanket approval to commit every
candidate file.

Ignored dependency/build trees (`node_modules`, `.turbo`, `dist`, `out`,
`.vite`, and `.refs`) remain reproducible local output and are outside the 588
dirty entries. The only ignore-policy addition made by this classification is
`/.pnpm-store/`; no cache or user-owned file is removed. Destructive cleanup,
reset, checkout, implicit staging, and broad `git add` remain prohibited for
the integration.

The clean integration baseline versions the durable Planr surface: the agent
profiles under `.claude/` and `.codex/`, product/build plans, project contracts,
and the 120 review receipts present at integration. Planr's `planr.sqlite`
database remains local because every pick, heartbeat, log, and review mutates
it. SQLite sidecars and newly emitted review projections are likewise ignored;
the archived review baseline stays tracked because tracked files are not
affected by ignore rules. The two `.planr/plans/build/*.plan.md` contracts are
explicitly re-included from the repository's general `build/` output rule.
This preserves every baseline receipt while a fresh checkout is reconstructed
only from stable committed inputs.

## Release Notes

Tileborne `1.0.0-rc.0` prepares the BR vertical for a production release
candidate decision:

- Electron desktop editor with committed BR playtest verification.
- CLI ship pipeline for thin product repos and local-compatible Cloudflare
  Worker artifact proof.
- Cloudflare Worker/Durable Object game host with local Miniflare smoke proof.
- Battle Royale plugin runtime, lobby flow, HUD, input, and synthesized audio
  proof.
- Release-readiness docs, security guidance, rollback notes, and known caveats.
- A fail-closed macOS arm64 desktop release contract with immutable artifact,
  source, Team/LKG, native backup/rollback, and publication boundaries.

Known caveats:

- Credentialed Cloudflare deploy is operator-gated and was not executed without
  explicit publish approval.
- Default audio remains synthesized pending final sound assets.
- Physical speaker output is not externally measured by automated gates.
- The desktop distribution remains NO-GO; an unpacked Forge `.app` smoke is not
  a signed/notarized installer receipt.
- macOS x64, Windows, Linux, automatic desktop update/rollback, and remote crash
  reporting are unsupported for desktop 1.0.
- npm, Homebrew, GitHub release, desktop publication, and production tag steps
  require separate maintainer approval. npm and Homebrew are not desktop 1.0
  channels.

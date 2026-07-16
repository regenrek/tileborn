# Tileborne 1.0 Release Candidate

This file is the maintainer handoff for preparing `v1.0.0-rc.0`. It is not a
record that the tag, GitHub release, npm publish, Homebrew publish, or
Cloudflare deploy has already happened.

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
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm --filter @tileborne/game-host test:smoke
pnpm --filter @tileborne/cli exec vitest --run src/ship-pipeline.integration.test.ts
pnpm -r build
pnpm audit --audit-level moderate
```

`pnpm audit --audit-level moderate` is not clean on 2026-06-15 because
`esbuild@0.28.1` is still inside the repository's seven-day
`minimumReleaseAge` window. Do not call the release candidate ready unless that
has aged in and been upgraded, or a release owner records an explicit override.

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
`apps/`, `packages/`, and the three public root `docs/` contracts, together
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

## Release Notes

Tileborne `1.0.0-rc.0` packages the BR vertical as a production release
candidate:

- Electron desktop editor with committed BR playtest verification.
- CLI ship pipeline for thin product repos and local-compatible Cloudflare
  Worker artifact proof.
- Cloudflare Worker/Durable Object game host with local Miniflare smoke proof.
- Battle Royale plugin runtime, lobby flow, HUD, input, and synthesized audio
  proof.
- Release-readiness docs, security guidance, rollback notes, and known caveats.

Known caveats:

- Credentialed Cloudflare deploy is operator-gated and was not executed without
  explicit publish approval.
- Default audio remains synthesized pending final sound assets.
- Physical speaker output is not externally measured by automated gates.
- npm, Homebrew, GitHub release, and production tag steps require separate
  maintainer approval.

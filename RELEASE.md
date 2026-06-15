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

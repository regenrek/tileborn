---
title: Release Readiness
description: Production 1.0 release-candidate checklist, deploy proof, secrets setup, rollback, support matrix, and caveats.
---

# Release Readiness

This page is the maintainer checklist for preparing Tileborne `1.0.0-rc.0`. It is **unreleased and
NO-GO** for desktop distribution; no tag or publication exists.

The desktop editor distribution is currently **NO-GO**. macOS arm64 is its sole 1.0 candidate; see
[Desktop Release](/desktop-release/) for the independent signed-installer evidence and approval
boundary. Creator/game Ship and Cloudflare-compatible host evidence do not prove desktop
distribution.

## Prerequisites

- Node.js 22 and pnpm 11.
- A clean git tree before final gates.
- Package manifests prepared for `1.0.0-rc.0` and a matching `CHANGELOG.md`
  entry plus top-level `RELEASE.md`.
- No committed `.env` files, API tokens, `HANDOFF_SIGNING_KEY`, `ALCHEMY_PASSWORD`, Wrangler account state, or Cloudflare credentials.
- No committed Apple signing/notarization keys, `GH_TOKEN`, desktop receipts, project backups, support bundles, or native traces.
- Explicit maintainer approval before any command that pushes, publishes, deploys, tags, or mutates a Cloudflare account.

## Local verification

Run these from the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm release:gates
pnpm docs:build
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
git diff --check
```

The ship-pipeline integration proves the thin product-repo scaffold, bundled runtime map packages, generated Worker artifact, generated Wrangler config, local Miniflare host, lobby flow, reconnect, and results endpoint without Cloudflare credentials.

## Version and tag readiness

The Production 1.0 release-candidate package version is `1.0.0-rc.0`.
MIT-licensed first-party app and package manifests use that version for RC
builds. Workspace-only private test tools remain unpublishable as
`0.0.0`/`UNLICENSED`.

The candidate tag is `v1.0.0-rc.0`, but tagging, pushing, GitHub release
creation, npm publishing, Homebrew publishing, and Cloudflare deployment all
require explicit maintainer approval. See the root `RELEASE.md` handoff before
running any publishing or deploy command.

## Build and deploy walkthrough

1. Create or use a thin product repository:

   ```bash
   tileborne game init my-game --plugin <plugin-id>
   ```

2. In that product repo, point `tileborne.config.json` at the Tileborne project and optional map ids to ship.

3. Build the Cloudflare artifact:

   ```bash
   npm run build
   ```

   The build writes separate `worker.js` and `behavior-worker.js` bundles,
   `manifest.json`, bundled `maps/`, `plugin/runtime.js`, `wrangler.toml`, and
   `wrangler.behavior.toml`.

4. Set the handoff secret once, out of band:

   ```bash
   wrangler secret put HANDOFF_SIGNING_KEY --config dist/game/wrangler.toml
   ```

5. Deploy only after maintainer approval for the target account and stage:

   ```bash
   wrangler deploy --config dist/game/wrangler.behavior.toml
   npm run deploy
   ```

6. Verify the deployed Worker:

   ```bash
   curl https://<worker-host>/health
   curl https://<worker-host>/discover
   ```

`/health` must not report the missing or placeholder signing-key failure, and `/discover` must show the expected plugin, build id, protocol version, and bundled maps.

## Secrets

| Secret                  | Required for                                             | Rule                                                                             |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `HANDOFF_SIGNING_KEY`   | Wrangler deploy and room handoff tokens                  | At least 32 random characters; set as a Cloudflare secret, never a plaintext var |
| `ALCHEMY_PASSWORD`      | Alchemy production/staging graphs with encrypted secrets | Required before `alchemy.secret()` is used for staging or production             |
| `CLOUDFLARE_API_TOKEN`  | Non-interactive Cloudflare deploy                        | Provide out of band with the minimum required account scope                      |
| `CLOUDFLARE_ACCOUNT_ID` | Account-targeted deploy automation                       | May be set in the operator environment, but do not commit it to OSS config       |

Desktop Apple/GitHub credentials have a separate fail-closed boundary documented in
[Desktop Release](/desktop-release/). Credential presence never substitutes for explicit publish
approval.

If credentials or approval are missing, record the exact deploy substep as blocked and continue local verification, docs, security, and package-readiness work.

## Game-host rollback

- Keep the last known-good Worker build artifact and release tag available.
- Re-deploy the previous `worker.js` and `wrangler.toml` for the same Durable Object class and migration set.
- Do not rotate `HANDOFF_SIGNING_KEY` as part of rollback unless token compromise is suspected.
- If a migration or binding change is implicated, stop new deploys, record the deployed Worker URL and build id, and restore the previous Worker script before changing data-bearing resources.

## Support matrix

| Surface                | Production 1.0 readiness target                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop editor         | macOS arm64 candidate only; **NO-GO** until signed/notarized DMG, native install/relaunch, backup/rollback, and publication contract pass |
| CLI                    | Project, asset, map, plugin, game build, game serve, and scaffold workflows                                                               |
| Game host              | Cloudflare Worker and Durable Object room runtime, with local Miniflare proof and credentialed deploy operator gate                       |
| Battle Royale vertical | Authored BR maps, lobby/join code flow, runtime combat/zone loop, HUD, input, and audio runtime proof                                     |
| Docs                   | Maintainer install/build/deploy/security/release handoff docs built from the repo                                                         |

## Known caveats

- The real Cloudflare account deploy requires maintainer credentials and explicit publish approval.
- Default audio is synthesized pending final sound assets; physical speaker output is not externally measured by automated gates.
- The hosted game path has no accounts, matchmaking, friends, leaderboards, or long-lived player identity.
- Generated GoalBuddy receipts under `docs/goals/` and `.refs/` may be local-only if those paths remain ignored.
- npm, Homebrew, GitHub release, and production tagging steps require separate maintainer approval.
- macOS x64, Windows, Linux, automatic desktop update/rollback, and remote crash reporting are unsupported for desktop 1.0; Forge maker configuration is not support evidence.

## Go/no-go

Go only when the final release-candidate audit maps a clean committed tree, passing gates, deploy proof or exact credential blocker, release docs, security hygiene, package/version readiness, rollback guidance, and known caveats to the production 1.0 oracle. Desktop publication additionally requires the independent Desktop Release contract to return GO with no blockers.

---
title: Self-Hosting
description: Local build, Cloudflare deployment, credentials, troubleshooting, licensing, audio, shell, multiplayer, and known non-goals.
---

# Self-Hosting

This guide is the production handoff for running a Tileborne-authored game from
your own repository and Cloudflare account. It covers the operational path from
local artifact proof to an account-owned Worker deployment.

## Local build

Start from a thin product repo created by the Tileborne CLI:

```bash
tileborne game init my-game --plugin <plugin-id>
cd my-game
npm install
npm run build
```

The build reads `tileborne.config.json` and writes the deploy artifact under
`dist/game/`: `worker.js`, `behavior-worker.js`, `manifest.json`, `maps/`,
`plugin/runtime.js`, `wrangler.toml`, and `wrangler.behavior.toml`.

Before using Cloudflare, boot the copied artifact locally:

```bash
tileborne game serve --dir dist/game --port 8787
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/discover
```

Create a room from a bundled map to prove the artifact is playable without a
caller-supplied `mapPackage`:

```bash
curl -X POST http://127.0.0.1:8787/rooms/create \
  -H 'content-type: application/json' \
  -d '{"mapId":"<map-id>"}'
```

## Cloudflare deployment

Tileborne separates artifact creation from account mutation. The generated
Wrangler files deploy the behavior worker first, then the room worker:

```bash
wrangler deploy --config dist/game/wrangler.behavior.toml
wrangler deploy --config dist/game/wrangler.toml
```

For Alchemy-owned stacks, the committed production graph is
`packages/services-build/src/runtime-deploy/alchemy-cloudflare-stack.ts`. The
runtime deploy runner invokes the official CLI entrypoint
`node_modules/alchemy/bin/alchemy.js` with the compiled stack artifact; packaged
desktop builds copy that stack to `Resources/app/runtime-deploy/` and ship the
Alchemy package in the desktop runtime closure. Compose product-specific D1, KV,
R2, queue, rate-limit, or custom-domain resources around that graph in your
product repo. Keep account names, domains, and generated state out of the OSS
monorepo.

After deployment, verify the account-owned Worker:

```bash
curl https://<worker-host>/health
curl https://<worker-host>/discover
curl -X POST https://<worker-host>/rooms/create \
  -H 'content-type: application/json' \
  -d '{"mapId":"<map-id>"}'
```

`/health` must be healthy, `/discover` must list the expected plugin, protocol
version, build id, and bundled maps, and room creation must return a connectable
room or lobby handoff.

## Credentials

Set secrets out of band. Do not commit `.env` files, API tokens, Wrangler
account state, Alchemy state, or generated account-specific config.

| Credential              | Use                                      | Rule                                                                 |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `HANDOFF_SIGNING_KEY`   | Signs room and WebSocket handoff tokens  | Cloudflare secret; at least 32 random characters                     |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the deployment account           | Environment only; acceptable to be present without deploy permission |
| `CLOUDFLARE_API_TOKEN`  | Non-interactive deploy and cleanup       | Provide only for approved deploy runs with minimum required scope    |
| `ALCHEMY_PASSWORD`      | Encrypts Alchemy-managed production data | Required before using encrypted Alchemy secrets                      |

Set the handoff key before the first room-worker deployment:

```bash
wrangler secret put HANDOFF_SIGNING_KEY --config dist/game/wrangler.toml
```

Maintainer approval is still required before commands that deploy, destroy, tag,
publish, or otherwise mutate a real Cloudflare account.

## Licensing

Self-hosted games must import only assets and plugins you can redistribute.
Every imported third-party asset pack needs SPDX license metadata and source
attribution. Missing or unknown SPDX IDs fail the asset import policy unless a
local operator deliberately relaxes that policy.

Run the repo license and release gates before publishing an artifact:

```bash
pnpm release:gates
pnpm --filter @tileborne/docs build
```

Default Tileborne sample fixtures use documented provenance. Product-owned art,
music, fonts, maps, and plugin packages need their own attribution records.

## Audio

Runtime audio comes from plugin runtime contributions and imported audio assets.
The default battle-royale fixture audio is synthesized and redistributable, but
production games should replace it with product-owned or licensed sounds.

Automated checks prove the runtime declaration and playback path; they do not
prove physical speaker output. Verify final device audio manually on the target
desktop and browser environments before public release.

## Shell authoring and navigation

The desktop editor owns authoring, save/reopen, and shell navigation. Use it to
author maps, plugin settings, runtime shell defaults, HUD/input/audio
declarations, and navigation flows before building the Cloudflare artifact.

For a release candidate, keep evidence for:

- License failure and repair during asset import.
- Audio declaration and playback path.
- Shell authoring and navigation.
- Single-client playtest.
- Two-client lobby, ready, reconnect, and results flow.
- Save, reopen, rebuild, and Ship from the same authored project.

## Multiplayer extension

The hosted game path supports room-scoped multiplayer through Workers and
Durable Objects. Join codes, player ids, reconnect tokens, readiness, countdown,
idle timeout, heartbeat timeout, and results are room policy.

To extend multiplayer, keep durable room state authoritative and treat clients
as untrusted. Add product services such as accounts, matchmaking, friends,
leaderboards, seasons, analytics, or moderation outside the Tileborne room
runtime and bind them through your product-owned Cloudflare graph.

## Troubleshooting

| Symptom                                            | Check                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `/health` returns `503`                            | `HANDOFF_SIGNING_KEY` is missing, too short, or still a placeholder       |
| `rooms/create` cannot find a map                   | Rebuild with `--project <slug>` and confirm `manifest.json` has maps      |
| Behavior worker binding fails                      | Deploy `wrangler.behavior.toml` before `wrangler.toml`                    |
| Local serve works but Cloudflare deploy is blocked | Confirm account approval, `CLOUDFLARE_API_TOKEN`, and account id          |
| Asset import fails on license                      | Add SPDX id and source URL, or replace the asset                          |
| Lobby never starts                                 | Check `minReadyPlayers`, readiness credentials, and connected clients     |
| Audio is silent                                    | Verify plugin audio declarations, imported audio files, and device output |

When credentials or approval are unavailable, record the exact blocked deploy
substep and continue local artifact proof, docs, security, package-readiness,
and release-gate work.

## Known non-goals

- Tileborne does not host your production Cloudflare account or domain.
- The OSS repo does not commit product secrets, generated account state, custom
  domains, or proprietary deployment graphs.
- Hosted rooms do not include built-in accounts, matchmaking, friends,
  leaderboards, payments, moderation, or long-lived player identity.
- Automated audio gates do not certify speaker hardware.
- Desktop binary publication is a separate release contract from game hosting.

## Related reading

- [Ship Pipeline](/deploy/ship-pipeline/)
- [Cloudflare Deploy](/deploy/cloudflare/)
- [Release Readiness](/release-readiness/)
- [Asset Pipeline](/asset-pipeline/)
- [Security model](/security/)

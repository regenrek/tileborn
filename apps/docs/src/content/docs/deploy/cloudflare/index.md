---
title: Cloudflare Deploy
description: Build vs deploy split, Alchemy template, env bindings, and downstream examples.
---

# Cloudflare Deploy

Tileborne separates **building** the game-host worker artifact from **deploying** Cloudflare resources. The OSS monorepo ships the worker code and a reference Alchemy graph; production stacks live in downstream product repos.

## Build pipeline

Produce the bundled worker from a Tileborne project:

```bash
tileborne game build --target cloudflare --plugin <plugin-id> [--project <slug>] [--map <map-id>] [--out dist/game-host-cloudflare]
```

Default output layout:

```text
dist/game-host-cloudflare/
  worker.js
  worker.js.map
  behavior-worker.js     # isolated untrusted gameplay execution service
  behavior-worker.js.map
  manifest.json          # BundledManifest (content-addressed buildId, hashed maps entries)
  wrangler.toml          # room worker + BEHAVIOR_RUNTIME service binding
  wrangler.behavior.toml # behavior service + hard CPU limit
  plugin/
  assets/
  maps/                  # RuntimeMapPackage per shipped map (--project)
  build-artifact.json
```

The CLI resolves the plugin and asset packs from `~/.tileborne`, bundles executable runtime code with esbuild, and embeds manifest metadata for `/discover`. With `--project`, every selected map is assembled into a `RuntimeMapPackage` and baked into the artifact so `POST /rooms/create` works without a caller-supplied `mapPackage` — see [Ship Pipeline](/deploy/ship-pipeline/) for the full authored → build → deploy → play flow.

**Build** = deterministic artifact on disk. **Deploy** = Alchemy/Wrangler applying Cloudflare bindings.

## Reference Alchemy template

Copy [`apps/game-host/alchemy.example.run.ts`](https://github.com/tileborne/tileborne/blob/main/apps/game-host/alchemy.example.run.ts) into your consumer repo and customize resource names:

```ts
const gameHostWorkerScript =
  process.env.TILEBORNE_GAME_HOST_SCRIPT ?? "dist/game-host-cloudflare/worker.js";

export const gameHostWorker = await Worker("game-host", {
  script: gameHostWorkerScript,
  bindings: {
    PLAYTEST_ROOM: playtestRoom,
    HANDOFF_SIGNING_KEY: handoffSigningKey,
    ROOM_IDLE_TIMEOUT_SECONDS: process.env.ROOM_IDLE_TIMEOUT_SECONDS ?? "60",
  },
});
```

Do not execute the example file from CI — it documents composition only.

## Product-specific deployment

Keep the OSS deployment example generic. Product-specific graphs can add D1, KV, R2, queues, rate limits, custom domains, and private bindings in their own repositories:

- Composes the Tileborne game-host worker alongside product-specific bindings

Embed no proprietary config in OSS docs.

## Required bindings

| Binding | Type | Notes |
| --- | --- | --- |
| `PLAYTEST_ROOM` | Durable Object namespace | Class `PlaytestRoom`, `sqlite: true` |
| `HANDOFF_SIGNING_KEY` | Secret | ≥ 32 characters; HMAC for WebSocket handoff |
| `ROOM_IDLE_TIMEOUT_SECONDS` | optional | Default `60`; empty room teardown |

Optional downstream bindings (uncomment in template): D1, KV, R2 asset buckets, RateLimit namespaces.

## Environment variables

| Variable | Stage | Purpose |
| --- | --- | --- |
| `HANDOFF_SIGNING_KEY` | all | Signs playtest/room connect tokens |
| `ROOM_IDLE_TIMEOUT_SECONDS` | all | DO idle destroy threshold |
| `TILEBORNE_GAME_HOST_SCRIPT` | deploy | Override path to bundled `worker.js` |
| `ALCHEMY_PASSWORD` | staging/prod | Encrypt secrets via `alchemy.secret()` |

Production/staging deploys should refuse to run without `ALCHEMY_PASSWORD` when secrets are required.

## Production 1.0 release proof

For a release-candidate gate, record both the local-compatible artifact proof and the operator decision for the credentialed deploy:

1. Build/prove the deployable artifact without Cloudflare credentials:

   ```bash
   pnpm --filter @tileborne/cli exec vitest --run src/ship-pipeline.integration.test.ts
   pnpm --filter @tileborne/game-host test
   pnpm --filter @tileborne/game-host test:smoke
   ```

   This proves the thin product-repo scaffold, bundled map package, separate
   room and behavior workers, generated service binding, local two-workerd
   Miniflare host, `/discover`, room creation, lobby readiness, reconnect, and
   results endpoints without mutating a Cloudflare account.

2. For a real bring-your-own account deploy, the operator must explicitly approve the target account/stage and provide credentials out of band. Do not commit `.env` files, API tokens, `HANDOFF_SIGNING_KEY`, `ALCHEMY_PASSWORD`, or generated account-specific Wrangler/Alchemy state.

3. If credentials or publish approval are unavailable, record that exact blocker in the release receipt and preserve the local-compatible proof above. The blocker is the credentialed deploy step only; docs, security hygiene, package readiness, and final local gates can still continue.

## Health and discovery

After deploy:

```bash
curl https://<worker-host>/health
curl https://<worker-host>/discover
```

`/health` returns **503** when `HANDOFF_SIGNING_KEY` is misconfigured. `/discover` returns bundled manifest summary (plugin id, asset packs, protocol version).

## Related reading

- [Runtime & Game Host](/runtime/)
- [Security model](/security/) — handoff token contract
- [ADR-0004: Cloudflare build-time plugin bundling](/adrs/0004-cloudflare-build-time-plugin-bundling/)
- [Game-host README](https://github.com/tileborne/tileborne/blob/main/apps/game-host/README.md)

---
title: Cloudflare Deploy
description: Build vs deploy split, Alchemy template, env bindings, and downstream examples.
---

# Cloudflare Deploy

Tileborne separates **building** the game-host worker artifact from **deploying** Cloudflare resources. The OSS monorepo ships the worker code and a reference Alchemy graph; production stacks live in downstream product repos.

## Build pipeline

Produce the bundled worker from a Tileborne project:

```bash
tileborne game build --target cloudflare --plugin <plugin-id> [--out dist/game-host-cloudflare]
```

Default output layout:

```text
dist/game-host-cloudflare/
  worker.js
  worker.js.map
  manifest.json          # BundledManifest (content-addressed buildId)
  wrangler.toml          # generated hints
  plugin/
  assets/
  build-artifact.json
```

The CLI resolves the plugin and asset packs from `~/.tileborne`, bundles executable runtime code with esbuild, and embeds manifest metadata for `/discover`.

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

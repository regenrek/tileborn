---
title: Ship Pipeline
description: Authored → build → deploy → play with game init, game build, game serve, and wrangler deploy.
---

# Ship Pipeline

The ship pipeline turns an authored Tileborne project into a playable multiplayer game. The flow is **authored → build → deploy → play**, driven by four commands.

## 1. Scaffold: `tileborne game init`

```bash
tileborne game init my-game [--name <name>] [--plugin <plugin-id>]
```

Scaffolds a standalone **thin product repo**: `branding/`, `assets/`, `maps/`, `plugins/`, `deploy/`, `scripts/`, a `tileborne.config.json` naming the Tileborne project (and optional map ids) the build ships, and a `package.json` that consumes `@tileborne/cli` and your game-mode plugin as external dependencies. No engine or gameplay code lives in the scaffold. The scaffold's `npm run build` reads `tileborne.config.json` and passes `--project` for you, so the artifact always bundles your maps.

## 2. Build: `tileborne game build`

```bash
tileborne game build --plugin <plugin-id> --target cloudflare|local \
  [--project <slug>] [--map <map-id>] [--out dist/game]
```

Both targets produce the **same canonical artifact**: `worker.js` (bundled game-host), `plugin/runtime.js`, `manifest.json` (`BundledManifest` with content hashes and a derived `buildId`), `wrangler.toml`, and optional `assets/`.

With `--project`, every selected map is assembled into a `RuntimeMapPackage` and baked into the artifact under `maps/<map-id>/` — the same package format the desktop playtest uses. Bundled maps are listed (with per-file hashes) in `manifest.json` under `maps`, and `POST /rooms/create` resolves a bundled package when the request carries no `mapPackage`, so a shipped build is joinable by map id alone. A cloudflare build without `--project` bundles zero maps and warns loudly: the deployed host cannot create rooms.

- `--target local` (default) additionally writes a `README.md` with the serve instructions.
- `--target cloudflare` is the same artifact, intended for `wrangler deploy`.

## 3a. Play locally: `tileborne game serve`

```bash
tileborne game serve --dir dist/game [--port 8787]
```

Boots the built artifact in miniflare — no Cloudflare account required. Create a room against the printed base URL:

```bash
curl -X POST <baseUrl>/rooms/create \
  -H 'content-type: application/json' \
  -d '{"mapId":"<map-id>"}'
```

## 3b. Deploy: `wrangler deploy`

```bash
wrangler deploy --config dist/game/wrangler.toml
```

The generated `wrangler.toml` wires the worker and Durable Object room class. It deliberately ships **no** `HANDOFF_SIGNING_KEY` value — the key is a secret, and the worker rejects missing, short, and known-placeholder keys. Set it once before the first deploy:

```bash
wrangler secret put HANDOFF_SIGNING_KEY --config dist/game/wrangler.toml
```

The scaffold's `npm run deploy` checks for the secret before deploying. Verify with `/health` and `/discover`. See [Cloudflare Deploy](/deploy/cloudflare/) for bindings, environment variables, and the Alchemy reference graph.

## Related reading

- [Cloudflare Deploy](/deploy/cloudflare/)
- [Runtime & Game Host](/runtime/)
- [CLI Reference](/cli/)

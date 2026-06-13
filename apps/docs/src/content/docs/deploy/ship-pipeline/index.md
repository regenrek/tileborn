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

For the M4 lobby flow, create a join-code lobby instead of asking players to share a raw room id:

```bash
curl -X POST <baseUrl>/lobbies/create \
  -H 'content-type: application/json' \
  -d '{"mapId":"<map-id>","displayName":"Friday lobby","reserveCreator":true,"playerDisplayName":"Ada"}'
```

The response includes `roomId`, `joinCode`, `joinUrl`, `playerId`, `handoffToken`, `reconnectToken`, `wsUrl`, and a `lobby` summary. A second client joins with the code:

```bash
curl -X POST <baseUrl>/lobbies/join \
  -H 'content-type: application/json' \
  -d '{"joinCode":"<join-code>","displayName":"Grace"}'
```

Each client connects to its returned `wsUrl`, then marks readiness:

```bash
curl -X POST <baseUrl>/lobbies/<room-id>/ready \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <reconnect-token>' \
  -d '{"playerId":"<player-id>","ready":true}'
```

Ready changes require the player's room-scoped reconnect credential, either as the bearer header above or as `reconnectToken` in the JSON body. The room stays in `lobby` until the configured minimum ready player count is met. When all required players are ready, the lobby summary moves to `countdown`, then the room lifecycle advances to `active` on the game-host tick. Clients can poll `GET /lobbies/<room-id>` or `GET /lobbies/code/<join-code>` for the same public summary.

Reconnect uses the same stable `playerId` plus the latest `reconnectToken`:

```bash
curl -X POST <baseUrl>/rooms/reconnect \
  -H 'content-type: application/json' \
  -d '{"roomId":"<room-id>","playerId":"<player-id>","reconnectToken":"<reconnect-token>"}'
```

That returns a fresh handoff `wsUrl` and a new `reconnectToken`. If the same player opens a replacement socket, the old socket is closed and the durable room state keeps the same player seat, ready state, and reconnect eligibility.

Operational policy for shipped rooms:

- Join codes are room-scoped, six-character codes (`A-HJ-NP-Z2-9`) and map to `lobby-<code>` room ids.
- The host has no accounts, profiles, friends, matchmaking, leaderboards, or long-lived player identity; the room's `playerId` is only a per-room seat.
- `maxPlayers`, `minReadyPlayers`, `countdownSeconds`, idle timeout, heartbeat timeout, and reconnect window are room/host policy, not client-side trust decisions.
- `GET /rooms/<room-id>/results` is the structured results endpoint. It returns `results: null` while a match is live; final winner/placement results are deferred until the runtime exposes a deterministic match-finish transition.

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

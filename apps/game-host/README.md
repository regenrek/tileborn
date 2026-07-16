# @tileborne/game-host

Cloudflare Worker + Durable Object game-host for Tileborne.

## Router

Uses **Hono** (`hono@4`) for HTTP routing and WebSocket upgrade forwarding. Hono was chosen for lightweight worker routing, first-class Cloudflare Workers support, and `app.request()`-based unit tests without `wrangler dev`.

## Endpoints

| Method | Path                 | Description                                                                            |
| ------ | -------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/health`            | Liveness; returns `503` when `HANDOFF_SIGNING_KEY` is missing or shorter than 32 bytes |
| GET    | `/discover`          | Bundled manifest summary (plugin, asset packs, runtime/protocol version)               |
| POST   | `/rooms/create`      | Create or reuse a room (`options.idempotencyKey`) → `{ roomId, wsUrl }`                |
| GET    | `/rooms/:id/connect` | WebSocket upgrade; requires `?token=<handoff>&playerId=<id>&roomId=<id>`               |
| POST   | `/playtest/start`    | Create playtest DO room → `{ playtestId, wsUrl, handoffToken, playerId }`              |
| GET    | `/playtest/:id`      | Playtest summary via DO RPC                                                            |
| GET    | `/playtest/:id/ws`   | Legacy WebSocket upgrade proxied to `PlaytestRoom` DO                                  |

## Room lifecycle

`PlaytestRoom` Durable Objects persist `{ schemaVersion: 1, status, players, tick, simState, ... }` and drive an authoritative headless `@tileborne/runtime` simulation at **20 Hz** via DO alarms.

States: `lobby` → `running` → `finished` → `archived`.

- **create** — initializes storage, boots `GameRuntime`, registers the bundled plugin via `PluginHost`.
- **addPlayer** — validates a handoff token, stores `{ id, joinedAt, lastHeartbeatAt }`, broadcasts `PlayerJoined`.
- **running** — each alarm tick advances simulation, fans out `SnapshotDelta` / periodic `SnapshotFull`, persists every 100 ticks.
- **removePlayer** — broadcasts `PlayerLeft`; when empty for `ROOM_IDLE_TIMEOUT_SECONDS` (default 60), the room is destroyed.
- **destroy** — closes sockets, shuts down runtime/plugins, marks storage `archived`.

## Handoff token contract

Tokens are minted by the Worker (`mintHandoffToken`) and validated inside the DO before a WebSocket is accepted.

Payload (canonical JSON, HMAC-SHA256, base64url):

```json
{ "playtestId": "<room id>", "playerId": "<uuid>", "exp": 1710000000 }
```

Wire format: `<base64url(payload)>.<base64url(signature)>`

- Signing key: `HANDOFF_SIGNING_KEY` (≥ 32 characters)
- TTL: 300 seconds from `/playtest/start`
- Invalid or expired tokens close the socket with code **4001**

Connect URLs include query params:

```text
wss://host/rooms/{roomId}/connect?token=...&playerId=...&roomId=...
wss://host/playtest/{playtestId}/ws?token=...&playerId=...&playtestId=...
```

## Build

```bash
pnpm --filter @tileborne/game-host build
tileborne game build --plugin <id> --target cloudflare [--out <dir>] [--asset-pack <id>...]
```

Output layout (`dist/game-host-cloudflare/` by default):

```
worker.js
worker.js.map
manifest.json
wrangler.toml
plugin/
assets/
build-artifact.json
```

`manifest.json` is the canonical `BundledManifest`; `buildId` is the SHA-256 of the manifest payload (deterministic for identical inputs).

## Deployment via Alchemy

`@tileborne/game-host` is a **building block** — it ships the Worker + `PlaytestRoom` Durable Object code, not a production Cloudflare deployment. Downstream products (games, editors, hosted playtest) own their Alchemy stack and deploy from their repo.

**Canonical template:** [`alchemy.example.run.ts`](./alchemy.example.run.ts)

Copy that file into your consumer project (e.g. `deploy/alchemy.run.ts`), customize resource names, and wire it into your existing Alchemy graph alongside D1, KV, R2, queues, and rate limits as needed.

### Conventions

- **`alchemy.run.ts` owns Cloudflare resources.** Do not hand-maintain `wrangler.toml` / `wrangler.json` in this package or in consumer app folders — Alchemy generates Wrangler artifacts from the stack.
- **Build pipeline vs deploy graph:**
  - `tileborne game build --target cloudflare` produces the bundled worker artifact (`worker.js`, `manifest.json`, plugin/assets trees). Default output: `dist/game-host-cloudflare/`.
  - Your Alchemy `Worker` resource points at that artifact (`script: "dist/game-host-cloudflare/worker.js"` or `TILEBORNE_GAME_HOST_SCRIPT`).
- **Type drift guard:** `pnpm --filter @tileborne/game-host typecheck` includes `alchemy.example.run.ts`; `src/__tests__/alchemy-example.compile.test.ts` typechecks it without executing the top-level `await alchemy(...)` call.

### Required bindings (consumer `Env`)

| Binding                     | Type                     | Notes                                                           |
| --------------------------- | ------------------------ | --------------------------------------------------------------- |
| `PLAYTEST_ROOM`             | Durable Object namespace | Class `PlaytestRoom`, SQLite-backed (`sqlite: true` in Alchemy) |
| `HANDOFF_SIGNING_KEY`       | Secret                   | ≥ 32 characters; use `alchemy.secret()` in production stages    |
| `ROOM_IDLE_TIMEOUT_SECONDS` | optional string/number   | Defaults to `60` in the reference stack                         |

Optional vars (`HEARTBEAT_TIMEOUT_SECONDS`, `SITE_NAME`) are documented in [`src/types.ts`](./src/types.ts).

## Deferrals

See `docs/follow-ups.md` § Game-host deferrals.

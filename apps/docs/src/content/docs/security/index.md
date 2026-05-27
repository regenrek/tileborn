---
title: Security Model
description: Supply-chain hardening, path safety, integrity verification, IPC isolation, and handoff tokens.
---

# Security Model

Tileborne treats the editor renderer, third-party plugins, imported assets, and Cloudflare edge as distinct trust zones. This page summarizes the platform security model from the product spec and shipped guards.

## Trust zones

| Zone | Trust level | Key rule |
| --- | --- | --- |
| Renderer (Electron) | Untrusted for Node/fs | `contextIsolation: true`, no plugin executables |
| Main / CLI / game-host | Trusted platform | Effect services mediate all I/O |
| Imported assets & plugins | Untrusted input | Validated before staging commit |
| Browser runtime client | Adversarial | Authoritative simulation on game-host only |

## Supply-chain hardening

Root `pnpm-workspace.yaml` configures pnpm trust policy:

| Setting | Purpose |
| --- | --- |
| `minimumReleaseAge` / `minimumReleaseAgeStrict` | Block freshly published packages unless explicitly excluded |
| `blockExoticSubdeps` | Reject git/subpath dependencies without an override |
| `dangerouslyAllowAllBuilds: false` | Require an explicit `allowBuilds` allowlist for install scripts |
| `trustPolicy: no-downgrade` | Prefer provenance-aware installs |

Pinned exclusions must include a dated comment and be removed once the dependency has been stable for more than seven days. See [CONTRIBUTING.md](https://github.com/tileborne/tileborne/blob/main/CONTRIBUTING.md) on the monorepo.

## Path traversal and symlink escape

All filesystem writes under user data (`~/.tileborne`) and project directories go through services that call `@tileborne/asset-pipeline` guards:

- **`rejectPathTraversal`** — rejects `../` and absolute archive paths
- **`rejectSymlinkEscape`** — resolves symlinks and rejects targets outside the allowed root
- **`verifiedChildPath`** — composes safe child paths for exports, playtest artifacts, and map files (`packages/services-app`, `packages/services-build`)

Plugin install and asset import staging directories are validated before atomic rename into the home layout.

## Integrity verification

### Asset packs

Import pipeline (`@tileborne/asset-pipeline`):

1. Inspect archives before extraction (size, file count caps)
2. Require license metadata (`spdxId`, `sourceUrl` for third-party packs)
3. Compute content hashes for every file
4. Write `tileborne-asset-pack.json` and atomically promote staging → `~/.tileborne/assets/packs/<pack-id>/`

Hash mismatches fail import with rollback.

### Plugin installs

Plugin registry services:

1. Validate `tileborne-plugin.json` against `@tileborne/plugin-api`
2. Check engine semver range
3. Verify manifest integrity hash when present
4. Enforce declared permissions before loading executable entrypoints

Executable contributions run only in main, CLI, or bundled game-host — never in the renderer (Phase A).

## Desktop IPC isolation

Electron main window defaults (`apps/desktop/src/main/window.ts`):

- **`contextIsolation: true`** — preload is the only bridge; renderer has no Node integration
- **`nodeIntegration: false`**
- **`sandbox: true`**

All channels are defined in `@tileborne/ipc-contracts` with Effect Schema decode/encode at the preload boundary. Undeclared IPC is rejected.

## Handoff tokens (game-host)

Playtest and room WebSocket upgrades require short-lived HMAC tokens minted by the Worker and validated inside the Durable Object:

```json
{ "playtestId": "<room id>", "playerId": "<uuid>", "exp": 1710000000 }
```

Wire format: `<base64url(payload)>.<base64url(hmac-sha256)>`

| Setting | Requirement |
| --- | --- |
| `HANDOFF_SIGNING_KEY` | ≥ 32 characters; secret in production |
| TTL | 300 seconds from `/playtest/start` |
| Invalid token | WebSocket close **4001** |

`/health` returns **503** when the signing key is missing or too short.

## Related reading

- [ADR-0003: Electron process boundary rules](/adrs/0003-electron-process-boundary-rules/)
- [ADR-0005: Asset import trust and license model](/adrs/0005-asset-import-trust-license-model/)
- [Asset pipeline](/asset-pipeline/)
- [Cloudflare deploy guide](/deploy/cloudflare/)
- [API Reference: @tileborne/asset-pipeline](/reference/) — see asset pipeline modules in generated docs when published

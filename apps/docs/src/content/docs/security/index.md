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

## Release audit gate

Production release candidates must pass the local security hygiene gate before handoff:

- Run `pnpm audit --audit-level moderate`.
- Review secret-scan hits for `CLOUDFLARE_API_TOKEN`, `ALCHEMY_PASSWORD`, `HANDOFF_SIGNING_KEY`, API keys, tokens, passwords, and private keys.
- Keep production secrets in the operator's Cloudflare, Alchemy, or environment secret store; do not commit `.env` files or plaintext credentials.
- Treat remaining moderate-or-higher advisories as release blockers unless the release owner records an explicit acceptance decision.

For the 2026-06-15 Production 1.0 audit, mature patched releases removed the actionable Playwright, Wrangler, Hono, Miniflare, Vite, `ws`, `qs`, `tmp`, `tar`, `js-yaml`, and `@babel/core` findings. `esbuild >=0.17.0 <0.28.1` remains blocked because the patched `0.28.1` release is still inside the repository's seven-day `minimumReleaseAge` window.

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

## Gameplay behavior security

Project gameplay TypeScript is untrusted input even after a creator grants the
project permission to compile it. Trust is an execution precondition, not a
general capability grant.

| Threat | Enforced policy | Automated owner/evidence |
| --- | --- | --- |
| Imported code before consent | `imported-untrusted` snapshots fail package compilation; source is preserved for inspection | `@tileborne/services-build` `project-package.test.ts` |
| Filesystem, network, Node, Electron, DOM, environment | Only `@tileborne/game-sdk`, approved bare modules, and contained project-relative imports resolve; forbidden globals/imports produce stable `TBSDK` diagnostics | `@tileborne/game-sdk` authoring validator tests and built-artifact adversarial tests |
| Wall clock and ambient randomness | `Date`, `performance`, `Math.random`, Web Crypto randomness, timers, and aliases/computed/destructured escapes are rejected; use injected tick clock, seeded RNG, and tick timers | `@tileborne/game-sdk` authoring validator tests |
| Dynamic code/import escapes | `eval`, `Function`, constructor aliases, `Reflect.get`/property-descriptor retrieval, dynamic imports, string/Wasm code generation, and unresolved imports fail closed | SDK source/built-validator and services-build compiler tests plus isolated-host VM tests |
| Runaway CPU, recursion, queues, actions, state, or heap | Scheduler budgets reject floods; worker wall-time/resource limits terminate the isolated worker and restore last-known-good modules/state | `@tileborne/runtime` scheduler tests and `apps/game-host` isolated-runtime tests |
| Execution in a privileged/editor process | Gameplay never executes in Electron renderer, preload, or main. Local playtest uses a Node worker; authoritative/shipped execution uses a separate Workerd service | `@tileborne/boundary-tests` behavior boundary plus game-host isolation smoke |
| Debug-data disclosure or unbounded retention | Debug values are JSON-only and size/depth/count bounded; secret-like keys plus POSIX, drive, UNC, and traversal paths are redacted; scheduler retains only the newest bounded trace/diagnostic windows | desktop playtest-runtime-host tests and runtime scheduler tests |

Default in-process scheduler limits are 8 ms per handler, 64 KiB state per
instance, 2 MiB scheduler-accounted memory, queue depth 512, recursion depth 16,
128 actions per dispatch, 2,048 actions per tick, and 256 retained traces and
diagnostics. The local isolated host additionally defaults to a 250 ms hard wall
deadline and Node worker heap/stack resource limits. Host profiles may tighten
these values; raising them is an owned runtime/security decision, not a project
script option.

Behavior source, diagnostics, traces, and artifacts remain project-local unless
the user invokes an explicit existing export or publish operation. Runtime
inspection is ephemeral and bounded; Tileborne does not silently upload gameplay
source or debug traces. A new SDK capability requires a typed declaration,
source/build validation, authoritative runtime handler, documentation,
adversarial tests, and security review.

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

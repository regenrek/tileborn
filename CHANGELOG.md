# Changelog

All notable changes to the Tileborne monorepo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Closed-schema macOS arm64 desktop release policy and verifier for artifact
  SHA-256/source provenance, Developer ID/notarization/stapling, native
  install/first-launch/relaunch, verified project backup, approved retained-
  installer rollback, and explicit GitHub publication authorization.
- Creator performance release budgets for the canonical 2,048-asset,
  512-behavior, and 8,192-reference workload, with separate advisory native
  timing traces.
- Maintainer runbooks for desktop support, external secrets, stable blocker
  meanings, project-content recovery, last-known-good approval, rollback, and
  release handoff.

### Changed

- Desktop support is now stated fail-closed: macOS arm64 is the sole 1.0
  candidate and remains **NO-GO** without native release evidence. Forge maker
  entries no longer imply Windows, Linux, or macOS x64 support.

### Security

- Apple signing/notarization and GitHub release credentials remain external;
  native receipts, support bundles, traces, and project backups are treated as
  restricted evidence rather than committed artifacts.

## [1.0.0-rc.0] - 2026-06-15

Production 1.0 release candidate. Focus: committed BR vertical proof, BYO
Cloudflare deploy readiness, release/security docs, and package metadata
prepared for maintainer go/no-go.

### Added

- Production release-readiness docs covering local gates, BYO Cloudflare deploy
  proof, required secrets, rollback, support matrix, and go/no-go criteria.
- Cloudflare deploy documentation for the local-compatible proof boundary and
  credentialed deploy blocker.
- Top-level release handoff checklist in `RELEASE.md`.

### Changed

- First-party MIT-licensed app and package manifests now use
  `1.0.0-rc.0` for release-candidate builds.
- `@tileborne/game-client-app` now declares the monorepo MIT license.
- Dependency hygiene refreshed for mature patched Playwright, Wrangler, Hono,
  Miniflare, Vite, `ws`, `qs`, `tmp`, `tar`, `js-yaml`, and `@babel/core`
  advisories.

### Security

- Production secret handling now requires Cloudflare, Alchemy, or operator
  environment secret stores instead of committed plaintext credentials.
- Release candidates must pass local secret scanning and treat remaining
  moderate-or-higher dependency advisories as release blockers unless the
  release owner records an explicit acceptance decision.
- Known RC blocker: `esbuild >=0.17.0 <0.28.1` remains in the dependency graph
  until patched `0.28.1` clears the repository's seven-day `minimumReleaseAge`
  policy or a release owner accepts an override.

## [0.1.0] - 2026-05-23

First open-source, local-first release. Focus: editor + SDK tileset pipeline + Battle Royale demo + multiplayer playtest on your machine.

### Added

#### SDK tileset parser (`@tileborne/sdk-tileset`)

- Canonical `TilesetPack` schema with Effect Schema validation and diagnostics
- Tiled TMJ/TSJ/TSX/TMX import with external tileset path containment (`isPathInsideFolder`)
- LDtk import with external level reference resolution
- Autotile compilation — Wang edge/corner, RPGMaker A2/A3/A4 layouts, blob-47 rules
- Deterministic weighted variant filters keyed by map seed and cell coordinates
- Animated tile resolution API with tick-based frame lookup
- Collision, passability, spawn anchor, and terrain transition metadata compilation
- Pixi renderer adapter frame index for editor and runtime viewports
- Golden verification suite: cross-format equivalence, replay determinism, compatibility matrix, Tiled source wall rules

#### Tiled source import

- Real Tiled source asset pack imported via `@tileborne/sdk-tileset/importers/tiled-source`
- **33 tilesets**, **~29k tiles**, 93 autotile rules, 673 image assets bundled for editor acceptance
- Tiled source-first import with Unity `.meta` fallback for non-Tiled spritesheets
- Provenance tags on every tile (`tiled-source:source`, `tiled-source:tile`) and asset-pack license reporting

#### Local-first multiplayer playtest

- Miniflare-backed game host with Durable Object room lifecycle
- HMAC handoff tokens for WebSocket join without cloud auth in the local path
- Two-window desktop join via second-instance handoff
- Authoritative tick loop with snapshot/delta protocol

#### Polished editor

- Dark mode shell with token-driven shadcn/Radix UI (`@tileborne/ui`)
- SDK-backed tileset palette with real Tiled source atlas metadata (no color placeholders)
- Map editor viewport with autotile neighbor refresh on brush edits
- Command palette, plugin manager, and declarative plugin contribution slots
- Removed disabled placeholder menu entries and deferred wiring labels

#### Battle Royale plugin

- [`@tileborne/plugin-battle-royale`](packages/plugin-battle-royale/) with deterministic ECS loop
- Spawn, movement, projectile combat, shrink zone, loot crates, and `MatchWon` win condition
- Map property and host-factory config overrides with schema validation
- Replay-verified snapshot parity between simulation ticks

#### Platform packages

- **Core** (`@tileborne/core`) — domain models, branded IDs, map/project schemas
- **Runtime** (`@tileborne/runtime`) — bitECS simulation, Pixi renderer adapter, WebSocket helpers
- **Plugin API** (`@tileborne/plugin-api`) — manifest schema, contribution registry, permissions
- **IPC contracts** (`@tileborne/ipc-contracts`) — typed desktop IPC channels
- **Asset pipeline** (`@tileborne/asset-pipeline`) — importers, pack index, license reporting, security guards
- **CLI** (`@tileborne/cli`) — project, asset, map, plugin, playtest, and game build commands
- **Desktop** (`@tileborne/desktop`) — Electron editor with typed preload
- **Game host** (`@tileborne/game-host`) — Cloudflare Worker + Durable Object template (local miniflare)
- **Docs** (`@tileborne/docs`) — Astro Starlight site
- **Boundary tests** — forbidden-token and import-boundary CI guards

### Changed

- Hard-cut editor and runtime from legacy `tileborne-palette.json` to SDK `TilesetPack` metadata (P-A15/P-A16)
- Eliminated user-visible stubs, disabled placeholders, and empty-manifest viewports (P1 audit)
- Supply-chain hardening via pnpm trust policy, release-age gates, and build allowlists

### Security

- External tileset and LDtk level path containment with traversal rejection
- Plugin runtime isolation via manifest permissions and sandboxed contribution loading
- Bundled asset loader validates manifest hashes and rejects fetch failures

[0.1.0]: https://github.com/tileborne/tileborne/releases/tag/v0.1.0
[1.0.0-rc.0]: https://github.com/tileborne/tileborne/compare/v0.1.0...v1.0.0-rc.0
[Unreleased]: https://github.com/tileborne/tileborne/compare/v1.0.0-rc.0...HEAD

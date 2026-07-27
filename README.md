# Tileborne

[![CI](https://github.com/tileborne/tileborne/actions/workflows/ci.yml/badge.svg)](https://github.com/tileborne/tileborne/actions/workflows/ci.yml)

**Tileborne** is an open-source platform for tilemap authoring, plugin-driven game tooling, and local-first multiplayer playtest.

Build maps in the Electron editor, extend behavior with plugins, and run deterministic battle-royale matches on your machine — no cloud account required for v0.1.0.

## Status

Release `0.0.1` is source-only; desktop binary distribution remains **NO-GO** and no desktop artifact is published.

The creator/game Ship vertical has committed evidence, while the desktop editor remains unavailable for distribution.
macOS arm64 is the sole desktop 1.0 candidate; Windows, Linux, macOS x64, and remote crash
reporting are unsupported. The macOS arm64 automatic-update path is candidate-gated by the same
signed A-to-B release oracle and is not an available release channel yet. See the
[desktop release runbook](docs/desktop-release-runbook.md).

## Quick start

**Prerequisites:** Node.js 22+ and pnpm 11+ (Corepack recommended).

```bash
git clone https://github.com/tileborne/tileborne.git
cd tileborne
corepack enable
pnpm install
pnpm --filter @tileborne/desktop dev:cdp
```

`dev:cdp` launches the Electron editor with Chrome DevTools Protocol enabled for automation and debugging. For a plain dev session without CDP, use `pnpm --filter @tileborne/desktop dev`.

Run the full workspace gate before opening a PR:

```bash
pnpm typecheck && pnpm lint && pnpm test:boundaries
```

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Electron desktop (apps/desktop)                            │
│  ┌──────────────┐  typed IPC   ┌──────────────────────────┐ │
│  │ Main process │◄────────────►│ Renderer (React + Pixi)  │ │
│  └──────────────┘              └──────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
  @tileborne/ui          @tileborne/ipc-contracts   @tileborne/sdk-tileset
  @tileborne/core        @tileborne/plugin-api      @tileborne/asset-pipeline
  @tileborne/runtime     @tileborne/cli             @tileborne/services-*
        │                       │
        ▼                       ▼
  plugin-battle-royale    apps/game-host (miniflare DO template)
```

| Layer                    | Role                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| **Electron main**        | Window lifecycle, filesystem, plugin host, IPC bridge            |
| **Renderer**             | React shell, map editor, tileset palette, playtest viewport      |
| **SDK packages**         | Domain models, tileset parser, runtime ECS, typed IPC            |
| **Battle Royale plugin** | Deterministic BR loop with zone, combat, loot, and replay        |
| **Game host**            | Local miniflare Worker + Durable Object for multiplayer playtest |

See [Architecture spec](docs/01-spec.md) for the full product boundary and invariants.

## Key packages

| Package                                                                      | Description                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`@tileborne/core`](packages/core/README.md)                                 | Domain models, IDs, map/project schemas                               |
| [`@tileborne/sdk-tileset`](packages/sdk-tileset/)                            | Canonical tileset parser — autotiles, variants, animations, collision |
| [`@tileborne/runtime`](packages/runtime/README.md)                           | ECS simulation, networking helpers, Pixi renderer adapter             |
| [`@tileborne/plugin-api`](packages/plugin-api/README.md)                     | Plugin manifest schema and contribution registry                      |
| [`@tileborne/ipc-contracts`](packages/ipc-contracts/README.md)               | Typed desktop IPC channels (Effect Schema)                            |
| [`@tileborne/cli`](packages/cli/README.md)                                   | `tileborne` CLI — project, asset, map, plugin, playtest               |
| [`@tileborne/ui`](packages/ui/README.md)                                     | Editor React shell and declarative plugin UI                          |
| [`@tileborne/plugin-battle-royale`](packages/plugin-battle-royale/README.md) | Official battle royale plugin demo                                    |
| [`@tileborne/asset-pipeline`](packages/asset-pipeline/README.md)             | Asset import, license reporting, path guards                          |
| [`@tileborne/desktop`](apps/desktop/README.md)                               | Electron editor app                                                   |
| [`@tileborne/game-host`](apps/game-host/README.md)                           | Cloudflare Worker + DO playtest template (local miniflare)            |

## Battle Royale plugin demo

The [`@tileborne/plugin-battle-royale`](packages/plugin-battle-royale/README.md) package ships a complete local-first battle royale loop:

- Perimeter spawn points, deterministic movement, and projectile combat
- Authoritative shrink zone with damage outside the safe radius
- Tiered loot crates and a single `MatchWon` emission point
- Deterministic replay — same seed and inputs produce identical snapshots

Open the editor, import your own redistributable tileset, and start a multiplayer playtest to try it.

## Screenshots

Run `pnpm --filter @tileborne/desktop dev:cdp` to explore the editor locally.

## Documentation

- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Security](SECURITY.md)
- [Docs site](apps/docs/) — build with `pnpm docs:dev`
- [Release readiness](apps/docs/src/content/docs/release-readiness/index.md)
- [Desktop release and recovery](docs/desktop-release-runbook.md)

## Contributing

We welcome issues and pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, testing conventions, PlanDB workflow, and PR guidelines.

## License

MIT — see [LICENSE](LICENSE).

CC0 sample fixtures under `packages/test-fixtures/fixtures/` include per-directory `PROVENANCE.md` attribution. Third-party art assets are intentionally not bundled in the OSS repository.

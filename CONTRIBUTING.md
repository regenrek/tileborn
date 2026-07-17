# Contributing to Tileborne

Thank you for helping improve Tileborne. This document covers local development, testing conventions, and release policy for the OSS monorepo.

## Development setup

**Prerequisites:** Node.js 22+ (see [`.nvmrc`](.nvmrc)), pnpm 11+ (Corepack recommended).

```bash
git clone https://github.com/tileborne/tileborne.git
cd tileborne
corepack enable
pnpm install
```

Launch the desktop editor with CDP enabled (preferred for automation and debugging):

```bash
pnpm --filter @tileborne/desktop dev:cdp
```

Plain dev session without CDP:

```bash
pnpm --filter @tileborne/desktop dev
```

## Project structure

```text
apps/
  desktop/       Electron editor (main + renderer + preload)
  game-host/     Cloudflare Worker + Durable Object playtest template
  docs/          Astro Starlight documentation site
packages/
  core/          Pure domain models and branded IDs
  sdk-tileset/   Canonical tileset parser and Tiled source importer
  runtime/       ECS simulation and Pixi renderer adapter
  plugin-api/    Plugin manifest schema and contributions
  plugin-battle-royale/  Official BR plugin demo
  ipc-contracts/ Typed desktop IPC (Effect Schema)
  asset-pipeline/ Asset import, license reporting, security guards
  cli/           tileborne CLI
  services-*/    Effect service layers
  ui/            Editor React shell (shadcn/Radix)
  test-fixtures/ CC0 and bundled asset fixtures (private)
  boundary-tests/ Import and token boundary CI (private)
docs/            Product specs, ADRs, and parser plans
```

## Running tests

Always run Vitest once and exit — do not leave watch mode running in CI or agent scripts:

```bash
pnpm test -- --run          # full workspace
vitest --run                # from a package directory
pnpm test:boundaries        # OSS boundary leak tests (required gate)
```

Release readiness (slow; runs in dedicated CI):

```bash
pnpm test:clean-checkout
```

Full pre-PR gate:

```bash
pnpm typecheck && pnpm lint && pnpm test:boundaries
```

## Code style and linting

- **TypeScript strict** — no `@ts-nocheck`, `@ts-ignore`, or `as any` escapes in new code.
- **ESLint** — run `pnpm lint` at the workspace root; fix issues before opening a PR.
- **Prettier** — formatting is enforced via the repo config; do not fight existing conventions.
- **Effect v4** — services, layers, and schemas follow idioms in `.cursor/skills/effect-ts/`.
- **Hard-cut rule** — one canonical shape per feature; no compatibility shims unless an ADR defers them. See [docs follow-ups](docs/follow-ups.md) for tracked deferrals.

Match the style of surrounding code: naming, imports, abstractions, and comment density.

## PlanDB workflow

This repo uses [PlanDB](https://github.com/) as the live task graph for agent and maintainer coordination.

Set the database path (or use the repo-local default):

```bash
export PLANDB_DB="$PWD/.plandb/tileborn.db"
```

Common commands:

```bash
plandb project status --json
plandb go                        # show ready work
plandb task claim --agent <id> <task-id>
plandb task start <task-id>
plandb task done --agent <id> --result '<json>' <task-id>
```

Full workflow reference: the `plandb-task-graph` agent skill (search "PlanDB Task Graph" in your skills directory or ask a maintainer for the repo's task graph conventions).

Capture discoveries as task notes or context entries so the next agent can resume without ad-hoc markdown.

## Branch policy

Do not create new git branches unless explicitly requested by a maintainer or issue owner. Work on the branch you were assigned; use `git new` only when instructed.

## Pull requests

1. Keep diffs focused; match surrounding style.
2. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test -- --run` before opening a PR.
3. Update docs when changing user-visible CLI, plugin, or editor behavior.
4. Significant design changes require an ADR under `docs/adrs/`.

## Supply-chain policy

Root `pnpm-workspace.yaml` enforces:

- `minimumReleaseAge` / `minimumReleaseAgeStrict` — no freshly published packages without an exclusion entry
- `blockExoticSubdeps` — block git/subpath dependencies unless overridden
- `dangerouslyAllowAllBuilds: false` with an explicit `allowBuilds` allowlist
- `trustPolicy: no-downgrade` for provenance-aware installs

When pinning a dependency that fails the release-age gate, add a dated comment and `minimumReleaseAgeExclude` entry; remove after the package has been stable for more than seven days.

## Licensing

| Package kind                                                | `license` field | Notes                                                         |
| ----------------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| Public OSS packages and apps                                | `"MIT"`         | Root [`LICENSE`](LICENSE); per-package symlinks where present |
| Private workspace tools (`boundary-tests`, `test-fixtures`) | `"UNLICENSED"`  | `"private": true`; not published                              |

CC0 sample assets ship under `packages/test-fixtures/fixtures/` with per-fixture `PROVENANCE.md` attribution. The bundled Tiled source pack has separate third-party license notes — see its `PROVENANCE.md`.

## Architecture decisions

Significant design changes require an ADR under `docs/adrs/`. Drafts are synced into the docs site under **Architecture Decisions**. Follow the existing numbering (`0001`–`0012`).

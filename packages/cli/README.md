# @tileborne/cli

Tileborne platform command-line interface.

## Install

From the monorepo root:

```bash
pnpm install
pnpm --filter @tileborne/cli build
```

Link locally:

```bash
pnpm --filter @tileborne/cli exec node dist/main.js --help
```

Binaries: `tileborne`, `tb`.

## Commands

| Command | Description |
| --- | --- |
| `tileborne doctor` | Health checks (home, Node, pnpm, services) |
| `tileborne home` | Show current home directory and contents |
| `tileborne home set <path>` | Set persistent Tileborne home |
| `tileborne config get <key>` | Read a config value |
| `tileborne config set <key> <value>` | Update a config value |
| `tileborne config list` | List all config values |
| `tileborne project init <slug>` | Create a project (`--here`, `--template`) |
| `tileborne project info` | Show project metadata (`--at`) |
| `tileborne project upgrade` | Migrate project schema |
| `tileborne project clean` | Clear caches and derived artifacts |

Global flags on every command:

- `--json` — machine-readable JSON output
- `--verbose` / `-v` — verbose logging

## Environment

| Variable | Description |
| --- | --- |
| `TILEBORNE_HOME` | Override Tileborne home directory |
| `TILEBORNE_LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `silent` |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Generic failure |
| 2 | Reserved |
| 64 | Usage / validation error |
| 66 | Missing input (e.g. project not found) |
| 69 | Doctor checks failed |
| 74 | I/O error |
| 78 | Config error |

## Development

```bash
pnpm --filter @tileborne/cli typecheck
pnpm --filter @tileborne/cli lint
pnpm --filter @tileborne/cli test -- --run
pnpm --filter @tileborne/cli build
node packages/cli/dist/main.js doctor
```

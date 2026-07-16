# `@tileborne/desktop`

The Electron creator application: project lifecycle, map/content/sprite/behavior authoring,
readiness, local playtest, recovery, and Ship entry points. The renderer reaches filesystem,
project, build, and plugin owners only through the typed preload/IPC boundary.

## Development

```sh
pnpm --filter @tileborne/desktop dev
pnpm --filter @tileborne/desktop dev:cdp
pnpm --filter @tileborne/desktop test
pnpm --filter @tileborne/desktop test:desktop-smoke
```

`dev:cdp` is for an explicitly user-managed automation/debug session. Creator recovery is
main-process-owned: a failed save remains dirty, close stays blocked, and an interruption recovery
snapshot must be reopened and saved or explicitly discarded.

## Packaging is not support

`build` creates an unpacked Forge application; `package` invokes Forge make. Development maker
entries exist for macOS, Windows, and Linux, but they are not a support claim. Desktop 1.0 has one
candidate only: a signed/notarized macOS arm64 DMG. It remains **NO-GO** until the canonical release
contract verifies the artifact, provenance, native install/relaunch, project backup, retained-
installer rollback, explicit publication approval, and active scoped credential.
Release `0.0.1` is source-only; desktop binary distribution remains **NO-GO** and no desktop artifact is published.

```sh
pnpm release:desktop:policy
pnpm release:desktop:status
```

Windows, Linux, macOS x64, automatic update, automatic rollback, and remote crash reporting are
unsupported in desktop 1.0. See the
[desktop release runbook](../../docs/desktop-release-runbook.md) and
[capability audit](../../docs/desktop-release-capability-audit.md). Forge configuration or an
unpacked `.app` smoke must never be cited as distribution evidence.

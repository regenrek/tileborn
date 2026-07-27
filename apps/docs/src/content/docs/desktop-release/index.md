---
title: Desktop Release
description: Fail-closed macOS arm64 support, evidence, secrets, recovery, and publication boundary.
---

# Desktop Release

Release `0.0.1` is source-only; desktop binary distribution remains **NO-GO** and no desktop artifact is published.

macOS arm64 is the only candidate; it is not a supported release until the repository contract returns `decision: "go"` from native evidence. Automatic updates are candidate-gated for that same macOS arm64 path only. macOS x64,
Windows, Linux, and remote crash reporting are unsupported.

```sh
pnpm release:desktop:policy
pnpm release:desktop:status
```

The evidence-free status is intentionally NO-GO. A Forge maker entry, an Ubuntu build, or an
unpacked `.app` smoke does not prove a signed/notarized installer, native install, recovery, or
platform support.

## Required evidence

The macOS arm64 candidate needs all of these at once:

- a real DMG bound by SHA-256, size, version, and current source commit;
- a matching signed Squirrel.Mac ZIP for a strictly newer version;
- Developer ID signing, hardened runtime, Apple notarization, stapling, and Gatekeeper assessment;
- native mount/copy/first-launch/relaunch/update/restart with project identity persistence evidence;
- explicit publication approval and an active scoped GitHub credential.

The contract invokes the native verifier with a one-time nonce and rehashes the artifact.
It does not accept a caller-authored native receipt as proof.

The candidate updater presents Restart and Later after a verified download. Restart applies the
newer app on relaunch; Later keeps the current app running until the user restarts. The updater
does not upload project content, support bundles, crash dumps, or telemetry, and it has no
previous-version rollback, downgrade, retained installer, or last-known-good guarantee.

## Secrets and approval

Apple signing identity, Team ID, App Store Connect API key inputs, `GH_TOKEN`, and the one-run
`TILEBORNE_DESKTOP_PUBLISH_APPROVED=1` approval remain in protected operator/CI storage. Never
commit or print them. Status receipts, traces, support bundles, and project data may contain
private paths or project metadata and must stay in a restricted evidence channel.

Publication is a separate mutation. A GO receipt does not tag, upload, or publish by itself.

## Recovery and application replacement

Project-content recovery is main-process-owned: failed saves stay dirty, close remains blocked, and
the recovery snapshot is saved or explicitly discarded. Preserve a project copy before manual
repair; never edit an integrity lock merely to silence a mismatch.

If the current application must be removed and installed again, preserve project data first and
reopen through the recovery flow. This is recovery, not a verified desktop rollback guarantee.

## Performance

`pnpm release:gate -- creator-performance` enforces deterministic workload/count/size/operation
budgets for the canonical 2,048-asset, 512-behavior, and 8,192-reference corpus. Native Electron
timings from `pnpm --filter @tileborne/desktop test:creator-performance-native` are advisory
calibration only and cannot waive a deterministic failure.

For the exact manifest command, blocker meanings, Team process, native verification command,
publish boundary, and handoff checklist, use the versioned
[desktop release runbook](https://github.com/tileborne/tileborne/blob/main/docs/desktop-release-runbook.md).

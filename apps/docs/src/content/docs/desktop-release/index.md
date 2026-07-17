---
title: Desktop Release
description: Fail-closed macOS arm64 support, evidence, secrets, recovery, rollback, and publication boundary.
---

# Desktop Release

Release `0.0.1` is source-only; desktop binary distribution remains **NO-GO** and no desktop artifact is published.

macOS arm64 is the only candidate; it is not a supported release until the repository contract returns `decision: "go"` from native evidence. macOS x64,
Windows, Linux, automatic updates/rollback, and remote crash reporting are unsupported.

```sh
pnpm release:desktop:policy
pnpm release:desktop:status
```

The evidence-free status is intentionally NO-GO. A Forge maker entry, an Ubuntu build, or an
unpacked `.app` smoke does not prove a signed/notarized installer, native install, rollback, or
platform support.

## Required evidence

The macOS arm64 candidate needs all of these at once:

- a real DMG bound by SHA-256, size, version, and current source commit;
- Developer ID signing, hardened runtime, Apple notarization, stapling, and Gatekeeper assessment;
- native mount/copy/first-launch/relaunch with a created Battle Royale project;
- a distinct earlier retained installer in the approved Team/LKG allowlist;
- a verifier-created and restored project backup before downgrade;
- retained-installer reinstall and successful project reopen;
- explicit publication approval and an active scoped GitHub credential.

The contract invokes the native verifier with a one-time nonce and rehashes the artifacts and backup.
It does not accept a caller-authored native receipt as proof.

## Secrets and approval

Apple signing identity, Team ID, App Store Connect API key inputs, `GH_TOKEN`, and the one-run
`TILEBORNE_DESKTOP_PUBLISH_APPROVED=1` approval remain in protected operator/CI storage. Never
commit or print them. Status receipts, traces, support bundles, and project backups may contain
private paths or project metadata and must stay in a restricted evidence channel.

Publication is a separate mutation. A GO receipt does not tag, upload, or publish by itself.

## Recovery and rollback

Project-content recovery is main-process-owned: failed saves stay dirty, close remains blocked, and
the recovery snapshot is saved or explicitly discarded. Preserve a project copy before manual
repair; never edit an integrity lock merely to silence a mismatch.

A desktop downgrade is stricter: verify the candidate and approved retained DMGs, create and restore
the project backup, replace the application with the retained installer, and prove the restored
project reopens. Do not downgrade first and hope schema compatibility holds.

## Performance

`pnpm release:gate -- creator-performance` enforces deterministic workload/count/size/operation
budgets for the canonical 2,048-asset, 512-behavior, and 8,192-reference corpus. Native Electron
timings from `pnpm --filter @tileborne/desktop test:creator-performance-native` are advisory
calibration only and cannot waive a deterministic failure.

For the exact manifest command, blocker meanings, Team/LKG process, native verification command,
publish boundary, and handoff checklist, use the versioned
[desktop release runbook](https://github.com/tileborne/tileborne/blob/main/docs/desktop-release-runbook.md).

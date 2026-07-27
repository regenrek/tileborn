# Signed automatic updates for macOS arm64 GitHub releases

## Summary

Add signed automatic updates to the supported macOS arm64 direct-download app
through Electron's built-in `autoUpdater` and the public GitHub Release channel.
The feature extends the existing desktop release contract; it does not create a
second release pipeline or a rollback system.

## Goals

- Discover, download, stage, and apply only newer stable Tileborne macOS arm64
  releases from `regenrek/tileborn`.
- Keep the runtime lifecycle in Electron main and expose only a narrow typed
  status/command bridge to the renderer.
- Produce the signed ZIP update asset required by Squirrel.Mac alongside the
  existing signed/notarized DMG.
- Prove the full update lifecycle with a local, non-publishing feed and preserve
  project identity/data across restart.

## Non-Goals

- Desktop rollback, downgrade, retained installers, LKG selection, or automatic
  fallback to an earlier app version.
- Publishing a tag, GitHub Release, or artifact during implementation or goal
  verification.
- Mac App Store, Windows, Linux, macOS x64, staged rollout, or private feeds.
- Moving project migration, backup, or recovery ownership into the updater.

## Assumptions

- `regenrek/tileborn` remains public and stable releases use SemVer tags.
- Developer ID signing/notarization credentials remain external and are used
  only by the existing release boundary.
- Production uses `https://update.electronjs.org`; test feed overrides are
  available only to the packaged verification harness.

## Refinement 2026-07-26T11:14:04.199827Z

This plan is the dedicated implementation refinement for pending TASK-006 / item i-prove-retained-installer-manual-d700 in product plan pln-2a769f52; do not duplicate or replace its canonical release owners.

## Refinement 2026-07-26T11:14:04.208596Z

Hard constraint: no desktop rollback, downgrade, retained installer, LKG selection, synthetic fallback release, or allow-any-version behavior may be introduced.

## Refinement 2026-07-26T11:14:04.215404Z

Verification is local and non-publishing only: no git tag, GitHub Release, upload, App Store, npm, Homebrew, Cloudflare, bucket, DNS, or other remote mutation without explicit maintainer approval.

## Refinement 2026-07-26T11:14:04.223166Z

Architecture: Electron main owns autoUpdater lifecycle; Forge/release scripts own signed DMG+ZIP/feed provenance; shared/preload exposes typed status/actions; renderer owns presentation; existing services-app/core owners retain project persistence/migrations.

## Refinement 2026-07-26T11:14:04.229785Z

Goal oracle: install temporary signed packaged version A, preserve a representative project, discover/download strictly newer signed version B from a loopback Squirrel.Mac feed, restart into B, verify version and project data, and record that no remote mutation occurred.

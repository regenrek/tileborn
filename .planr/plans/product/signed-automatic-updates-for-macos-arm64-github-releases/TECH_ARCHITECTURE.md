# Technical Architecture

## Components

- `apps/desktop/src/main`: runtime owner for Electron `autoUpdater` lifecycle,
  scheduling, state machine, restart coordination, and local diagnostics.
- `apps/desktop/src/shared` plus preload: shared pure update state/commands and a
  channel-allowlisted bridge. Renderer owns presentation only.
- `apps/desktop/electron-forge.config.cjs` and
  `apps/desktop/scripts/desktop-release-forge.cjs`: signed app, DMG, update ZIP,
  deterministic naming, and make-result validation.
- `scripts/desktop-release-*` and closeout scripts: canonical release/update
  policy, artifact/feed metadata validation, receipts, and publish gating.
- Existing `packages/services-app` and `packages/core` persistence/versioning
  owners: project save, recovery, migrations, and compatibility.

## Data Flow

Packaged app version -> immutable production feed URL for
`regenrek/tileborn/darwin-arm64` -> update metadata -> Squirrel.Mac signed ZIP
download -> main-process state event -> user restart/later decision ->
`quitAndInstall` -> relaunched newer version -> existing project reopen.

The release pipeline creates DMG and ZIP from the same signed/notarized app and
binds both to source/version/bundle/team/platform/architecture provenance. The
verification path substitutes a loopback/local feed through a test-only main
process dependency; production renderer input cannot alter the feed.

## Failure Modes

- Missing/invalid metadata, non-newer versions, wrong platform/architecture,
  unexpected asset names, signature discontinuity, download failure, or update
  errors transition to a bounded actionable error state and keep the current app.
- Repeated checks are serialized; timers and listeners are disposed on shutdown.
- Restart waits for the existing dirty-document close/save contract; cancellation
  leaves the update staged for later and never bypasses project persistence.
- No failure path downloads or selects an older release, stores an LKG installer,
  or invokes release publication.

## Ownership Decision

- Runtime owner: Electron main process.
- First fix owner: `apps/desktop/src/main` plus the existing Forge/release scripts.
- Canonical long-term owner: main process for lifecycle, release pipeline for
  feed/artifacts, shared desktop contracts for pure state, existing persistence
  services for migrations and project safety.
- Competing owners that are wrong: renderer-side downloading/installing,
  `packages/services-app` owning updater policy, or release verifiers becoming a
  second runtime updater.
- Cleanup direction: one updater state machine, one feed resolver, one release
  artifact contract; remove temporary adapters after the local oracle is wired.

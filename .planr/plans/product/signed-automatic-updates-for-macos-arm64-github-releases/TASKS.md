# Tasks

### TASK-001: Lock the updater ownership and protocol contract

Goal:
Define one main-process updater state machine, immutable production feed policy,
typed IPC contract, release artifact contract, and test-only feed seam.

Acceptance criteria:
- Electron main, renderer, preload/shared contracts, release pipeline, and
  project-persistence owners are explicit and non-overlapping.
- Production is locked to `regenrek/tileborn`, stable SemVer, darwin-arm64,
  `dev.tileborne.app`, and configured Developer ID team continuity.
- Contract tests reject renderer feed injection, same/lower versions, rollback,
  downgrade, LKG, and retained-installer fields or behavior.

### TASK-002: Produce and validate the signed macOS update artifact

Goal:
Extend the canonical Forge/release pipeline to emit a signed macOS arm64 ZIP
alongside the DMG and bind both to one provenance record.

Acceptance criteria:
- Release mode uses `@electron-forge/maker-zip` and deterministic asset naming
  recognized by `update.electronjs.org` for darwin-arm64.
- DMG and ZIP derive from the same signed/notarized app, source, version, bundle
  id, architecture, and Developer ID team; checksums are verified fail-closed.
- Make-result, manifest, closeout, and negative-tamper tests cover both artifacts
  without weakening publication approval or credential boundaries.

### TASK-003: Implement the Electron main update lifecycle

Goal:
Add the packaged-only `autoUpdater` service with serialized discovery, download,
staging, restart, disposal, and bounded diagnostics.

Acceptance criteria:
- Startup/manual/bounded periodic checks share one lifecycle and one immutable
  production feed resolver; development is disabled by default.
- Main maps Electron events into the typed state contract and handles no-update,
  network, metadata, download, and signature failures without exiting the app.
- `quitAndInstall` is callable only after ready state and never enables an older
  version or bypasses the existing app shutdown lifecycle.

### TASK-004: Add the narrow update bridge and accessible UI

Goal:
Expose update state and actions through allowlisted preload channels and existing
Tileborne settings/notification surfaces.

Acceptance criteria:
- Renderer can read/subscribe/check/restart but cannot provide a URL, path,
  version, signature, or artifact.
- Users see current version, checking/progress/up-to-date/ready/error, Restart,
  Later, and retry states with keyboard/screen-reader coverage.
- Restart coordinates with existing dirty-document save/close; cancellation
  leaves the current session usable and the staged update available for later.

### TASK-005: Build the non-publishing signed update oracle

Goal:
Prove a real packaged macOS arm64 A-to-B update through a loopback/local feed.

Acceptance criteria:
- Temporary signed versions A and B are built from the scoped branch; B is
  strictly newer and served in Squirrel.Mac-compatible metadata without remote
  tag, release, upload, or provider mutation.
- Native verification installs A, creates/opens a representative project,
  discovers/downloads B, restarts into B, and proves the same project data.
- Failure fixtures cover stale/same version, wrong architecture/bundle/team,
  malformed/unavailable/interrupted feed, and leave A/project data usable.
- Temporary fixtures are not committed or designated as retained/LKG installers.

### TASK-006: Integrate policy, docs, and clean-checkout gates

Goal:
Make the updater part of the canonical release status without creating a second
policy path or prematurely claiming support.

Acceptance criteria:
- Desktop policy/manifest/status/closeout/docs derive update support and evidence
  from the canonical machine contract; baseline remains fail-closed.
- Maintainer/user docs explain automatic updates, Restart/Later, privacy,
  recovery, limitations, and operator-only publication with no rollback claim.
- Focused tests, typecheck, lint, build, release gates, security leak checks,
  clean checkout, generated-file checks, and `git diff --check` pass.

### TASK-007: Independently review and close signed automatic updates

Goal:
Audit architecture ownership, signed artifact continuity, native behavior,
project safety, and mutation boundaries before changing the support claim.

Acceptance criteria:
- Independent review replays material unit/contract/UI/native evidence and closes
  every actionable finding.
- Review confirms no duplicate updater, downgrade/rollback/LKG/retained installer,
  secret leak, tag, GitHub Release, upload, App Store, npm, Homebrew, Cloudflare,
  or other remote mutation.
- `capability.auto-update` changes from unsupported only after the signed A-to-B
  oracle passes and the final Planr audit holds.

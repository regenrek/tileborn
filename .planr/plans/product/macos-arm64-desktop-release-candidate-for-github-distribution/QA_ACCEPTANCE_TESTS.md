# QA Acceptance Tests

## Acceptance

- Build from a clean macOS arm64 checkout with frozen dependencies.
- Verify Developer ID signature, hardened runtime, notarization ticket, stapling,
  Gatekeeper acceptance, DMG integrity, manifest schema, and SHA-256.
- Install, launch, close, and relaunch the app from the DMG.
- Create a representative Tileborne project, close the app, relaunch it, and
  verify the same project remains listed.
- Discover and safely stage a newer signed release from a non-publishing fixture
  feed; reject wrong-channel, wrong-architecture, unsigned, and stale metadata.
- Prove an unavailable or interrupted update leaves the installed app and
  project data usable.
- Confirm Planr evidence and candidate receipts are redacted and unpublished.

## Regression

- Existing source release gates, desktop smoke, clean-checkout gates, project
  persistence/recovery tests, security scans, and package boundaries remain green.
- Unsupported makers and publication commands remain fail-closed.
- Tampered artifact, manifest, checksum, source revision, version, architecture,
  signing identity, and notarization evidence are rejected.

## Manual Scenarios

- Fresh macOS user profile with Gatekeeper enabled.
- Missing signing identity or notarization profile.
- Project persistence failure and safe retry.
- Candidate launch followed by no-update, update-available, invalid-update, and
  interrupted-update states without project-data mutation.
- Maintainer inspects the candidate locally but withholds publication approval.

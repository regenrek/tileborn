# QA Acceptance Tests

## Acceptance

- Unit: state machine ordering, serialized checks, version/channel validation,
  timer disposal, error normalization, and restart gating.
- Contract: Forge emits DMG plus correctly named macOS arm64 ZIP from one signed
  app; manifest binds both artifacts and signing identity.
- IPC/UI: allowlisted commands/events, no renderer feed override, accessible
  check/progress/ready/error flows, and close cancellation honored.
- Native oracle: install signed fixture A, create/open a representative project,
  discover/download signed newer fixture B from a loopback feed, restart into B,
  and verify the same project identity/data.

## Regression

- Same/lower version, prerelease, wrong architecture, wrong bundle/team,
  malformed metadata, 204/no update, offline, interrupted download, duplicate
  checks, and untrusted signing fail safely.
- Existing DMG signing/notarization/Gatekeeper, publication blockers, project
  persistence, docs contract, and clean-checkout gates remain green.
- Search/contract tests reject rollback, downgrade, LKG, retained-installer, or
  automatic-update-supported claims before the complete oracle passes.

## Manual Scenarios

- Check manually from Settings/About while up to date.
- Download in background, choose Later, then apply on a later clean restart.
- Cancel restart because of an unsaved document and confirm editing continues.
- Simulate network failure and retry without app/project corruption.

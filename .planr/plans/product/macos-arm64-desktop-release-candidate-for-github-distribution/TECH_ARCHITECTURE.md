# Technical Architecture

## Components

- Desktop release scripts and the release workflow own candidate orchestration,
  provenance, checksums, native verification, and publish gating.
- Electron Forge configuration owns bundle metadata, hardened runtime,
  entitlements, signing, notarization, and DMG maker configuration.
- Existing project persistence/application services remain the sole owner of
  project save, reopen, backup, migration, and compatibility behavior.
- The Electron main process owns update discovery, user-visible lifecycle state,
  staging, and restart coordination. Renderer code consumes a narrow IPC state
  contract and never downloads or installs updates directly.
- The desktop release pipeline owns GitHub feed metadata and signed update
  artifacts. No GitHub Release mutation is part of candidate verification.

## Data Flow

Clean source revision -> frozen dependency graph -> tested application build ->
signed application -> notarized/stapled DMG -> manifest/checksum -> native
Gatekeeper install/relaunch -> project relaunch-persistence -> signed update
discovery/staging -> independent review. Every gate is fail-closed
and feeds one redacted candidate receipt; no parallel release-status
implementation is allowed.

## Failure Modes

- Missing or mismatched credentials, identities, source metadata, architecture,
  signatures, notarization, stapling, checksums, native evidence, project
  relaunch-persistence, or update evidence leave the candidate NO-GO.
- Credential values stay in Keychain/provider-native secret storage. Repository
  code may name required profiles but cannot persist values.
- Runtime game deployment, Cloudflare Workers, App Store tooling, automatic
  downgrade/rollback, and crash reporting are outside this architecture slice.

# Technical Architecture

## Components

- Desktop release scripts and the release workflow own candidate orchestration,
  provenance, checksums, native verification, and publish gating.
- Electron Forge configuration owns bundle metadata, hardened runtime,
  entitlements, signing, notarization, and DMG maker configuration.
- Existing project persistence/application services remain the sole owner of
  project backup, migration, open/save/reopen, and compatibility behavior.
- GitHub is only the eventual artifact channel. No GitHub Release mutation is
  part of candidate construction or verification.

## Data Flow

Clean source revision -> frozen dependency graph -> tested application build ->
signed application -> notarized/stapled DMG -> manifest/checksum -> native
Gatekeeper install/relaunch -> project backup/reopen -> retained-installer
rollback -> independent review. Every gate is fail-closed and feeds one redacted
candidate receipt; no parallel release-status implementation is allowed.

## Failure Modes

- Missing or mismatched credentials, identities, source metadata, architecture,
  signatures, notarization, stapling, checksums, native evidence, backups, or
  rollback artifacts leave the candidate NO-GO.
- Credential values stay in Keychain/provider-native secret storage. Repository
  code may name required profiles but cannot persist values.
- Runtime game deployment, Cloudflare Workers, App Store tooling, automatic
  updates, and crash reporting are outside this architecture slice.

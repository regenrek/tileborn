# Release Readiness

## Packaging

- Current evidence: Electron Forge defines DMG, Squirrel, deb, and rpm makers and packages a portable runtime closure; code signing is explicitly deferred in configuration.
- Required: reproduce package/make from a clean checkout, verify contents/checksums and external-cwd runtime closure, then run native install/launch checks per claimed platform.
- Apple signing/notarization, Windows signing, update feed/provider/signature validation, artifact publishing, and rollback are release decisions with owners and credentials, not inferred features.
- Shipped game-host artifact keeps worker, behavior worker, maps, plugin runtime, config, manifest, and checksums together.

## Documentation

- Creator quickstart and first-game recovery guide.
- SDK/agent deterministic scripting guide and diagnostic repair examples.
- Project compatibility, backup, restore, migration, and unsupported-version policy.
- Maintainer release runbook, support matrix, secrets, signing/notarization/update status, artifact provenance, rollback, and known caveats.
- Changelog/release notes and exact external steps requiring maintainer approval.

## Verification

Release candidate is go only if the tree and Planr map are clean, hermetic gates pass, supported-platform native evidence exists, the final live Electron and isolated artifact oracle pass, security/privacy checks pass, and rollback/backup restoration is demonstrated. Missing external credentials may be recorded as a blocker, but a public production release remains no-go until the associated credentialed proof is completed.

# Product Specification

## Problem

Tileborne 0.0.1 is currently a source preview. The Electron application can be
packaged locally, but an unpacked or ad-hoc-signed `.app` is not a distributable
desktop release. A direct-download macOS arm64 release needs one fail-closed,
replayable path from a clean source revision to a Developer ID-signed,
Apple-notarized and stapled DMG with immutable provenance, native installation
evidence, project-data safety, and a fail-safe automatic-update path.

## Users

- Maintainers producing a Tileborne desktop release candidate.
- macOS arm64 creators installing Tileborne from GitHub Releases.
- Reviewers auditing artifact identity, signing, notarization, installation,
  project compatibility, update safety, and secret isolation before publication.

## Requirements

- Support only direct-download macOS arm64 for this goal. Do not claim Mac App
  Store, macOS x64, Windows, Linux, or remote crash reporting.
- Produce a deterministic closed-schema release manifest and SHA-256 checksums
  tied to source revision, version, platform, architecture, bundle identity,
  artifact digest, runner identity, and signing/notarization verification.
- Build a DMG whose application passes Developer ID signing, notarization,
  stapling, `codesign`, `spctl`, and package integrity checks.
- Resolve signing and notarization inputs through Keychain or provider-native
  references. Missing or inconsistent credentials must fail closed without
  exposing secret values in logs, receipts, Planr, or Git.
- Install and relaunch the candidate under Gatekeeper on macOS arm64, create a
  representative Tileborne project in isolated user data, and verify that the
  same project remains listed after relaunch.
- Provide an automatic-update path backed by signed GitHub release artifacts.
  Update discovery and staging must fail safely, must not mutate project data,
  and must never treat an unsigned or unverifiable artifact as installable.
- Keep project and user data outside the application bundle. Before any future
  incompatible project-data migration, create a recoverable backup through the
  existing persistence owner. Downgrade support is not a v0.0.1 release gate.
- Run the complete clean-checkout release ladder and independent review.
- Keep tag creation, tag push, GitHub Release creation/upload, npm/Homebrew
  publication, App Store submission, Cloudflare mutation, and all other remote
  publication outside autonomous scope until the maintainer explicitly approves.

## Success Criteria

- A clean macOS arm64 checkout produces one signed, notarized, stapled DMG plus
  manifest and checksum files without publishing them.
- Manifest and artifact verification fail on tampering, source/version drift,
  unsupported architecture, missing credentials, failed signing/notarization,
  or missing native evidence.
- Gatekeeper accepts a fresh installation and the installed app launches after
  the canonical close-and-relaunch smoke.
- A representative project remains available after installation and relaunch,
  and an unavailable, invalid, or interrupted update leaves the
  currently installed application and project data usable.
- Clean-checkout CI/release gates and independent review complete with replayable,
  redacted receipts, while repository and Planr scans contain no credentials.
- `planr plan audit` reports the stored goal contract holds and no publication
  action has occurred.

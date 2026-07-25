# Product Specification

## Problem

Tileborne 0.0.1 is currently a source preview. The Electron application can be
packaged locally, but an unpacked or ad-hoc-signed `.app` is not a distributable
desktop release. A direct-download macOS arm64 release needs one fail-closed,
replayable path from a clean source revision to a Developer ID-signed,
Apple-notarized and stapled DMG with immutable provenance, native installation
evidence, project-data safety, and a tested manual rollback.

## Users

- Maintainers producing a Tileborne desktop release candidate.
- macOS arm64 creators installing Tileborne from GitHub Releases.
- Reviewers auditing artifact identity, signing, notarization, installation,
  project compatibility, rollback, and secret isolation before publication.

## Requirements

- Support only direct-download macOS arm64 for this goal. Do not claim Mac App
  Store, macOS x64, Windows, Linux, automatic updates, or remote crash reporting.
- Produce a deterministic closed-schema release manifest and SHA-256 checksums
  tied to source revision, version, platform, architecture, bundle identity,
  artifact digest, runner identity, and signing/notarization verification.
- Build a DMG whose application passes Developer ID signing, notarization,
  stapling, `codesign`, `spctl`, and package integrity checks.
- Resolve signing and notarization inputs through Keychain or provider-native
  references. Missing or inconsistent credentials must fail closed without
  exposing secret values in logs, receipts, Planr, or Git.
- Install and relaunch the candidate under Gatekeeper on macOS arm64, then open
  a backed-up Tileborne project and verify that project data remains intact.
- Retain and digest-pin a last-known-good signed installer, document supported
  downgrade compatibility, and prove manual rollback plus project reopen.
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
- A verified project backup can be opened without loss by the candidate and by
  the retained last-known-good installer after manual rollback.
- Clean-checkout CI/release gates and independent review complete with replayable,
  redacted receipts, while repository and Planr scans contain no credentials.
- `planr plan audit` reports the stored goal contract holds and no publication
  action has occurred.

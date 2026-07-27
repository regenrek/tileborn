# Product Specification

## Problem

The signed macOS arm64 app can be installed manually but cannot discover or
apply newer releases. Users must repeatedly download and replace the app, while
the release policy correctly marks automatic updates unsupported.

## Users

- Tileborne creators using the direct-download macOS arm64 application.
- Maintainers producing signed, notarized GitHub Release artifacts.

## Requirements

- Check for updates after packaged-app startup and on explicit user request,
  with bounded periodic checks and no checks in development/test unless enabled.
- Accept only a newer stable SemVer release for `regenrek/tileborn`,
  `darwin-arm64`, bundle id `dev.tileborne.app`, and the configured Developer ID
  signing continuity.
- Download in the background, report checking/available/downloading/ready/error
  states, and apply only after an explicit restart action or normal later exit.
- Network, metadata, download, signature, interruption, and installation errors
  leave the installed app and project data usable.
- Production feed configuration is immutable from renderer input. Local feed
  injection exists only behind the packaged verification harness.
- No updater path may select an older version, retain an installer as LKG, or
  claim rollback support.

## Success Criteria

- A signed packaged version A discovers a signed version B from a local fixture
  feed, downloads it, restarts into B, and reopens with the same representative
  project identity/data.
- Stale, same-version, wrong-architecture, malformed, unavailable, interrupted,
  and wrong-signing fixtures fail safely with actionable status.
- Release contract, docs, clean-checkout gates, and an independent review agree
  that auto-update is supported while rollback remains unsupported.
- Verification performs no tag, release, upload, App Store, npm, Homebrew,
  Cloudflare, or other remote mutation.

# Release Readiness

## Packaging

- macOS arm64 direct-download DMG only.
- Developer ID signed, Apple notarized, stapled, Gatekeeper accepted.
- Closed-schema manifest and SHA-256 accompany the retained local candidate.
- Mac App Store, macOS x64, Windows, Linux, npm, and Homebrew are excluded.

## Documentation

- System requirements, installation, checksum verification, project persistence,
  automatic-update behavior, recovery, known limitations, and support boundary
  are current.
- GitHub publication steps remain operator-only and are not executed by this goal.

## Verification

- Clean-checkout source gates pass.
- Native package/sign/notary/staple/install/relaunch oracle passes.
- Project relaunch-persistence and fail-safe automatic-update oracle passes.
- Independent review and secret scanning pass with redacted evidence.
- No tag, upload, release, App Store, npm, Homebrew, or Cloudflare mutation occurs.

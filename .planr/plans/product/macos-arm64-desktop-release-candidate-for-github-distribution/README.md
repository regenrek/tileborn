# macOS arm64 desktop release candidate for GitHub distribution

## Summary

## Goals

## Non-Goals

## Assumptions


## Refinement 2026-07-25T18:09:19.194764Z

Distribution scope is a direct-download macOS arm64 DMG through GitHub Releases; Mac App Store, macOS x64, Windows, Linux, npm, Homebrew, automatic updates, remote crash reporting, persistent Cloudflare deployment, and product feature work are out of scope.

## Refinement 2026-07-25T18:09:19.269618Z

Tagging, pushing a tag, creating or uploading a GitHub Release, and any publication remain operator-approved actions and must not occur during autonomous implementation without explicit user approval.

## Refinement 2026-07-25T18:09:19.34875Z

Credentials already exist according to the maintainer, but secrets, certificates, passwords, API keys, notarization credentials, profiles, and release receipts must remain outside Git and Planr evidence. The implementation must use keychain/provider-native credential references and fail closed when unavailable.

## Refinement 2026-07-25T18:09:19.427366Z

Canonical owners: desktop release workflow and scripts own artifact production, signing, notarization, manifest/checksum, and publish gating; Electron configuration owns packaging metadata and entitlements; project persistence owners supply backup/reopen compatibility checks without duplicating release policy.

## Refinement 2026-07-25T18:09:19.506259Z

Goal oracle: from a clean macOS arm64 checkout, produce a deterministic signed/notarized DMG plus closed-schema manifest and SHA-256, pass codesign/spctl/stapler verification, install and relaunch under Gatekeeper, open a verified project backup without data loss, then reinstall the retained last-known-good signed installer and prove rollback/reopen compatibility.

## Refinement 2026-07-25T18:09:19.585148Z

Independent review must verify architecture ownership, secret isolation, fail-closed behavior, reproducible evidence, unsupported-platform non-claims, and that no tag, upload, publish, App Store, npm, Homebrew, or Cloudflare mutation occurred.

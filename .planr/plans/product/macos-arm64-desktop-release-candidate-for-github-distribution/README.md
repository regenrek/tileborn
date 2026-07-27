# macOS arm64 desktop release candidate for GitHub distribution

## Summary

## Goals

## Non-Goals

## Assumptions


## Refinement 2026-07-25T18:09:19.194764Z

Distribution scope is a direct-download macOS arm64 release through GitHub Releases; the signed automatic-update channel remains a pending requirement for its own implementation, tests, and review. Mac App Store, macOS x64, Windows, Linux, npm, Homebrew, remote crash reporting, persistent Cloudflare deployment, and unrelated product feature work are out of scope.

## Refinement 2026-07-25T18:09:19.269618Z

Tagging, pushing a tag, creating or uploading a GitHub Release, and any publication remain operator-approved actions and must not occur during autonomous implementation without explicit user approval.

## Refinement 2026-07-25T18:09:19.34875Z

Credentials already exist according to the maintainer, but secrets, certificates, passwords, API keys, notarization credentials, profiles, and release receipts must remain outside Git and Planr evidence. The implementation must use keychain/provider-native credential references and fail closed when unavailable.

## Refinement 2026-07-25T18:09:19.427366Z

Canonical owners: desktop release workflow and scripts own artifact production, signing, notarization, manifest/checksum, and publish gating; Electron configuration owns packaging metadata and entitlements; project persistence owners supply save, reopen, migration, and compatibility semantics without duplicating release policy.

## Refinement 2026-07-25T18:09:19.506259Z

Goal oracle: from a clean macOS arm64 checkout, produce a deterministic signed/notarized DMG plus closed-schema manifest and SHA-256, pass codesign/spctl/stapler verification, install and relaunch under Gatekeeper, create a representative project, verify that the same project remains listed after relaunch, and prove that the application can discover and safely stage only a newer signed GitHub release without publishing one during verification.

## Refinement 2026-07-25T18:09:19.585148Z

Independent review must verify architecture ownership, secret isolation, fail-closed behavior, reproducible evidence, unsupported-platform non-claims, and that no tag, upload, publish, App Store, npm, Homebrew, or Cloudflare mutation occurred.

## Refinement 2026-07-26T09:25:51.825546Z

Scope correction approved by the maintainer: remove the retained last-known-good installer and manual downgrade/rollback proof from the macOS v0.0.1 release gate. Keep automatic-update capability in scope, require only signed/notarized update artifacts, fail-safe update behavior, project/user data outside the app bundle, and backup before any incompatible data migration. Manual reinstall of the current release is recovery, not rollback. Do not invent a synthetic earlier release.

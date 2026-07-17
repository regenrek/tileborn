# Creator Production Hardening & Release 1.0

## Summary

Turn the completed Battle Royale Creator Vertical and first-class TypeScript Gameplay SDK into one clean, reviewable, reproducible release-candidate baseline. The scope begins with the existing dirty worktree and ends with a clean committed candidate whose editor, shipped game, recovery paths, performance budgets, and release limitations are independently proven.

## Goals

- Preserve and consolidate the existing implementation without resetting, overwriting, or silently dropping user changes.
- Make Planr, source control, CI, release documentation, and packaged artifacts describe the same canonical candidate.
- Close creator-facing onboarding, recovery, and large-project performance gaps needed for a credible 1.0 authoring experience.
- Prove project-format compatibility, backup/restore, desktop packaging, and shipped-artifact execution with replayable evidence.
- Produce an explicit go/no-go report for signing, notarization, updates, crash reporting, publishing, and cross-platform support.

## Non-Goals

- Adding another game genre, a second behavior runtime, TypeScript-to-visual round-tripping, or a universal Blueprint graph.
- Publishing, tagging, deploying, pushing, signing with private credentials, or mutating external accounts without separate maintainer approval.
- Rewriting already verified Battle Royale or Gameplay SDK systems merely to reduce the worktree size.
- Claiming Windows or Linux production support from configuration alone; support requires platform-native evidence.

## Assumptions

- `pln-d39bcb7f` and `pln-059cc827` remain the accepted functional source plans.
- The current worktree contains intentional user and agent work. Every change must be classified before commit; destructive cleanup is forbidden.
- macOS is the currently documented desktop support target. DMG, Squirrel, deb, and rpm makers exist, while code signing is explicitly deferred in Forge configuration.
- Credentialed publish/deploy operations remain approval-gated; local and hermetic verification continues when credentials are unavailable.

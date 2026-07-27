---
name: macos-arm64-desktop-release-candidate-for-github-distribution-remove-desktop-rollback-gate
overview: "Build plan for macOS arm64 desktop release candidate for GitHub distribution - Remove desktop rollback gate."
todos:
  - id: remove-rollback-contract
    content: "Remove retained-installer rollback from the canonical release contract and native verifier"
    status: pending
  - id: align-release-docs-tests
    content: "Align release policy, closeout, documentation, and regression tests with recovery-only v0.0.1 scope"
    status: pending
isProject: false
stage: build
source_plan: pln-2a769f52
slice: "Remove desktop rollback gate"
---

# macOS arm64 desktop release candidate for GitHub distribution - Remove desktop rollback gate

## Scope Decision

Hard-cut the synthetic prior-release requirement from desktop v0.0.1. A
candidate no longer needs a retained DMG, LKG allowlist entry, backup-output
argument for downgrade, or reinstall/downgrade receipt to satisfy the artifact
contract. Keep Developer ID signing, notarization, stapling, Gatekeeper,
provenance, project-data preservation, and publication approval boundaries.

Automatic updates remain required by product TASK-006 but are not falsely
reported as implemented by this cleanup slice.

## Ownership Target

- `scripts/desktop-release-contract.mjs` remains the canonical release-policy
  evaluator and manifest/status owner.
- `scripts/native-desktop-release-closeout.mjs` remains the non-publishing native
  candidate orchestrator.
- The macOS verifier retains install/relaunch/project-safety checks only; it no
  longer owns downgrade behavior.
- Existing project persistence services remain the only project backup and
  migration owner.

## Existing Leverage

- The successful external closeout receipt for commit `79cea65` already proves
  signing, notarization, stapling, Gatekeeper, architecture, provenance, and
  packaged-app smoke independently of the missing retained artifact.
- Existing contract and documentation tests enumerate every rollback field and
  blocker, making the hard cut mechanically verifiable.

## Phase 1

- [ ] Remove retained/LKG/rollback fields, arguments, blockers, and evaluator
  branches from the release policy and contract.
- [ ] Reduce the native verifier to candidate install/relaunch/project-data
  safety, deleting downgrade-only behavior rather than leaving a dormant path.
- [ ] Update closeout status construction so a verified candidate is not blocked
  by a nonexistent prior release.
- [ ] Align maintainer/user documentation and focused tests with recovery-only
  v0.0.1 semantics and the separately planned automatic-update capability.

## Out Of Scope

- Implementing or claiming the automatic updater itself.
- Publishing a tag, GitHub Release, update feed, or artifact.
- App Store, Windows, Linux, macOS x64, npm, Homebrew, Cloudflare, or crash
  reporting work.
- Changing project schema or persistence ownership.

## Verification

- Focused desktop release contract, closeout, and documentation tests pass.
- `pnpm release:desktop:policy` passes with no rollback/LKG requirement.
- Repository search finds no retained-installer or manual-downgrade release gate
  in canonical release code/docs.
- Full relevant release gates remain green without publication credentials.

## Acceptance Criteria

- A valid signed/notarized/stapled candidate is no longer `NO-GO` solely because
  no earlier Tileborne desktop release exists.
- CLI/status schemas no longer require `--retained-artifact`, LKG metadata, or a
  downgrade backup output.
- Removing/reinstalling the current app is documented as recovery, not rollback.
- Automatic update remains a distinct pending implementation item and is not
  marked supported until its own tests and review close.
- No credentials, publication mutation, unrelated user edits, or duplicate
  release-status implementation are introduced.

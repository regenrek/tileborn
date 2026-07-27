# Tasks

### TASK-001: Lock desktop release ownership and fail-closed policy

Goal:
Reconcile the existing release audit, runbook, Electron maker configuration,
scripts, workflow, and project-persistence boundaries into one canonical macOS
arm64 direct-download contract.

Acceptance criteria:
- Release policy names one owner for packaging/provenance, one for Electron
  metadata/entitlements, and one existing owner for backup/reopen semantics.
- Unsupported platforms/channels and operator-only mutations are machine-readable
  and tested as non-claims.
- Credential names and presence checks are documented without recording values.

### TASK-002: Implement deterministic desktop manifest and checksum verification

Goal:
Create the closed-schema provenance record and verifier for a desktop candidate.

Acceptance criteria:
- Manifest binds source revision, version, platform, architecture, bundle id,
  artifact filename/digest, runner identity, and signing/notary evidence.
- Generation is deterministic for identical inputs and verification rejects
  tampering, mismatched source/version, unknown fields, and unsupported targets.
- Focused tests and clean generated-file checks are logged.

### TASK-003: Produce a Developer ID-signed notarized and stapled DMG

Goal:
Make the canonical macOS arm64 packaging path consume protected credential
references and emit a locally retained release candidate.

Acceptance criteria:
- Electron packaging uses the approved bundle metadata, hardened runtime,
  entitlements, signing identity, notarization profile, and DMG configuration.
- Missing/invalid credentials fail before a candidate can be marked releasable.
- `codesign`, notarization, stapler, `spctl`, and checksum evidence is redacted
  and attached to the candidate manifest.

### TASK-004: Add a non-publishing macOS arm64 release workflow

Goal:
Run candidate construction and verification from a clean checkout without
creating tags, releases, uploads, or other remote publication state.

Acceptance criteria:
- A native macOS arm64 job runs frozen install, source gates, packaging,
  signing/notarization, manifest generation, and artifact verification.
- The workflow uses protected secret references and least-privilege permissions.
- Publish remains a separate approval-gated job or command that cannot run in
  this goal.

### TASK-005: Prove Gatekeeper installation relaunch and project-data persistence

Goal:
Exercise the DMG as an end user would and prove the candidate preserves project
identity across the first launch and relaunch in isolated user data.

Acceptance criteria:
- The DMG is mounted, copied into the supported application location, assessed
  by Gatekeeper, launched, closed, and relaunched through the canonical native
  smoke path.
- The smoke records app identity/version, creates a representative project, and
  verifies the same project remains listed after relaunch without committing
  project data or receipts.
- Failure paths leave isolated project data recoverable for local inspection.

### TASK-006: Implement the signed automatic-update path

Goal:
Let the macOS arm64 desktop application discover and safely stage newer signed
Tileborne releases from the GitHub release channel.

Acceptance criteria:
- Update lifecycle ownership lives in the Electron main process; feed and
  artifact metadata remain owned by the desktop release pipeline.
- Only a newer version with the expected channel, bundle identity, architecture,
  signing continuity, and release metadata can be staged.
- Missing, invalid, interrupted, or unavailable updates leave the installed app
  and project data untouched and provide an actionable status to the user.
- Verification uses a local or non-publishing fixture feed. It creates no tag,
  GitHub Release, upload, or other remote publication state.

### TASK-007: Run clean-checkout release gates and finalize maintainer docs

Goal:
Prove the source and native release contracts together and leave an executable,
redacted maintainer handoff.

Acceptance criteria:
- Frozen install, release gates, docs, typecheck, lint, tests, build, audit,
  diff check, desktop policy, native candidate, install, and updater gates pass.
- Documentation states direct GitHub download, system requirements, checksum
  verification, installation, automatic updates, recovery, known limitations,
  and support.
- The resulting status is release-candidate-ready but unpublished.

### TASK-008: Independently review the complete desktop candidate

Goal:
Audit ownership, security, artifact identity, native behavior, update safety, and the
absence of unauthorized publication before closing the goal.

Acceptance criteria:
- An independent reviewer replays material automated and native evidence and
  closes every actionable finding.
- Secret/leak checks pass and evidence proves no tag, GitHub Release, upload,
  App Store, npm, Homebrew, or Cloudflare mutation occurred.
- The final Planr audit reports the goal contract holds.

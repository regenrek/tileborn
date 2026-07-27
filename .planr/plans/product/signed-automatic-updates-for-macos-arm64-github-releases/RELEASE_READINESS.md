# Release Readiness

## Packaging

- Signed/notarized/stapled macOS arm64 app produces DMG and update ZIP from the
  same source/version/bundle/team identity.
- ZIP name is recognized by `update.electronjs.org` as darwin arm64.
- Update provenance/checksum is closed-schema and fail-closed.

## Documentation

- Explain automatic checks, Restart/Later behavior, manual retry, privacy,
  unsupported platforms, and recovery without rollback claims.
- Keep publication and credential steps operator-only.

## Verification

- Focused unit/contract/UI suites and clean checkout are green.
- Signed local A-to-B update oracle and project-persistence evidence are logged.
- Independent review confirms signing continuity, no downgrade/rollback/LKG,
  secret isolation, and no remote mutation.
- Only after all evidence and review close may release policy change
  `capability.auto-update` from unsupported to supported/candidate.

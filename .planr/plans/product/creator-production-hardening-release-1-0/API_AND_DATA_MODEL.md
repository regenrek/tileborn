# API And Data Model

## Objects

- `ProjectFormatVersion`: current durable version and supported upgrade range.
- `MigrationStep`: from/to version, stable id, deterministic transform, validation, and compatibility notes.
- `ProjectBackupReceipt`: project id, source version/hash, backup path, timestamp, reason, and restore verification.
- `ReadinessCheck`: stable id, severity, owner, status, message, source location, and actions.
- `ReleaseArtifactManifest`: product/runtime/plugin/behavior versions, source revision, target platform/arch, file checksums, build time, and verification state.
- `PerformanceSample`: scenario id, fixture version, environment, metric, budget, observed value, and result.
- `CrashRecoveryReceipt`: redacted failure category, affected document/job, last-known-good revision, and available recovery actions.

## Commands

- Inspect compatibility without mutation; migrate project with backup; verify/restore backup.
- Run readiness/preflight; navigate to or repair an owned problem.
- Build/package/verify artifact; emit immutable manifest/checksums.
- Export redacted diagnostics and performance evidence.

## Events

- Compatibility inspected, backup created/verified/restored, migration started/completed/rolled back.
- Readiness changed, recovery available/completed/discarded.
- Build/package verification progressed/completed/failed.
- Performance budget exceeded and crash/startup recovery detected.

All IPC additions use the canonical contract registry and runtime decoding. Stable ids and discriminated errors are required; renderer-only command shapes are forbidden.

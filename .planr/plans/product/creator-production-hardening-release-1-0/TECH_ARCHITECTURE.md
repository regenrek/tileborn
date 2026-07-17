# Technical Architecture

## Components

- **Source-control integration lane:** git inventory, generated-file policy, branch/commit decomposition, independent reviews, and clean-checkout reproduction.
- **Canonical creator services:** existing `@tileborne/services-app` project/behavior/catalog owners and IPC contracts; no renderer-owned persistence.
- **Project compatibility owner:** version detection, migration registry, pre-migration backup, atomic transaction/recovery, and fixture matrix at the service/core boundary.
- **Release coordinator:** existing services-build/CLI/desktop Ship path plus immutable artifact manifest, checksum, runtime versions, and verification receipt.
- **Desktop distribution:** Electron Forge package/makers with explicit per-platform signing and native smoke ownership.
- **Observability/recovery:** structured local diagnostics, redacted crash/startup receipts, last-known-good runtime state, and creator-visible recovery actions.
- **Performance harness:** representative large fixtures and deterministic measurements separated into CI budgets and manual/native trace budgets.

## Data Flow

`creator input -> renderer command -> typed IPC -> application service -> atomic project transaction -> durable versioned files`

`durable project -> validation/migration -> canonical map/behavior package -> playtest/Ship build -> artifact manifest + checksums -> isolated artifact boot`

`failure/performance sample -> structured diagnostic -> Problems/Runtime/Release UI -> local redacted receipt -> Planr evidence`

## Failure Modes

- Dirty-tree consolidation drops or conflates user work: prevent with pre-change inventory, explicit path sets, reviewable commits, and before/after receipts.
- Clean checkout depends on ignored/generated state: fail the hermetic checkout gate and identify the missing owner/generator.
- Migration partially writes a project: create backup first and use the existing journaled atomic revision transaction; recovery must converge to old or new state.
- Packaged app resolves workspace files: external-cwd copied-artifact boot must fail the release gate.
- Platform maker exists but artifact is unusable: label unverified until native runner evidence exists.
- Crash/update/signing infrastructure is absent: record as a release decision, not a silent assumption; implement only the minimum approved 1.0 contract.
- Performance test is noisy: distinguish deterministic operation counts/IPC batch budgets from wall-clock thresholds with calibrated tolerance and stored environment metadata.

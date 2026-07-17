# Backend Implementation

## Storage

- Persist project-owned content in a versioned, deterministic project format.
- Preserve immutable plugin-template provenance separately from project edits.
- Store document revisions/recovery drafts atomically and clean them only after
  durable confirmation.
- Persist startup map and ship configuration as project state; build artifacts
  and logs remain derived/output state.

## Services

- Project content and reference-graph service.
- Game readiness aggregation service with plugin-validator boundary.
- Document lifecycle/autosave/recovery service.
- Idempotent game-template creation service.
- Playtest preflight service bound to a readiness revision.
- Ship orchestration service over canonical build/package/preview owners.

Electron main-thread handlers return quickly and delegate filesystem scans,
preview resolution, validation batches and builds to bounded async work.

## Tests

- Runtime schema decode/round-trip and deterministic serialization.
- Service tests for CRUD, provenance, references, diagnostics and idempotency.
- IPC contract tests for success, validation, cancellation and failure.
- Atomic save/recovery/failure injection tests.
- Build/package equivalence tests between editor and CLI service callers.
- Performance tests proving bounded batch/window behavior for large libraries.

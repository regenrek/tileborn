# Backend Implementation

## Storage

- Project revision transactions persist provenance, audio bindings, shell documents, multiplayer settings, and deployment target references atomically.
- Credentials remain in environment/provider-native stores and are never serialized.
- Build artifacts contain resolved public configuration, hashes, attribution, and adapter metadata only.

## Services

- License/provenance validation joins the canonical readiness aggregator.
- Audio and shell authoring services expose typed IPC and immutable build projections.
- Multiplayer orchestration separates room ownership from mode simulation and participant lifecycle.
- Deployment orchestration runs adapters as bounded jobs with redacted logs, health verification, cancellation, and cleanup receipts.

## Tests

- Schema/property/migration and transaction fault injection.
- Worker-safe runtime and forbidden-import boundaries.
- Deterministic audio-command and shell-state tests.
- Two-mode, two-client multiplayer lifecycle and authorization tests.
- Local/Alchemy adapter contract tests, credential redaction, failed deploy/health/cleanup tests, and copied-artifact execution.

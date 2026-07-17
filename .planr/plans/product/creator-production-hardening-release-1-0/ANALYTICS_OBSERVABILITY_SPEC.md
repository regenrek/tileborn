# Analytics Observability

## Events

Local structured events cover startup, project open/migration/recovery, validation, playtest start/stop, Ship phases, artifact verification, and performance budget failures. Stable event names and schema versions are documented. Remote analytics is opt-in and out of scope unless privacy and transport are explicitly approved.

## Diagnostics

- Correlation ids connect renderer action, IPC request, service job, host process, and artifact receipt.
- Release evidence records command, revision, platform/arch, versions, duration, result, and artifact hash without secrets or absolute personal paths.
- Crash recovery distinguishes renderer reload, main-process restart, behavior-worker restart, game-host failure, and corrupted project data.
- Retention is bounded and creator-exportable; logs cannot grow without limit.

## Privacy

Default telemetry is off. Any future remote event requires documented purpose, minimal fields, retention, consent, and deletion behavior. Local diagnostic export previews exactly what will be shared.

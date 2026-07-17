# Safety Privacy Security

## Data Handling

- Projects, recovery drafts, imported assets and artifacts stay local unless the
  user explicitly exports them.
- Runtime decoding protects all persisted, plugin, import and IPC boundaries.
- Atomic writes and explicit recovery protect against partial/corrupt state.
- Logs and diagnostics avoid embedding full asset data or unredacted home paths.

## Secrets

No cloud credential is required for goal completion. Build/preview commands must
not inherit or display unrelated environment secrets. Exported diagnostic
bundles redact tokens, signed URLs, session ids and private filesystem roots.

## Abuse Cases

- Malicious/corrupt project or plugin manifests: fail decoding with actionable
  diagnostics; do not execute arbitrary paths or renderer code.
- Path traversal/symlink escape in import/export/build: constrain resolved paths
  to the selected project/output boundary and test rejection.
- Oversized/cyclic content graphs or asset libraries: bound work, detect cycles,
  support cancellation and avoid main-thread denial of service.
- Destructive delete/reference repair: confirm impact and preserve undo/recovery.
- Local multiplayer input: validate message shapes/rates and do not trust client
  claims for authoritative match state.

# Client Implementation

## CLI

- Add or consolidate non-destructive `project inspect/migrate/backup/restore` and `game verify` surfaces only where the editor needs a scriptable equivalent.
- Commands support machine-readable output, stable exit codes, dry-run inspection, and explicit paths; publish/deploy remains a separate approval-gated action.
- Clean-checkout and release-oracle commands are documented at the root and callable in CI.

## MCP

No new MCP server is required. Live Electron verification uses the existing CDP/Playwright/native tooling and logs replayable evidence. Agent automation consumes typed IPC/CLI contracts rather than screen coordinates where possible.

## UI

- Integrate onboarding, readiness, recovery, compatibility, performance, and Ship status into the existing shell/Problems/Runtime surfaces.
- Preserve the current visual/TypeScript behavior editor and real-icon virtualized reference pickers.
- Use one canonical diagnostic model for editor, playtest, migration, and Ship; avoid parallel renderer truth.
- Add focused keyboard/accessibility tests and live fresh-profile coverage.

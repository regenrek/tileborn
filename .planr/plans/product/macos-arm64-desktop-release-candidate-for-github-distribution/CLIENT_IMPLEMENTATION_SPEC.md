# Client Implementation

## CLI

## MCP

## UI

- Expose update checking, available, downloading, ready-to-restart, no-update,
  and actionable failure states through one renderer-facing IPC contract.
- The renderer may request check/download/restart actions but never owns feed
  access, signature decisions, filesystem replacement, or project migration.

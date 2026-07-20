# Client Implementation

## CLI

- Preserve local build/ship commands and add inspectable deploy validate/plan/deploy/status/logs/destroy commands through neutral services.
- Human and JSON output must identify target, artifact, health, and remediation without leaking credentials.

## MCP

- No new public MCP server is required for MVP. Existing agent/editor automation may call canonical CLI/IPC surfaces only.
- Generated capability/reference data must let agents discover shell actions, audio events, multiplayer support, and deployment targets without reading internals.

## UI

- Asset details and Problems expose license/provenance and distribution status.
- Audio workspace supports import, preview, typed binding, basic music/SFX volumes, and use sites.
- Game Shell workspace provides screen tree, canvas/preview, schema inspector, theme/assets, action picker, focus order, and device preview.
- Playtest exposes Single/Multiplayer consistently; Ship exposes Local and Alchemy targets with readiness, plan, logs, endpoint, retry, and cleanup state.

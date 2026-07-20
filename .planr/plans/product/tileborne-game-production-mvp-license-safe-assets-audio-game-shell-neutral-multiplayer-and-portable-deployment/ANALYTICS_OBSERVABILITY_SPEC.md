# Analytics Observability

## Events

- Audio binding/playback rejects, shell navigation/action failures, room lifecycle, deploy job lifecycle, and health checks.
- Events use stable codes, correlation/job/session ids, and bounded payloads.

## Diagnostics

- Problems links license/audio/shell/multiplayer failures to owning editor data.
- Runtime inspector shows shell event/action and audio command traces alongside existing behavior traces.
- Deployment UI/CLI shows phase, adapter/provider, redacted command result, endpoint health, and remediation.

## Privacy

- Local-first and opt-in external deployment; no Tileborne telemetry service is added.
- Logs exclude secrets, full local paths where unnecessary, and unrelated provider/account data.
- Retention is user-controlled through local project/job history and provider tools.

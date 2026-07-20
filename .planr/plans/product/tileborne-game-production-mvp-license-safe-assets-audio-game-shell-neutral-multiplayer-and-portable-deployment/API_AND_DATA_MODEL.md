# API And Data Model

## Objects

- `AssetProvenance`: source URL/path, author, SPDX id, attribution, modification, redistribution class, evidence hash.
- `AudioAsset`, `AudioBus` (`music`/`sfx` MVP), `AudioBinding`, `AudioCommand`.
- `GameShellDocument`, `ShellScreen`, `ShellElement`, `ShellAction`, `ShellEvent`, `ShellTheme`.
- `MultiplayerCapability`, `RoomSummary`, `Participant`, `ReconnectSeat`, `MatchResult`, `NetworkDiagnostic`.
- `DeploymentManifest`, `DeploymentTarget`, `DeploymentPlan`, `DeploymentJob`, `DeploymentReceipt`.

## Commands

- Asset: inspect/classify/validate/resolve-attribution.
- Audio: import/preview/bind/unbind/set-volume/play/stop.
- Shell: create/update/preview/validate/navigate/dispatch-action.
- Multiplayer: host/join/ready/leave/reconnect/start/stop/read-results.
- Deploy: validate/plan/deploy/status/logs/destroy/open-endpoint.

## Events

- License/readiness diagnostics with source and navigation targets.
- Gameplay and shell lifecycle events mapped to typed audio bindings.
- Shell route/action/focus transitions and recoverable failures.
- Room/participant/readiness/reconnect/match/result lifecycle events.
- Deployment planned/started/progress/healthy/failed/destroyed events with redaction.

## Versioning

All durable documents and build manifests use explicit schema versions and
fail closed on future versions. Existing projects receive reviewed migrations or
diagnostics; no dual durable shape becomes a second source of truth.

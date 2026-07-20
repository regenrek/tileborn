# Technical Architecture

## Components

- Core schemas: provenance, audio references/bindings, shell document/actions, multiplayer DTOs, deployment manifest.
- Application services: asset/license readiness, audio authoring, shell documents, multiplayer orchestration, Ship/deploy orchestration.
- Runtime/client: deterministic audio commands plus playback adapter, shell state machine/renderer, neutral multiplayer client.
- Plugin API: audio events, shell defaults/data providers, game-mode multiplayer adapter, deployment adapter registration.
- First-party adapters: local execution and an Alchemy v2 Effect stack with Cloudflare providers, remote state, and provider-profile authentication.
- Editor UI: license diagnostics, Audio workspace, Game Shell workspace, multiplayer/deploy settings, shared Problems/Ship surfaces.

## Data Flow

Project assets and definitions are decoded by canonical schemas, resolved by
application services, and validated by readiness. Build materializes immutable
audio, shell, mode, multiplayer, and deployment manifests. Runtime plugins emit
typed gameplay/shell events; deterministic systems produce audio and navigation
commands; client adapters perform playback/rendering. Ship either launches the
local artifact or passes the same provider-neutral output to the selected deploy
adapter. Provider credentials never enter durable project data.

## Failure Modes

- Unknown/incompatible licenses: fail readiness and Ship, preserve editor work.
- Missing/unsupported audio: actionable diagnostic; no crash or silent durable corruption.
- Invalid/unreachable shell route: block preview/Ship with owning screen/action deep link.
- Multiplayer host loss, stale seat, invalid transition, or unauthorized participant stop: typed terminal/recoverable state.
- Missing provider tool/profile, failed first-create/adopt/plan/deploy, unhealthy endpoint, or cleanup failure: typed/redacted deployment job with retained local artifact.
- Missing Workers and transient Worker-version/settings responses are normal provider lifecycle states, not invalid-response terminal failures; Alchemy v2 typed provider errors own their interpretation.
- Adapter drift or vendor leakage: boundary and contract tests fail before release.

## Ownership Rules

- Core owns neutral schemas only; it cannot import BR, Alchemy, Cloudflare, Electron, or renderer code.
- Battle Royale owns zone, elimination, loadout, scoring, and match rules, never generic networking lifecycle.
- Renderer consumes projected DTOs and IPC; it does not call provider SDKs or read credentials.
- Alchemy v2/Effect, Cloudflare providers, OAuth profiles, remote state, Worker/Durable-Object bindings, and adoption policy live behind the deployment adapter; Ship orchestration consumes only neutral commands/results.
- Project content owns branding and bindings; plugins may provide immutable defaults/templates.

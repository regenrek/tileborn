# Analytics Observability

## Events

Local structured events/logs cover readiness evaluation, diagnostic lifecycle,
save/recovery transitions, template creation, playtest preflight, ship progress,
artifact creation, and preview launch. Stable codes are suitable for tests and
support without embedding asset names or project content.

## Diagnostics

- Separate user-actionable game diagnostics from internal service errors.
- Record validator owner, duration, input revision and result counts.
- Record bounded batch/window sizes and cancellation for asset-preview work.
- Build/ship logs correlate job, project revision, package hash and artifact id.
- Development verification treats renderer console errors and unhandled promise
  rejections as failures.

## Privacy

The release remains local-first and does not require external analytics.
Diagnostic export is explicit and redacts filesystem home paths, credentials,
tokens, personal asset contents, and multiplayer secrets. Any future telemetry
is opt-in and outside this goal.

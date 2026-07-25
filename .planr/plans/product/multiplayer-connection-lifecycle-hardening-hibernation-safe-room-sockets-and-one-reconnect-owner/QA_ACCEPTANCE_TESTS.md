# QA Acceptance Tests

## Acceptance

- New room instance + existing accepted sockets/attachments resumes two clients.
- Concurrent first events observe one initialized room.
- First initialization failure is followed by a successful retry.
- Reconnected successor remains authoritative when the stale socket closes.
- Heartbeat/input after wake changes authoritative state and produces snapshots.
- Snapshot ack, resync, drop, and close thresholds remain bounded.
- Normal/replaced/kicked/match-ended/protocol/backpressure close paths retain
  expected codes and avoid accidental `1006`.
- Renderer flow uses the runtime transport's capped reconnect policy.
- Fresh two-client Electron plus disposable Cloudflare oracle completes and all
  remote resources are removed.

## Regression

- Existing room-object lifecycle, reconnect-seat, handoff-token, storage
  migration, snapshot, backpressure, and terminal-results suites.
- `packages/runtime/src/net` close classification, reconnect budget,
  health-reset, send-while-closed, and queue tests.
- Desktop multiplayer state/HUD/plugin projection tests.
- Copied shipped-artifact and two-client multiplayer smoke.
- Boundary tests for provider/plugin/renderer dependency direction.
- Secret and forbidden-path scans covering logs, receipts, Planr state, and
  changed files.

## Manual Scenarios

1. Clean profile: create/open a valid BR starter project.
2. Start private multiplayer, join with a second visible client, and ready both.
3. Reach active authoritative play and record room/socket metrics.
4. Force one client transport interruption and reconnect through its token.
5. Confirm one player identity, continuing snapshots/input, and no duplicate
   presence.
6. Complete the match and verify both clients see compatible terminal results.
7. Repeat against disposable Cloudflare Workers authenticated through the new
   default profile.
8. Destroy both Workers and confirm provider reads return absent/not found.

Cold wake itself is proved by the deterministic workerd/Miniflare scenario;
manual cloud verification must not depend on waiting for an undocumented
provider hibernation interval.

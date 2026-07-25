# Product Specification

## Problem

`PlaytestRoom` accepts WebSockets with the Durable Object Hibernation API and
serializes `playerId` / `socketId` attachments, but its authoritative
`socketByPlayerId` registry exists only in memory. After a new isolate is
constructed, a hibernated socket event can carry a valid attachment while the
registry is empty, causing the event to be ignored. Room hydration is also
started asynchronously from the constructor without one explicit,
retry-capable initialization gate.

The client side has a second ownership problem: the renderer-specific
`PlaytestMultiplayerClient` opens and manages a raw WebSocket even though
`packages/runtime/src/net` already owns bounded reconnect semantics. Extending
both paths would create policy drift in retry limits, close codes, queueing,
health acknowledgement, and reconnect-token handling.

## Users

- Creators running local or shipped two-client multiplayer playtests.
- Players reconnecting after an ordinary transport interruption.
- Maintainers evolving the Cloudflare adapter without changing game-mode code.
- Reviewers who need deterministic evidence for wake, reconnect, close, and
  cleanup behavior.

## Requirements

1. A new `PlaytestRoom` instance must rebuild usable connection records from
   `state.getWebSockets()` and validated serialized attachments before
   processing messages, close events, broadcasts, snapshots, or metrics.
2. Room initialization must have one concurrency gate. Concurrent fetch,
   alarm, and WebSocket events observe initialized state; failed initialization
   leaves the object retryable rather than permanently poisoning its input
   gate.
3. Rehydration must preserve socket identity, reject malformed or duplicate
   attachments safely, and retain bounded snapshot/backpressure behavior.
4. Peer close must complete a clean WebSocket close handshake. Expected normal,
   replaced, kicked, match-ended, invalid-protocol, and backpressure closes
   retain their existing semantics.
5. Reusable reconnect/health/retry/queue policy lives in
   `packages/runtime/src/net`. Renderer code may project connection state and
   user actions but may not own a parallel retry algorithm or message queue.
6. No PartyServer, PartySocket, or Partysub dependency is added. No second room
   runtime, fallback transport, or plugin-owned network policy is introduced.
7. Existing authoritative simulation, reconnect seats/tokens, snapshot acks,
   bounded queues, resync, and backpressure remain behaviorally compatible.
8. Verification must include deterministic cold wake, initialization failure
   recovery, replacement sockets, close handshakes, bounded reconnect, two
   clients, real provider requests, redacted credentials, and verified cleanup.

## Success Criteria

- A deterministic workerd/Miniflare integration constructs a fresh room
  instance over accepted sockets and attachments, then proves both clients can
  continue heartbeat/input and receive authoritative snapshots.
- Cold wake creates no duplicate player session, stale in-memory owner, lost
  reconnect seat, unbounded queue, or abnormal close `1006`.
- Renderer multiplayer uses the canonical runtime transport policy; focused
  boundary tests reject reintroduction of a parallel WebSocket owner.
- Existing room lifecycle, reconnect, backpressure, shipped-artifact, and
  two-client regressions pass.
- Fresh Electron clients complete connect, ready, active play, forced
  disconnect/reconnect, and terminal results against disposable Cloudflare
  Workers.
- Destroy succeeds and provider reads prove every disposable Worker is absent;
  no credentials or provider state are committed.
- Independent review reports complete with no ownership drift, duplicate
  policy path, or unresolved P0/P1 finding.

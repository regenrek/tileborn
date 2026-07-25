# Backend Implementation

## Storage

- Reuse existing persisted room storage and migrations.
- WebSocket attachments carry only the minimum provider-local identity required
  to reconstruct a connection. Validate every field before use.
- Do not persist transient socket objects, queue contents, provider credentials,
  or renderer state.
- Rehydration must be idempotent and must not create a new room/player.

## Services

- `PlaytestRoom` remains the authoritative runtime owner.
- A narrow room-connection lifecycle service owns initialization,
  attachment-to-record reconstruction, duplicate resolution, and idempotent
  cleanup.
- Existing room transport helpers remain the canonical pure policy for input
  order, snapshot acknowledgement, resync, drop, and close thresholds.
- Alchemy provisions resources only; it does not own room semantics.

## Tests

- Durable Object fake/workerd integration with accepted sockets and serialized
  attachments across a new room instance.
- Initialization concurrency and retry-after-failure.
- Duplicate/stale socket replacement and close races.
- Ack/backpressure continuity after reconstruction.
- Reciprocal close handshake and expected codes.
- Real disposable Cloudflare health, room, WebSocket, and cleanup requests.

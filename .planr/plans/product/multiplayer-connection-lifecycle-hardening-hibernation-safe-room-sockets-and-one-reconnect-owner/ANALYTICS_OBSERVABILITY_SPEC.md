# Analytics Observability

## Events

- Room initialization started/succeeded/failed/retried.
- Socket accepted/rehydrated/replaced/rejected/closed.
- Reconnect attempted/succeeded/exhausted.
- Snapshot resync/drop/backpressure close.
- Disposable deploy/destroy lifecycle with resource names redacted when needed.

## Diagnostics

- Per-room counts for accepted sockets, rehydrated records, duplicate/stale
  attachments, reconnect attempts, resyncs, dropped frames, and close codes.
- Deterministic test receipts identify the old/new room instance boundary.
- No diagnostic may become a second source of transport policy.

## Privacy

- Hash or redact player, room, account, and provider identifiers.
- Never log reconnect tokens, handoff signing keys, cookies, OAuth material, or
  serialized credential/profile files.

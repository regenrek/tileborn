# References

- Tileborne `docs/03-runtime-game-host.md`: NetworkClient-only WebSocket and
  authoritative Match/Room Durable Object target.
- Tileborne ADR-0014: plugin projector and renderer boundary.
- Tileborne ADR-0023 and ADR-0030: plugin-neutral mode/runtime package
  ownership.
- Tileborne `apps/game-host/src/rooms/room-object.ts`: current room lifecycle,
  accepted sockets, attachments, and event handlers.
- Tileborne `apps/game-host/src/rooms/room-transport.ts`: bounded input,
  snapshot ack, resync, drop, and close policy.
- Tileborne `packages/runtime/src/net`: reusable reconnect transport.
- Tileborne renderer `playtest-multiplayer-client.ts`: current parallel raw
  WebSocket owner to hard-cut.
- Local reference checkout
  `/Users/devbook/projects/external-codebase/cloudflare-partykit`: study
  PartyServer initialization, lazy attachment rehydration, routing retry, and
  reciprocal close; do not adopt the framework.
- Local reference checkout
  `/Users/devbook/projects/external-codebase/cloudflare-templates`: study
  local/live Playwright harness structure, not demo room business logic.

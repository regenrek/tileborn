# Technical Architecture

## Components

### Ownership inventory

| Concern | Existing owner | Runtime owner | First fix owner | Canonical long-term owner | Competing owners that are wrong | Cleanup direction |
| --- | --- | --- | --- | --- | --- | --- |
| Authoritative room execution | `apps/game-host/src/rooms/room-object.ts` `PlaytestRoom` | `apps/game-host` Durable Object room | Current `PlaytestRoom` fetch/alarm/message/close/error paths | `apps/game-host/src/rooms` | Renderer state, plugins, PartyServer, Alchemy deploy code | Keep one room runtime; move reusable lifecycle mechanics behind a narrow room module. |
| Durable Object transport acceptance | `PlaytestRoom.fetch` and Cloudflare `WebSocketPair` acceptance | `apps/game-host` Durable Object request handler | Upgrade/handoff branch in `room-object.ts` | `apps/game-host/src/rooms` provider-local connection lifecycle | PartyServer/PartySocket, renderer, plugins | Retain direct Cloudflare primitives; add attachment-backed validation and reconstruction. |
| Browser/Electron multiplayer transport | `apps/desktop/src/renderer/lib/playtest-multiplayer-client.ts`; `apps/game-client/src/app.tsx`; `packages/game-client/src/lobby-client.ts` for host HTTP reconnect handoff normalization | Active Electron/browser client instance | Existing direct WebSocket and reconnect clients until the hard-cut reconnect item | `packages/runtime/src/net` | UI components, Zustand stores, game-client components, plugins, Cloudflare room code, PartySocket, concrete plugin transport clients | Replace every direct client socket/reconnect policy with the runtime net client; leave renderer and game-client surfaces as state/action projections. |
| IPC room/session wire shape | `packages/ipc-contracts/src/contracts/multiplayer.ts` plus desktop IPC handlers | IPC contract boundary between desktop main and renderer | Existing multiplayer IPC contracts and handlers | `packages/ipc-contracts` for shared wire types; `apps/desktop/src/main` for Electron bridge plumbing | Renderer-local ad hoc payloads, game-mode plugins, game-host internals | Keep close/reconnect/session fields typed in IPC only when crossing the desktop boundary. |
| Reconnect seats and token validation | `apps/game-host/src/worker.ts`, `apps/game-host/src/rooms/handoff-token.ts`, and room storage | Worker HTTP API plus room storage | Current `/rooms/reconnect` and `/players/reconnect` flow | Server-side `apps/game-host/src/rooms` for seats; `apps/game-host/src/worker.ts` for public HTTP handoff | Renderer retry loops, plugins, runtime net package storage | Preserve token semantics; only the runtime net client may request reconnects from the client side. |
| Close-code classification | `apps/game-host/src/rooms/room-config.ts`, `room-lifecycle.ts`, `room-transport.ts`, and `packages/runtime/src/net/transport.ts` | Server for room/application closes; runtime net client for client retry classification | Existing room close constants and runtime net close classifier | `apps/game-host/src/rooms` for server application codes; `packages/runtime/src/net` for reusable client classification; `packages/ipc-contracts` only for cross-boundary shapes | UI components, plugins, PartySocket defaults, deployment adapters | Do not duplicate close-code maps in renderer or plugins; keep protocol decode errors data-only. |
| Backpressure and outbound bounds | `apps/game-host/src/rooms/room-transport.ts` with `PlaytestRoom` callers; `packages/runtime/src/net/transport.ts` currently creates an unbounded client event queue | Authoritative room transport and active client runtime transport | Current snapshot send/resync/drop/close path; record the runtime client queue as a TASK-004 first-fix target | `apps/game-host/src/rooms/room-transport.ts` for room outbound thresholds; `packages/runtime/src/net` for the bounded client event queue | Renderer queues, plugins, PartyServer backpressure defaults, ad hoc client queues outside runtime net | Preserve existing room thresholds and replace the runtime transport `Queue.unbounded` event buffer with the canonical bounded client queue. |

### Cloudflare room connection lifecycle

- **Runtime owner:** `apps/game-host` `PlaytestRoom`, because it executes the
  authoritative match and receives Durable Object fetch/alarm/WebSocket events.
- **First fix owner:** the current room WebSocket lifecycle around
  `room-object.ts` and its in-memory socket registry.
- **Canonical long-term owner:** a narrow Cloudflare-specific connection
  lifecycle module under `apps/game-host/src/rooms`, consumed by
  `PlaytestRoom`.
- **Competing owners that are wrong:** renderer state, game-mode plugins,
  `packages/core`, the Alchemy deployment adapter, or a new PartyServer room
  runtime.
- **Cleanup direction:** replace the in-memory-only assumption with one
  attachment-backed rehydrator and one recoverable initialization gate.

### Reconnect and client transport policy

- **Runtime owner:** the active browser/Electron network client.
- **First fix owner:** the direct WebSocket lifecycle currently embedded in the
  desktop renderer multiplayer client and shipped game-client app, plus the
  host reconnect request/credential refresh wrapper in
  `packages/game-client/src/lobby-client.ts`.
- **Canonical long-term owner:** `packages/runtime/src/net`.
- **Competing owners that are wrong:** UI stores/components, game-client
  presentation components, BR or Example Arena plugins, Cloudflare room code,
  concrete transport-client dependencies in plugins, and PartySocket.
- **Cleanup direction:** consume the canonical runtime transport from every
  production browser/Electron client and delete the parallel
  reconnect/queue/close policy.

### Wire and presentation

- Shared close-code and protocol shapes belong in `packages/ipc-contracts`
  only when they cross the client/server boundary.
- Durable Object attachment envelopes and provider lifecycle remain internal to
  `apps/game-host`.
- The renderer owns visible connection phase, diagnostics, and retry/leave
  affordances, not retry algorithms or socket queues.

## Data Flow

1. The Worker resolves a room and upgrades the request.
2. `PlaytestRoom` initializes once, validates the handoff, accepts the server
   socket, serializes its attachment, and registers the connection.
3. On a later isolate instance, initialization reads durable room state and
   reconstructs connection records from `state.getWebSockets()` plus
   attachments before dispatching an event.
4. Client messages use the existing plugin-neutral frame boundary; the room
   applies canonical input ordering and emits bounded authoritative snapshots.
5. `packages/runtime/src/net` classifies closes and performs bounded reconnect
   through the reconnect-token HTTP endpoint.
6. Renderer and game client project connection/snapshot state for the user.

## Failure Modes

- Missing or malformed attachment: reject/close deterministically; never invent
  a player identity.
- Duplicate player/socket identity: one winner is selected deterministically;
  a stale socket cannot close or mutate its successor.
- Initialization read/migration failure: report the error and reset the gate so
  a later event can retry.
- Socket closes during wake: tolerate absence/closed state and complete cleanup
  idempotently.
- Snapshot lag or high `bufferedAmount`: preserve current resync/drop/close
  thresholds.
- Reconnect budget exhausted: surface a terminal user-visible error; do not
  retry forever or buffer without limit.
- Expected close handshake: reciprocate close so clients do not report
  abnormal `1006`.
- Provider auth/deploy failure: redact details, leave local state coherent, and
  clean any disposable resource that was created.

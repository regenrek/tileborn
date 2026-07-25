# Architecture Decisions

## ADR-001

Status: proposed

Decision:
Keep Tileborne's `PlaytestRoom` as the authoritative room runtime. Study
PartyServer's attachment rehydration, initialization gate, and reciprocal close
patterns, but do not add PartyServer, PartySocket, or Partysub dependencies.

Consequences:
- Existing simulation, protocol, storage, reconnect seats, and backpressure
  remain owned by Tileborne.
- The implementation must reproduce only the needed lifecycle properties.
- Framework adoption or a second room runtime requires a separate user-approved
  architecture decision.

## ADR-002

Status: proposed

Decision:
Use one canonical reconnect owner: `packages/runtime/src/net`. Cloudflare
hibernation lifecycle stays in `apps/game-host/src/rooms`; the renderer only
projects state and user actions.

Consequences:
- The direct renderer WebSocket policy is removed or reduced to a consumer of
  the runtime transport.
- Close codes, retry caps, health reset, reconnect-token refresh, and queue
  semantics cannot diverge by client surface.
- Plugins remain transport- and provider-neutral.

Ownership record:
- **Runtime owner:** the active Electron/browser network client instance.
- **First fix owner:** `apps/desktop/src/renderer/lib/playtest-multiplayer-client.ts`,
  `apps/game-client/src/app.tsx`, and
  `packages/game-client/src/lobby-client.ts`, the accepted transitional direct
  client transport/reconnect owners until the runtime transport is consumed by
  every shipped client surface.
- **Canonical long-term owner:** `packages/runtime/src/net`, including close
  classification, retry caps, healthy-session reset, reconnect-token refresh,
  and the bounded transport queue.
- **Competing owners that are wrong:** renderer UI components and stores,
  game-client components, game-mode plugins, Cloudflare room code, PartySocket,
  and any plugin-owned transport or reconnect policy.
- **Cleanup direction:** delete or reduce the desktop renderer and shipped
  game-client direct transport/reconnect clients to consumers of
  `packages/runtime/src/net`; keep plugins protocol/data-only.

## ADR-003

Status: proposed

Decision:
Prove cold wake deterministically in workerd/Miniflare and prove the same public
protocol separately against disposable Cloudflare Workers. Do not gate
completion on undocumented provider hibernation timing.

Consequences:
- CI receives replayable evidence for the exact isolate reconstruction case.
- Live evidence still covers real provider deployment, two clients, reconnect,
  authoritative state, and cleanup.

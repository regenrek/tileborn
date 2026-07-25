# Tasks

### TASK-001: Lock the connection-lifecycle ownership contract

Goal:
Turn the architecture constraints into an executable ownership boundary before
changing behavior.

Acceptance criteria:
- Existing room, transport, renderer, IPC, reconnect, close-code, and
  backpressure owners are inventoried.
- Runtime owner, first-fix owner, canonical long-term owner, wrong competing
  owners, and cleanup direction are recorded in the repository ADR/spec.
- Boundary tests prevent PartyServer/PartySocket dependencies, plugin-owned
  network policy, and a second renderer reconnect/queue implementation.
- No product behavior changes in this slice; evidence is documentation and
  focused boundary tests.

### TASK-002: Make PlaytestRoom initialization and sockets cold-wake safe

Goal:
Reconstruct authoritative connection records from accepted Hibernation API
sockets and attachments behind one recoverable initialization gate.

Acceptance criteria:
- Fetch, alarm, message, close, and error entry points await one initialization
  path.
- A fresh room instance rebuilds validated socket records before event
  dispatch, broadcast, metrics, or snapshot delivery.
- Initialization failure can be retried by a later event without corrupting
  storage or permanently blocking the object.
- Missing, malformed, duplicate, and stale attachments have explicit,
  deterministic handling.
- Focused unit and integration evidence is logged.

### TASK-003: Preserve close, replacement, ack, and backpressure semantics

Goal:
Keep the existing bounded authoritative transport behavior correct across cold
wake and reconnect.

Acceptance criteria:
- Replaced sockets cannot disconnect or mutate their successor.
- Snapshot ack/resync/backpressure counters and decisions remain bounded after
  rehydration.
- Normal and application close codes complete a reciprocal close handshake;
  tests prove no expected path degrades to `1006`.
- Input ordering and one-queued-input-per-player behavior remain unchanged.
- Existing room lifecycle and backpressure suites pass.

### TASK-004: Hard-cut client reconnect policy to one runtime owner

Goal:
Route the Electron multiplayer client through the reusable
`packages/runtime/src/net` transport policy and remove the parallel renderer
policy.

Acceptance criteria:
- Retry cap, reconnect-token refresh, healthy-session reset, close-code
  classification, send behavior, and queue bounds have one implementation.
- Renderer code owns only visible phase/error state, input projection, snapshot
  projection, and explicit user retry/leave actions.
- No compatibility fallback or second raw-WebSocket reconnect path survives.
- Plugin code remains unaware of provider and transport lifecycle.
- Focused runtime, renderer, and boundary tests are logged.

### TASK-005: Build the deterministic cold-wake integration oracle

Goal:
Make hibernation correctness repeatable without depending on undocumented
provider timing.

Acceptance criteria:
- A workerd/Miniflare scenario accepts two sockets, serializes attachments,
  reconstructs a new room instance, and resumes both clients.
- The scenario proves heartbeat/input, authoritative snapshot delivery,
  replacement reconnect, close handshake, initialization retry, and bounded
  backpressure after wake.
- The harness fails against the pre-fix in-memory-only assumption.
- The test uses production entry points and codecs, not a second fake policy
  implementation.

### TASK-006: Prove the fresh Electron and disposable Cloudflare lifecycle

Goal:
Verify the canonical path with real clients and provider responses, then leave
no remote state behind.

Acceptance criteria:
- A newly authenticated default Cloudflare profile is used; credentials are
  neither copied nor committed.
- Two fresh Electron clients connect, ready, enter active play, survive a
  forced disconnect/reconnect, receive authoritative state, and reach terminal
  results.
- Live diagnostics show bounded reconnect/backpressure and no duplicate
  sessions or abnormal expected close.
- Disposable game-host and behavior Workers are destroyed, then provider reads
  prove both names absent with redacted receipts.
- No permanent production Worker is created.

### TASK-007: Independently review ownership and completion evidence

Goal:
Audit the implementation, map logs, changed files, boundary tests, and live
oracle before closing the goal.

Acceptance criteria:
- Review explicitly checks runtime owner, first-fix owner, canonical long-term
  owner, wrong competing owners, and cleanup direction.
- Review finds no PartyServer/PartySocket adoption, duplicate reconnect policy,
  fallback transport, plugin/provider leakage, or unrelated Alchemy/content
  work.
- All P0/P1 findings are resolved through fix and follow-up review items.
- `planr plan audit` reports the stored goal contract holds.

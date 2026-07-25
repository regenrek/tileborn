# Release Readiness

## Packaging

- No new production dependency on PartyKit packages.
- Shipped artifact continues to resolve the same runtime/game-host packages
  outside workspace-only paths.
- Disposable Cloudflare resources and provider state are absent after proof.

## Documentation

- Repository architecture/ADR documents name every connection-lifecycle owner
  and forbidden edge.
- Multiplayer troubleshooting explains bounded reconnect and terminal errors
  without exposing credentials.
- Verification receipts contain no tokens, cookies, profile files, or account
  identifiers beyond redacted values.

## Verification

- All seven map items have evidence-backed closure.
- Implementation slices receive independent review; all review findings are
  resolved.
- Deterministic cold-wake, focused regression, fresh Electron two-client, copied
  artifact, real Cloudflare, security scan, and cleanup evidence are logged.
- `planr plan audit` reports the goal contract holds.

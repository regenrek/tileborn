# Release Readiness

## Packaging

- Local artifact contains all approved audio/shell/multiplayer/runtime assets and attribution with no workspace resolution.
- Provider-neutral manifest is reproducible and the Alchemy v2 adapter consumes it without rewriting game contracts or retaining an Alchemy 0.93 compatibility path.
- No desktop binary distribution claim is introduced by this goal.

## Documentation

- Creator guides for licensing, audio, Game Shell, multiplayer, local Ship, and Alchemy/Cloudflare deploy.
- Plugin-author contracts and second-mode examples.
- Operator credential, troubleshooting, health, cleanup, cost-awareness, and known-limit guidance.

## Verification

- Each task has Planr evidence; implementation tasks receive independent review where material.
- Required tests, boundaries, build, clean checkout, security/license scans, live Electron, copied artifact, and real disposable Alchemy v2 deployment pass.
- The disposable deployment proves first-create of game-host and behavior Workers, authoritative behavior execution, healthy game/room responses, redacted receipts, and absence of both Workers after cleanup.
- No open approvals, unresolved review findings, leaked credentials, or unexplained exclusions.
- `planr plan audit pln-e0dfe0c9 --json` returns `holds: true`.

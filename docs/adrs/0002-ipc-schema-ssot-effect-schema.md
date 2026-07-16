# ADR-0002: IPC schema SSOT with Effect Schema

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: ipc, effect, contracts, desktop

## Context

The desktop app splits work across renderer, preload, and main. Untyped or duplicated IPC definitions drift quickly and break preload validation. Architecture invariant #3 requires all IPC channels to live in `@tileborne/ipc-contracts` using Effect Schema.

The package exposes invoke/stream contracts, channel modules (plugins, assets, projects, maps, jobs, logs), and generated renderer/main typings.

## Decision

`@tileborne/ipc-contracts` is the **single source of truth** for every desktop IPC channel. Each channel is an `IpcContract` with Effect Schema request/response types. Preload validates traffic; main registers handlers against the same definitions. Renderer code imports generated client types only—never hand-rolled channel strings or ad-hoc payloads.

## Options considered

- **A — TypeScript interfaces only**: Lightweight but no runtime validation at preload boundary.
- **B — Zod/JSON Schema in a shared package**: Runtime validation without aligning with the Effect service layer used elsewhere.
- **C (chosen) — Effect Schema in `@tileborne/ipc-contracts`**: One schema graph for IPC, CLI-adjacent services, and plugin manifests; typed errors and codegen-friendly.

## Consequences

- Positive: Preload can reject malformed requests/responses before they reach main or renderer.
- Positive: CLI and Electron main share the same Effect service implementations behind typed contracts.
- Negative: Team must maintain codegen or helper types (`RequestOf`, `ResponseOf`) alongside schemas.
- Follow-up: Keep generated `renderer-client.ts` / `main-handlers.ts` in sync as channels are added.

## References

- `docs/01-spec.md` §3 (`@tileborne/ipc-contracts`), §4 (preload shape)
- [Effect Schema](https://effect.website/docs/schema/introduction/)
- Related: [ADR-0003](./0003-electron-process-boundary-rules.md)

# ADR-0011: Vite + TanStack Router + TanStack Query (not TanStack Start)

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: desktop, react, vite, tanstack, electron

## Context

The Electron desktop renderer is a browser-only React app (ADR-0003). Phase 3 deliverables specify Electron Forge plus Vite, React renderer, TanStack Query for server-state, and typed preload IPC—no SSR. TanStack Start adds server functions, SSR, and full-stack routing aimed at web apps with a Node server; none of that applies inside Electron where **IPC replaces server functions**.

The Forge + Vite template is the canonical Electron packaging path; `docs/02-editor-ux.md` references TanStack Query/Virtual for editor panels.

## Decision

The desktop **renderer stack is Vite + React + TanStack Router + TanStack Query**. **TanStack Start is not used.** Routing is client-side only; data fetching goes through TanStack Query hooks backed by `window.tileborne.invoke` / `subscribe` (ADR-0002). Server-state channels: plugins, assets, projects, maps, jobs, logs per spec §4.

## Options considered

- **A — TanStack Start in Electron**: Implies SSR/server functions with no Electron server; mismatched mental model and bundle complexity.
- **B — React Router only**: Adequate routing; loses TanStack Router’s typed routes and search params used across the monorepo reference set.
- **C (chosen) — Vite + TanStack Router + TanStack Query**: Matches Forge template; IPC as the “backend”; Query handles cache, retries, and streaming job progress.

## Consequences

- Positive: Clear separation—main process owns Effect services; renderer stays browser-pure.
- Positive: Aligns with `docs/01-spec.md` renderer state split (Query + local Zustand/Jotai + Pixi state).
- Negative: No TanStack Start loaders—route data must be fetched via Query hooks or route `beforeLoad` calling IPC.
- Follow-up: Custom title bar / frameless window is tracked separately in [ADR-0012](./0012-electron-custom-title-bar.md) (see also `docs/02-editor-ux.md` §17)—not part of this decision.

## References

- `docs/01-spec.md` §4 (renderer responsibilities, state split), §15 Phase 3
- `docs/02-editor-ux.md` §15 (TanStack Query for IPC-backed state)
- [Electron Forge Vite template](https://www.electronforge.io/)
- Related: [ADR-0002](./0002-ipc-schema-ssot-effect-schema.md), [ADR-0003](./0003-electron-process-boundary-rules.md)

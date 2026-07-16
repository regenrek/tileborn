# ADR-0012: Electron custom title bar

- Status: Proposed
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: desktop, electron, ux, window-chrome

## Context

`docs/02-editor-ux.md` §3 pins v1 to a **native OS frame** and standard menu bar; §17 lists the custom title bar as an open question. A frameless window with an in-renderer title bar (VS Code–style traffic lights and drag region) would unify branding across macOS, Windows, and Linux but adds renderer complexity, platform-specific control placement, and Electron `BrowserWindow` configuration. This ADR is reserved separately from [ADR-0011](./0011-vite-tanstack-router-no-tanstack-start.md) (renderer framework).

## Decision

**TBD** — choose native frame for v1 vs frameless custom chrome before Phase 3 desktop shell hardening.

## Options considered

- **A — Native frame (current v1 default)**: `frame: true`, native menu bar (`Menu.setApplicationMenu`); lowest risk; OS-specific title and traffic-light placement.
- **B — Frameless + custom in-renderer title bar**: `frame: false`, custom drag region and window controls in React; matches VS Code–style unified chrome; requires `-webkit-app-region`, platform traffic-light offsets, and IPC for minimize/maximize/close.

## Consequences

- Open until a decision is recorded.

## References

- `docs/02-editor-ux.md` §3 (window chrome — native frame in v1)
- `docs/02-editor-ux.md` §17 (open questions — custom title bar deferred here)
- Related: [ADR-0003](./0003-electron-process-boundary-rules.md), [ADR-0011](./0011-vite-tanstack-router-no-tanstack-start.md)

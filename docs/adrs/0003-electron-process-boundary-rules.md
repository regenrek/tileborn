# ADR-0003: Electron process boundary rules

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: electron, security, desktop, architecture

## Context

Tileborne is desktop-first (v1). Electron splits main, preload, and renderer. Architecture invariants #1–2 forbid Node/Electron/filesystem/plugin executables in the renderer. `@tileborne/ui` and renderer packages must remain browser-safe so boundary tests can enforce leaks.

## Decision

Process boundaries are fixed:

| Process      | May import / run                                                             | Must not                                            |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| **Renderer** | React, Pixi, TanStack, declarative plugin metadata, typed `window.tileborne` | Node, Electron, fs, plugin executables, native code |
| **Preload**  | IPC bridge, Effect Schema validation, narrow Electron IPC APIs               | Business logic, filesystem, plugin loading          |
| **Main**     | Effect services, fs, plugin install/exec, WASM backends, IPC handlers        | Direct DOM/React                                    |

All privileged operations flow renderer → preload → main via `@tileborne/ipc-contracts` channels only.

## Options considered

- **A — Node integration in renderer**: Faster prototyping; unacceptable security and test surface.
- **B — Remote module / `@electron/remote`**: Deprecated pattern; widens renderer trust.
- **C (chosen) — Strict three-process model with typed preload**: Matches Forge + Vite template; aligns with GDevelop/LDtk-style Electron editors.

## Consequences

- Positive: Boundary leak tests (`docs/01-spec.md` §16) can statically ban forbidden imports in renderer packages.
- Positive: Plugin executable code runs where jobs and fs access already live (main/CLI).
- Negative: Every new capability needs an IPC channel and service implementation before UI can use it.
- Follow-up: Enforce via ESLint/tsconfig `paths` restrictions and CI boundary tests in Phase 3.

## References

- `docs/01-spec.md` §4 (desktop architecture), §16 (boundary tests)
- Related: [ADR-0001](./0001-plugin-ui-model-declarative-first.md), [ADR-0002](./0002-ipc-schema-ssot-effect-schema.md), [ADR-0011](./0011-vite-tanstack-router-no-tanstack-start.md)

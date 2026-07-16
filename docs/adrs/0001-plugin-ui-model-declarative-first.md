# ADR-0001: Plugin UI model, declarative first

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: plugins, editor, security, ui

## Context

Tileborne plugins extend the editor (panels, palettes, inspectors, presets) and the runtime (systems, validators, exporters). Running arbitrary plugin code in the Electron renderer would expose filesystem, Node, and IPC attack surfaces. The spec defines a phased trust model: Phase A forbids renderer plugin executables; Phase B may add sandboxed UI with a separate ADR.

Editor UX (`docs/02-editor-ux.md`) assumes declarative-only plugin contributions in v1, with contribution-point IDs such as `paletteCategories`, `overlays`, and `inspectorPanels`.

## Decision

In v1 (Phase A), plugin UI is **declarative only**. Plugins ship JSON/metadata contributions (schemas, panel definitions, presets, icons, command metadata) that the React shell renders. Executable plugin code runs only in Electron main, CLI, or the bundled game host—never in the renderer.

## Options considered

- **A — Imperative plugin UI in renderer**: Plugins bundle React/Svelte components loaded dynamically. Fastest path to rich UI; violates renderer isolation and complicates security review.
- **B — Server-driven UI over IPC**: Main process renders UI descriptions on demand. Adds latency and couples UI to main-process availability.
- **C (chosen) — Declarative contributions, renderer-safe**: Plugins declare UI via manifest contributions; `@tileborne/ui` maps declarations to React. Executable logic stays off-renderer. Phase B may add iframe-sandboxed imperative UI under a future ADR.

## Consequences

- Positive: Aligns with architecture invariant #2 (no plugin executables in renderer); simplifies boundary tests and OSS security story.
- Positive: Plugin authors can extend the editor without shipping renderer bundles.
- Negative: Complex or highly interactive plugin UIs are constrained until Phase B.
- Follow-up: ADR required before iframe-sandboxed plugin UI (see `docs/02-editor-ux.md` §16). Track sandbox mechanism and stable contribution-point contract separately.

## References

- `docs/01-spec.md` §8 (plugin trust model, contribution types)
- `docs/02-editor-ux.md` §16 (Phase B plugin UI sandboxing)
- Related: [ADR-0003](./0003-electron-process-boundary-rules.md)

---
name: working-palette-performance-virtualize-the-working-palette-sidebar-and-resolve-preview-metadata-in-bounded-on-demand-windows-with-focused-regression-and-live-desktop-verification
overview: "Build plan for Working palette performance - Virtualize the working-palette sidebar and resolve preview metadata in bounded on-demand windows, with focused regression and live desktop verification."
todos:
  - id: phase-1
    content: "Implement Virtualize the working-palette sidebar and resolve preview metadata in bounded on-demand windows, with focused regression and live desktop verification"
    status: pending
isProject: false
stage: build
source_plan: pln-930a68a8
slice: "Virtualize the working-palette sidebar and resolve preview metadata in bounded on-demand windows, with focused regression and live desktop verification"
---

# Working palette performance - Virtualize the working-palette sidebar and resolve preview metadata in bounded on-demand windows, with focused regression and live desktop verification

## Scope Decision

Change only the desktop renderer's working-palette presentation and preview
query batching. Keep palette persistence, IPC contracts, asset indexing, and
thumbnail protocol behavior unchanged.

## Ownership Target

- `working-palette-sidebar.tsx` owns viewport virtualization and selection of
  the aligned on-demand item window.
- `queries.ts` owns the maximum preview refs per IPC query and React Query cache
  identity.
- The existing asset-library service remains the canonical preview resolver.

## Existing Leverage

Reuse `@tanstack/react-virtual`, the virtual-grid patterns in
`asset-pack-browser.tsx`, the existing main-process preview index cache, and the
canonical `LibraryPreviewThumb` component.

## Phase 1

### TASK-001: Virtualize working-palette rows

Mount only the visible and overscan grid rows while preserving the complete
scroll range and item order.

### TASK-002: Window preview and animation data

Align visible items to stable 64-item windows, bound each preview IPC query,
and derive animated pack frames only for the current window.

### TASK-003: Add regression and live verification

Prove bounded rendering with 2,000 items, run the focused checks, and exercise
the working-palette path in the authorized desktop dev app.

## Out Of Scope

- Changing working-palette persistence or limits.
- Replacing Electron IPC or moving asset indexing to a worker.
- Changing asset-library browsing behavior.

## Verification

- Add a 2,000-item renderer regression proving bounded mounted cells and refs.
- Run the focused working-palette sidebar test suite.
- Run desktop typecheck and lint for changed files.
- Start the authorized desktop dev app and inspect the live sidebar path.

## Acceptance Criteria

- No preview query contains more than 64 references.
- Initial render of a 2,000-item palette mounts only visible/overscan rows.
- Scrolling preserves ordering and eventually exposes every item.
- Brush selection and existing small-palette behavior remain green.

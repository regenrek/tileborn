# Tasks

### TASK-001: Virtualize the working-palette grid

Goal:
Render only visible and overscan rows while preserving item ordering and brush
selection.

Acceptance criteria:
- A 2,000-item palette mounts a bounded number of item buttons.
- The virtual spacer retains access to the complete palette through scrolling.

### TASK-002: Bound preview and animation loading

Goal:
Resolve only the aligned preview window needed by mounted rows.

Acceptance criteria:
- Preview IPC queries contain no more than 64 references each.
- Animated source packs are derived only from windowed items.
- Cached windows are reused when revisited.

### TASK-003: Verify regression and live behavior

Goal:
Prove the performance path without weakening existing palette behavior.

Acceptance criteria:
- Focused renderer tests and desktop typecheck pass.
- The desktop app starts and the working-palette UI remains usable.

# Tasks

### TASK-001: Establish one coordinate and lifecycle contract

Goal:
Convert authoring pixels to runtime tiles exactly once and make match/session lifecycle safe.

Acceptance criteria:
- Generated maps are distributed in editor and runtime with valid zone/spawns.
- Gameplay is frozen before Start Match and during local pause.
- Stop and project switch leave no running session.

### TASK-002: Deliver real pointer aim and authoritative weapon feedback

Goal:
Make mouse aim, click-to-fire, crosshair, and weapon feedback truthful.

Acceptance criteria:
- In-match shell passes pointer input to the viewport while controls remain clickable.
- Pointer aim is coalesced continuously and left click fires toward the cursor.
- Crosshair is centered and one accepted shot produces one matching event/audio/VFX.

### TASK-003: Make local movement immediately responsive

Goal:
Predict and reconcile the local player without changing remote interpolation or server authority.

Acceptance criteria:
- Local input is visible within one display frame in local play.
- Normal reconciliation does not visibly snap and impossible input remains rejected.
- Desktop and browser clients share the canonical prediction/input core.

### TASK-004: Prove the complete playable-controls flow

Goal:
Close automated, Electron, Browser, and independent review evidence.

Acceptance criteria:
- Focused tests/typechecks and React Doctor do not regress.
- Electron native mouse/keyboard and Browser localhost flows pass.
- Planr review and goal audit hold with no running test sessions left behind.

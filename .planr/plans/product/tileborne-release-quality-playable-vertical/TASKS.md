# Tasks

### TASK-001 (code): Restore a fair and coherent match start

Goal:
Resolve capability discovery, safe spawn clearance, lifecycle gating, and unit/scale
contracts so the game begins in a valid readable state.

Acceptance criteria:
- Five runs start without hazard/collision overlap or involuntary opening damage.
- Renderer capability resolves once with no console error or half-mounted fallback.
- Positions, collision, minimap, camera, and visual footprints agree.
- Existing coordinate and playable-controls plans are extended, not duplicated.

### TASK-002 (code): Complete responsive movement, aim, and weapon feel

Goal:
Make movement, pointer aim, fire, reload, collision, prediction, camera, and authoritative
feedback enjoyable and trustworthy.

Acceptance criteria:
- Local movement responds within one frame and remains spatially readable.
- Pointer aim/fire and reload work through the canonical input path.
- Accepted shots drive coherent animation, VFX, audio, damage, and elimination feedback.
- Pause/resume preserves exact local match state.

### TASK-003 (design): Establish the 2D visual and audio quality bar

Goal:
Create the visual bible and an original cohesive vertical asset set: terrain tileset,
characters, weapons, props, hazards, pickups, VFX, icons, and audio direction.

Acceptance criteria:
- Declared world footprints, anchors, layers, palette, animation, and sockets are documented.
- Assets remain readable at actual play zoom and do not inherit arbitrary source-image scale.
- Original/generated assets carry provenance and pass seamless/animation/alpha review.

### TASK-004 (frontend): Finish HUD, onboarding, results, and replay loop

Goal:
Turn the shell into a clear, accessible, replayable player journey.

Acceptance criteria:
- Objective/controls/status/pickup/zone information is concise and non-obstructive.
- Results contain real facts; Lobby and Redeploy preserve the session; Stop alone exits.
- Keyboard-only navigation, remapping, reduced effects, and separate audio controls work.

### TASK-005 (code): Prove one release-quality vertical without test drift

Goal:
Close live Electron/browser verification and the narrow owning regressions.

Acceptance criteria:
- All QA scenarios pass with no relevant console/runtime errors.
- Existing canonical suites own regression coverage; no duplicate broad suite is introduced.
- Independent game-feel and visual review finds no P0/P1 issue.

### TASK-001: Build first slice

Goal:
Implement the first production slice.

Acceptance criteria:
- The feature is implemented.
- Verification is logged.

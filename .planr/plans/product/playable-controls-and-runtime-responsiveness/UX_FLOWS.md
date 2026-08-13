# UX Flows

## Primary Flow

1. Creator generates or opens a valid BR map.
2. Playtest builds while the editor remains responsive and shows a starting state.
3. Runtime is prepared but gameplay is frozen on title and lobby screens.
4. Start Match activates player input and the authoritative simulation together.
5. WASD reacts immediately, the camera follows smoothly, pointer movement aims,
   left click fires, and crosshair/weapon feedback agree with authority.
6. Escape pauses local single-player ticks; resume continues from the same state.
7. Stop or project switch terminates the exact owned session.

## Empty States

- No runtime package or no local player shows an actionable playtest error.
- No weapon prevents match start through canonical readiness diagnostics.

## Error States

- Failed input delivery releases held inputs and reports a scoped runtime error.
- Reconciliation outside the safe correction threshold snaps once and records a diagnostic.
- Session stop failure remains visible and blocks a second session for that project.

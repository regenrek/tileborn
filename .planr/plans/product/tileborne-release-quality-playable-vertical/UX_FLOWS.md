# UX Flows

## Primary Flow

1. Creator generates a Battle Royale project and sees only actionable readiness findings.
2. Playtest opens to a title/lobby while simulation is frozen and health is unchanged.
3. Player sees objective and controls, selects a model, and chooses Solo Match.
4. Start Match places every participant in a distinct safe location with readable surroundings.
5. Player moves immediately, aims with the pointer, collects a weapon/pickup, fires,
   reloads, reads incoming damage, and understands zone pressure.
6. Escape pauses the local match without ending the runtime; Resume continues exactly once.
7. Elimination or match completion shows factual results and an understandable cause.
8. Redeploy starts a fresh match in the same session; Lobby returns to pre-match;
   Stop alone returns to the editor and releases the session.

## Empty States

- Missing player visuals, renderer capability, safe spawns, weapon/loadout, or
  runtime package blocks Start Match with one actionable message.
- Missing optional audio or decorative art degrades gracefully and is named as such.

## Error States

- A failed runtime start never leaves a live badge or half-mounted renderer.
- A missing renderer capability does not mount a canvas and does not repeat errors.
- Stop failure remains visible and prevents creation of an unowned second session.
- Invalid spawn safety names the conflicting objects and offers editor navigation.

## Onboarding and Accessibility Flow

- Controls can be opened from title, lobby, pause, and settings without losing state.
- Keyboard alone can start, play, pause, navigate results, redeploy, and stop.
- Status effects use icon, label, timer, sound, and optional effect—not color alone.
- Reduced-effects mode removes flash/shake while retaining timing and damage information.

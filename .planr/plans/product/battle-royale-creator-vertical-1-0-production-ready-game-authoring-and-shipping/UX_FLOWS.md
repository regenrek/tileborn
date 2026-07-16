# UX Flows

## Primary Flow

1. User chooses **New Game** and selects **Battle Royale**.
2. The wizard explains what will be created, activates the bundled plugin, and
   creates a valid editable starter project idempotently.
3. Project Overview opens with a derived creator checklist and a clear next
   action rather than a blank dashboard.
4. User imports or chooses real assets, defines player visuals/animations,
   creates weapons/items/loot, and adjusts BR rules through labelled controls.
5. User builds the map from real palette previews and inspects typed per-instance
   properties.
6. Readiness updates continuously. Clicking an error opens the correct editor
   and selects the affected definition/object.
7. When readiness passes, user launches Single and local multiplayer playtest.
8. User closes/reopens the project and sees the same authored state.
9. User opens **Ship Game**, validates, builds, launches the local artifact, and
   exports or opens its location.

## Empty States

- No projects: explain New Game and Open Project, with Battle Royale primary.
- No game mode: offer compatible bundled modes and explain the consequence.
- No project content: offer Create from template and Create blank.
- No asset/visual: offer bundled assets and Import; do not show broken orange
  placeholders as if they were game content.
- No problems: distinguish "not evaluated" from "ready".
- No artifact: explain the prerequisites and link to Readiness.

## Error States

- Field errors stay next to the field and also contribute to readiness when
  they affect execution.
- Cross-document/reference errors include a human label and navigation action,
  never only an internal id.
- Blocked Playtest/Ship opens a focused blocking-problems view.
- Save/build/plugin failures preserve inputs and offer Retry plus log details.
- Missing assets offer Relink, Replace, or Remove reference where safe.
- Closing dirty work asks Save/Discard/Cancel; recovery explains which revision
  is newer.

## Secondary Flows

- Duplicate a template weapon into project content, modify it, and replace a
  loot-table entry without mutating the plugin template.
- Switch between bundled game modes while preserving inactive-mode data and
  clearly showing which mode will play/build.
- Open a large asset library and scroll/search without resolving previews for
  every off-screen item.

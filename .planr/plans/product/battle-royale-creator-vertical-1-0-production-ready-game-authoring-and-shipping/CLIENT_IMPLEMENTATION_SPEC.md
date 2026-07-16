# Client Implementation

## CLI

The existing CLI remains the automation/equivalence surface. Editor Ship Game
must call the same application/build services rather than shelling out or
creating a second package format. CLI parity tests cover readiness, startup map,
build output and serve/preview where commands exist; no CLI use is allowed in
the primary creator acceptance flow.

## MCP

No new MCP product surface is required. Development verification uses the
project's Electron live-test workflow with Chrome DevTools MCP/Playwright and
native tooling only for canvas/window-native evidence.

## UI

- New Game mode/template wizard.
- Project Overview creator checklist and primary next action.
- Problems/Readiness view with filters, grouping and navigation.
- Shared schema-form controls and validated reference pickers.
- Project content browsers/editors for objects, weapons, items and loot tables.
- Production visual workflow across Asset Browser, Sprite/Animation Studio,
  Entity Editor and Player Model Editor.
- Shared save state and dirty/recovery affordances in tabs/title/status areas.
- Guided Ship Game dialog with progress, errors, artifact and preview actions.

Renderer components consume query/mutation hooks over typed IPC. They do not
read plugin files, assemble packages, or independently decide readiness.

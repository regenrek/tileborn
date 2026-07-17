# QA Acceptance Tests

## Acceptance

1. **Fresh creator:** clean profile -> New Game -> Battle Royale -> starter
   project/checklist, with no CLI and no raw ids.
2. **Readiness correction:** delete/misconfigure spawn, shrink anchor, loot,
   visual, and weapon reference; verify Playtest/Build block and each problem
   navigates to a successful repair.
3. **Custom content:** create real weapon/item/loot/object and prove runtime
   pickup, firing/damage and drop behavior use the authored values.
4. **Visual pipeline:** import/slice sprite sheet, create clips, configure player
   model anchors/hitbox, preview, save, and observe it in playtest.
5. **Persistence:** dirty-close cancel, save-close, failed-save, crash-recovery,
   and full app reopen retain the correct revision.
6. **Single playtest:** movement, pickup, combat, shrink, outside damage,
   elimination and final outcome.
7. **Local multiplayer:** at least two clients connect to the authored match and
   observe consistent content, combat, zone and outcome.
8. **Ship:** editor validation -> build -> local preview -> artifact location;
   execute artifact and verify authored startup map/content.

## Regression

- Existing map editor, brush placement, undo/redo, Tiled import, catalogs,
  plugin discovery, Example Arena, BR simulation, HUD/input, build/package, and
  desktop smoke suites.
- All alternate Playtest/Build entry points enforce readiness.
- Project content migrations/version decoding fail with typed diagnostics.
- Deleted/replaced references cannot create silent runtime fallbacks.
- 2,000 Working Palette assets remain windowed/on-demand; stale preview requests
  are cancelled and scrolling does not trigger unbounded IPC.
- React quality, accessibility, typecheck, lint/format, and package boundary
  checks do not regress.

## Manual Scenarios

- Keyboard-only New Game, content creation, diagnostic navigation and Ship Game.
- Screen-reader labels for fields, errors, checklist and progress states.
- Plugin disabled/missing after reopening an existing BR project.
- Asset moved on disk, corrupt sprite metadata, and relink workflow.
- Disk-full or denied-write save/build failure.
- Close app during active save/build and recover safely.
- Compare live Electron state with executed packaged artifact.

## Evidence

- Automated command output attached to Planr item logs.
- Playwright Electron traces/screenshots for repeatable flows.
- CDP console/network evidence for renderer correctness.
- Native screenshot/OCR only where canvas or OS chrome requires it.
- Packaged artifact execution log and visual proof.

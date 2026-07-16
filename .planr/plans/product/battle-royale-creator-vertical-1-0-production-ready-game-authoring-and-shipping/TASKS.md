# Tasks

### TASK-001: Unify readiness diagnostics and gate every execution path

Goal:
Create the canonical diagnostic/problem model and aggregate project, map,
catalog/reference, asset, visual-model, active-mode, and build prerequisites.
Wire the Problems UI, creator checklist, Playtest, command palette, top bar, and
Build to the same readiness service.

Acceptance criteria:
- Stable error/warning/info diagnostics include source and navigation targets.
- Battle Royale map validation is executed for the active mode.
- Invalid games are blocked from all Playtest and Build entry points.
- Clicking a problem opens/selects the owning editor object where possible.
- Focused unit/integration tests and a live invalid -> fix -> valid Electron
  flow are logged.

### TASK-002: Add schema-driven properties and canonical project content

Goal:
Extend neutral authoring contracts and storage for typed object/component
properties plus project-owned game-object, weapon, item, and loot definitions.

Acceptance criteria:
- Number, text, boolean, enum, asset/reference, optional, and grouped fields
  render validated controls.
- Project definitions have stable ids, persistence, CRUD, duplicate,
  import/export, reference integrity, and plugin-template provenance.
- Raw ids are replaced with discoverable pickers where definitions exist.
- Runtime map-package/build consumers use one canonical merged resolution path.
- Schema, migration/compatibility decision, service, IPC, and renderer tests are
  logged with no duplicate source of truth.

### TASK-003: Deliver first-class Battle Royale content and rule editors

Goal:
Build the creator-facing object, weapon, item, loot-table, spawn/team, zone, and
match-rule workflows on the generic contracts from TASK-002.

Acceptance criteria:
- A user can create a weapon, pickup/item, loot table, and placeable object with
  real visuals without editing JSON or typing reference ids.
- Spawn team/mode, loot rarity/tier, loadout, shrink phases, elimination or
  supported respawn policy, and match-end settings use appropriate controls.
- BR plugin defaults remain immutable templates; project overrides are explicit.
- Invalid references/settings produce actionable readiness problems.
- Runtime tests prove authored content/rules affect the match.

### TASK-004: Productionize asset, sprite, animation, and player-model authoring

Goal:
Close the visual-content workflow across Asset Browser, Sprite/Animation Studio,
Entity Editor, Player Model Editor, map placement, and runtime preview.

Acceptance criteria:
- Imported and bundled visuals show real thumbnails and dependency/use sites.
- Sprite sheets can be sliced/assigned; clips can be created, reordered,
  previewed, and bound to supported gameplay states/events.
- Anchors, hitboxes, muzzle points, orientation and scale have immediate visual
  feedback and validated persistence.
- Missing/incompatible/relinked assets surface through readiness diagnostics.
- The 2,000-asset regression remains bounded and responsive.

### TASK-005: Add the New Battle Royale Game wizard and safe document lifecycle

Goal:
Give a fresh creator a playable starting point and make every editor resilient
to save, navigation, close, crash, and reopen.

Acceptance criteria:
- New Game selects BR, activates its plugin, seeds starter map/player/HUD/input
  and templates, and opens the derived creator checklist.
- Starter content is valid, editable, attributable, and not duplicated on retry.
- Shared clean/dirty/saving/saved/error state covers map, entity, content,
  sprite/animation, player model, HUD/input, and game settings.
- Tab/app close flushes or asks; discard is explicit; failed save never reports
  success; recovery and reopen are tested.
- A fresh-profile live Electron walkthrough completes without CLI authoring.

### TASK-006: Build the guided Ship Game workflow

Goal:
Turn readiness, build, packaged preview, artifact inspection, and export into one
creator-facing editor workflow backed by existing canonical services.

Acceptance criteria:
- Startup map and supported target are explicit and persisted.
- Ship Game runs readiness, blocks on errors, displays progress/logs, and maps
  build failures back to actionable problems.
- Successful output exposes artifact metadata/location and launches a local
  packaged or served preview.
- Top bar, command palette, and wizard use the same orchestration service.
- The produced artifact executes the selected authored BR game.

### TASK-007: Harden game-mode extension points for the next genre

Goal:
Remove Battle-Royale-specific growth points from neutral editor orchestration and
document the supported first-party plugin contract needed by a future top-down
mode without implementing that mode.

Acceptance criteria:
- Mode manifests declare settings, validators, templates, creator-checklist
  facts, and renderer/authoring capabilities through one owned registration path.
- Generic schema forms are the default; bespoke bundled panels/projectors use a
  documented, typed registration boundary rather than scattered id switches.
- Example Arena proves the non-BR path for readiness, settings, playtest,
  package/build, and fallback UI.
- Core packages acquire no new BR literals or BR-owned schemas.
- Extension documentation includes a minimal top-down-mode integration example.

### TASK-008: Prove the production release with end-to-end evidence and review

Goal:
Run the complete Goal Oracle, harden the discovered failures, and produce the
release evidence required to call the Battle Royale creator vertical complete.

Acceptance criteria:
- Automated unit/integration/typecheck/build and Playwright Electron smoke suites
  pass for all touched owners.
- Live Electron proof covers fresh setup, real asset/content authoring, invalid
  readiness correction, Single and two-client local multiplayer playtest,
  save/reopen, Ship Game, and executed artifact gameplay.
- Accessibility, keyboard/focus, destructive actions, empty/error states,
  crash recovery, and 2,000-asset performance have explicit receipts.
- User-facing creator and plugin-author documentation is current.
- An independent review item is created and closed with verdict complete, and
  `planr plan audit` reports the stored goal contract holds.

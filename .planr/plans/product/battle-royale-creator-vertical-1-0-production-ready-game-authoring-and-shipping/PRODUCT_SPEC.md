# Product Specification

## Problem

Tileborne already contains substantial map, asset, entity, visual-model,
animation, plugin, runtime, playtest, and build capabilities, but those
capabilities do not yet form a safe and understandable product workflow. A
creator must know where plugins are enabled, manually coordinate multiple
editors, enter some raw ids, infer whether a game is valid, and interpret a
technical build job. Mode validators, catalog diagnostics, visual diagnostics,
and job errors do not appear as one readiness model. Several editor surfaces
have local dirty state without a shared close/recovery contract.

As a result, the repository can demonstrate Battle Royale gameplay, but a
non-developer cannot reliably create, validate, preserve, package, and replay a
distinct Battle Royale game end to end.

## Users

- Primary: a non-programmer or technical designer building a small Battle
  Royale game from bundled or imported assets.
- Secondary: a game developer extending the Battle Royale plugin or creating a
  future first-party game-mode plugin.
- Internal: maintainers who need reproducible diagnostics, deterministic
  packages, regression tests, and clear ownership boundaries.

## Requirements

### R1 - Guided project creation

The New Game flow offers Battle Royale as a game type, activates the required
plugin, creates a starter map, assigns safe default HUD/input/player content,
and opens a creator checklist. Every generated value remains editable.

### R2 - Unified game readiness

One diagnostics contract aggregates core project, map, catalog, references,
assets, visual models, active-mode validation, and build prerequisites. Each
problem has stable severity, code, owner/source, location, message, and an
action that navigates to or selects the affected authoring surface. Errors gate
Playtest and Build; warnings remain visible but do not silently block.

### R3 - Schema-driven object properties

Object and component properties support number, string, boolean, enum, asset
reference, entity/object reference, weapon/item/loot reference, optional and
grouped fields. Editors use appropriate controls and validated ids rather than
unlabelled raw text whenever the target domain is discoverable.

### R4 - Project-owned gameplay content

Creators can create, duplicate, edit, validate, delete, import/export, and
reference project-owned weapons, items, loot tables, and game-object types.
Plugin content supplies defaults and templates without becoming the mutable
project source of truth. Reference deletion is blocked or repaired explicitly.

### R5 - Battle Royale authoring depth

The editor exposes match format, team/solo behavior, player count, countdown,
spawn policy, starting loadout, elimination/respawn policy, shrink phases,
outside-zone damage, loot distribution, and match-end conditions supported by
the runtime. Unsupported future settings are not shown as fake controls.

### R6 - Visual, sprite, and animation workflow

Creators can assign real sprites, slice imported sheets, define and preview
animation clips, configure anchors/hitboxes/muzzle points, bind a player model,
and see missing or incompatible visual references in readiness diagnostics.
Changes are previewable from the relevant editor before playtest.

### R7 - Safe document lifecycle

All editable workspaces expose a shared document lifecycle: clean/dirty/saving/
saved/error, flush before destructive navigation, explicit discard where
needed, autosave where safe, crash recovery, and reopen persistence. A failure
never reports Saved.

### R8 - Creator checklist

The project overview shows completion state and next actions for game mode,
startup map, player model, spawns, shrink anchor, gameplay content, loot, input,
HUD, readiness, playtest, and shipping. Checklist facts derive from canonical
state and diagnostics, not from manually toggled booleans.

### R9 - Playtest

Single and local multiplayer playtest use the active game mode and authored
package. The live test proves movement, combat, loot/pickup, zone progression,
damage/elimination, and a match-ending outcome. Invalid games cannot start by
bypassing the readiness gate from another command surface.

### R10 - Ship Game

A guided flow chooses the startup map and supported target, runs readiness,
builds deterministically, shows progress and actionable errors, launches a
local packaged preview, exposes the artifact location, and supports export.
Equivalent command-palette/top-bar paths reuse the same application service.

### R11 - Plugin ownership and extensibility

Core owns generic authoring schemas, diagnostics, document lifecycle, project
content, build/playtest orchestration, and extension contracts. A game-mode
plugin owns rules, templates/defaults, validators, runtime systems, and mode
projection. Adding a bundled top-down mode must not add Battle-Royale-specific
branches to neutral core services.

### R12 - Quality and scale

Keyboard access, focus, labels, error messaging, empty states, and destructive
action confirmation meet the existing design-system standard. The 2,000-asset
project remains responsive through bounded/on-demand preview loading. No task
may regress existing editor, runtime, build, or packaged smoke suites.

## Success Criteria

- The Goal Oracle in README.md is replayed successfully in the live Electron
  app and again in the produced local artifact.
- A deliberately invalid BR map is blocked from Playtest and Build; every
  blocker can be navigated to, corrected, and removed without restarting.
- A fresh user completes the primary flow without entering a plugin id,
  weapon id, loot-table id, filesystem build command, or database value.
- Project-authored object, weapon, item, loot, visual, animation, HUD/input, and
  BR rule changes survive save, app close, and reopen.
- Single and at least two-client local multiplayer playtests use the authored
  content and reach a match-ending state.
- Ship Game produces an executable/servable local artifact and that artifact
  starts with the chosen map and authored content.
- Focused unit/integration suites, desktop typecheck/build checks, Playwright
  Electron smoke coverage, and live CDP/native evidence pass.
- The 2,000-asset regression scenario shows bounded preview resolution and no
  return to eager unbounded asset-preview IPC work.
- Independent review reports no unresolved correctness, data-loss, security,
  accessibility, or performance blocker in scope.

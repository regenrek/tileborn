# Technical Architecture

## Components

- **Core/domain:** typed ids and schemas for project content, diagnostics,
  document lifecycle, references, and runtime-map-package resolution.
- **Plugin API:** declarative game-mode settings/field schemas, validators,
  templates, checklist facts, and typed bundled renderer/authoring registration.
- **Battle Royale plugin:** BR definitions/defaults, map/rule validation, runtime
  systems, projection, and mode-specific labels/help.
- **Application services:** project-content CRUD, reference graph, readiness
  aggregation, save/recovery, playtest preflight, and ship orchestration.
- **Electron main/preload/IPC:** validated commands/events only; long-running
  scans/builds remain off the renderer/main synchronous hot path.
- **Renderer:** wizard, checklist, Problems navigation, schema forms, content and
  visual editors, playtest controls, and Ship Game UI.
- **Build/runtime:** deterministic package assembly, startup-map selection,
  artifact metadata, local preview, and executable artifact smoke path.

## Data Flow

1. Plugin templates and project-owned definitions are loaded through their
   canonical services and resolved into one effective project content registry.
2. Editors mutate project-owned state through typed application commands.
3. Persistence emits document-state events and invalidates readiness inputs.
4. Readiness aggregates core validators and the active game-mode validator into
   stable diagnostics consumed by Problems, checklist, Playtest, and Ship Game.
5. Playtest/build assemble the same validated runtime map package and effective
   content snapshot.
6. Runtime executes plugin systems and projects snapshots through the active
   mode provider; authored HUD/input/visuals consume the same package.
7. Ship Game returns artifact identity, logs, location, and preview command to
   the editor without duplicating build logic.

## Ownership Rules

- Core owns mechanisms and neutral contracts; plugins own genre semantics and
  content values.
- Project-authored content overrides or extends plugin templates but never edits
  plugin package files.
- Readiness is the only execution gate. UI surfaces may render it but may not
  reimplement validity.
- Build and playtest consume the same effective package resolution.
- Renderer registries for bundled executable code have one explicit owner and
  are not inferred from untrusted paths.

## Failure Modes

- **Invalid project/content/map:** stable actionable diagnostic; no execution.
- **Unknown or deleted reference:** block destructive deletion or expose repair
  choices; never silently substitute another definition.
- **Save failure:** retain dirty/error state and recoverable draft; never show
  Saved or close silently.
- **Plugin missing/disabled/incompatible:** explain required action and preserve
  project data.
- **Asset missing/moved/corrupt:** retain reference identity, show dependency
  sites, and support relink where safe.
- **Validator crash:** convert to owned internal diagnostic and fail closed for
  Build/Ship while preserving editor access.
- **Build/preview failure:** persist logs/artifact state, surface a problem, and
  allow retry without duplicating jobs.
- **Large libraries:** paginate/window queries and preview resolution; cancel
  stale work and avoid synchronous unbounded IPC.
- **Recovery conflict:** present timestamp/source and explicit restore/discard;
  do not overwrite a newer durable revision silently.

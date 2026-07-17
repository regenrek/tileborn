# API And Data Model

## Objects

- `GameDiagnostic`: stable id/code, severity, message, source owner, project/map/
  document/object location, optional fix/navigation action, and revision.
- `GameReadiness`: project revision, active mode, diagnostics, blocking count,
  evaluated validators, and derived `canPlaytest`/`canBuild`.
- `DocumentState`: document id/type, durable revision, draft revision, state
  (`clean|dirty|saving|saved|error|recovery`), and error/recovery metadata.
- `ProjectContentRegistry`: project-owned definitions plus resolved immutable
  plugin templates and provenance.
- `WeaponDefinition`, `ItemDefinition`, `LootTableDefinition`, and
  `GameObjectType`: typed ids, presentation/visual references, gameplay fields,
  and schema version.
- `AuthoringFieldSchema`: number/text/boolean/enum/reference/group/optional field
  with constraints, labels, help, and reference target.
- `CreatorChecklist`: derived item id, status, explanation, navigation action,
  and contributing diagnostic codes.
- `ShipRequest`, `ShipRun`, and `GameArtifact`: project/startup-map/target,
  readiness revision, progress/logs, artifact hash/location, and preview status.

## Commands

- Evaluate readiness for project/map/active mode.
- Navigate to a diagnostic target or invoke an explicitly supported fix action.
- CRUD/duplicate/import/export project content and validate reference changes.
- Save/flush/discard/recover an editor document.
- Create a game from a mode template idempotently.
- Start Single/local multiplayer playtest only against a passing readiness
  revision.
- Start/cancel/retry Ship Game and launch the produced local preview.

## Events

- Readiness evaluated/changed.
- Diagnostic added/resolved/navigation requested.
- Project content created/updated/deleted/reference-repaired.
- Document dirty/save-started/saved/save-failed/recovery-found/restored/discarded.
- Game template creation started/completed/failed.
- Playtest preflight blocked/started/completed.
- Ship run started/progressed/failed/completed and artifact preview started.

All IPC payloads are versioned and runtime-decoded at the boundary. Event names
describe domain facts rather than renderer component behavior.

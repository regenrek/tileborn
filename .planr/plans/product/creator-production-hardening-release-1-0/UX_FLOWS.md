# UX Flows

## Primary Flow

1. Launch a fresh installed/package build and choose **Create Battle Royale Game**.
2. The starter creates the canonical map, game settings, player model, spawn/loot/zone objects, and example visual plus TypeScript behaviors without hidden network work.
3. A readiness checklist shows content status with direct navigation to each missing or invalid owner.
4. The creator edits map/content/behavior, sees real icons and typed references, saves, closes, and reopens with the same durable state.
5. Playtest starts local multiplayer; runtime diagnostics link back to the exact source or visual node.
6. **Ship Game** runs preflight, displays actionable blockers, produces a versioned artifact and receipt, and offers the artifact location.
7. The copied artifact boots independently of the monorepo and serves its health/room/game flows.

## Empty States

- First launch explains the shortest successful path and offers the Battle Royale starter; it never presents an unexplained blank editor.
- Empty maps, catalogs, behaviors, and palettes offer a relevant create/import action and documentation link.
- Missing optional credentials explain which local operations remain available.

## Error States

- Invalid references, incompatible project versions, interrupted saves, rejected hot reloads, packaging failures, and missing runtime resources identify the owning subsystem and preserve the last known-good state.
- Recovery UI distinguishes unsaved draft recovery, durable project rollback, backup restore, and unsupported-version refusal.
- Ship failures keep prior artifacts intact and provide a copyable diagnostic/receipt path.
- No error flow asks the creator to delete caches or project files as the first recovery action.

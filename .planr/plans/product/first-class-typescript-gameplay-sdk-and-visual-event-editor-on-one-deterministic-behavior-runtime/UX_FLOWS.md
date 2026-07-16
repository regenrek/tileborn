# UX Flows

## Primary Flow

1. The creator opens Gameplay Logic and chooses Visual Behavior or TypeScript
   Behavior.
2. Visual mode presents an ordered WHEN / IF / DO sheet. Searchable menus are
   filtered by active mode capabilities; entity, content, and asset fields use
   typed pickers and show real icons/previews.
3. TypeScript mode opens the project source with SDK types, generated capability
   declarations, examples, diagnostics, test command, and run/debug actions.
4. Save validates references and capabilities. Playtest hot-reloads a successful
   build; failures retain the last valid runtime and surface actionable Problems.
5. During playtest the creator can inspect event payloads, state, selected branch,
   emitted actions, and pause/step/continue without exposing runtime internals.
6. Visual mode offers `Convert to TypeScript`, explains that the conversion is
   one-way, creates readable source, and switches the asset mode only after save.

## Empty States

- No behaviors: explain visual versus TypeScript choices and offer templates.
- No matching command: distinguish search mismatch from unavailable capability.
- Missing plugin capability: show the owning plugin/mode and remediation.
- No selected runtime instance: keep authoring available and explain live values.

## Error States

- Invalid field/reference highlights the exact block and opens the relevant picker.
- Compile/import errors link to source locations and keep last-known-good playtest.
- Runtime exceptions and budget exhaustion pause only the offending behavior,
  identify entity/instance and stack/block path, and enter canonical Problems.
- Deleted or incompatible contributions preserve unresolved data for repair and do
  not silently substitute another event/action.

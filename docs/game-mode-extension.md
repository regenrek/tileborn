# Game-mode extension contract

`contributes.gameModes` is the only registration path for a selectable game
mode. A runtime system by itself is not a mode. The registration links the
mode's declarative contracts by id and names any first-party executable host
capabilities explicitly.

## What the manifest owns

- `runtimeSystemId`: required simulation owner.
- `settingsFormId`: optional schema-driven settings form. This is the default
  authoring UI and needs no React code.
- `settingsPanelId`: optional panel metadata retained for navigation and
  migration; it does not select a component.
- `mapValidatorId`: optional executable validator id. It must match one exact
  `server.mapValidators` contribution; that contribution's `entry` must export
  `validateMap`. Top-level or editor entries are never inferred as fallbacks.
- `hudLayoutId`: optional declarative runtime HUD layout.
- `starter`: optional stable template metadata.
- `checklistFacts`: mode-specific creator outcomes and the readiness sources
  that prove them.
- `capabilities`: stable keys for bundled `authoring`, `renderer`, `readiness`,
  or `starter` implementations.

Third-party modes should prefer the generic settings form and generic
validator/export contracts. A bespoke panel or projector is available only to
code bundled with the desktop app and must be added to the typed registries:

- renderer panels: `apps/desktop/src/renderer/components/plugins/mode-authoring-panels.tsx`
- renderer projectors: `apps/desktop/src/renderer/lib/playtest-plugin-bridge.ts`
- main readiness/runtime policy: `apps/desktop/src/main/game-mode-host-registrations.ts`
- starter templates: `apps/desktop/src/main/game-mode-starter-registrations.ts`

Neutral editor, main-process, build, and Ship orchestration may resolve these
keys, but must not import a concrete mode package or branch on a plugin id.
Each plugin may declare at most one `gameModes` registration. Renderer
capability ids are the sole runtime lookup keys: a missing or unknown key is an
actionable playtest error, never a plugin-id alias or first-item fallback.

Project map saves publish the map, `project.json`, and `project.lock.json` as
one recoverable revision. A durable transaction journal is fsynced before any
target replacement; reopening a project either preserves the complete old
revision or rolls a partial commit forward to the complete new revision.

## Minimal future top-down declaration

This is an integration example, not an implemented Tileborne mode:

```json
{
  "contributes": {
    "gameModes": [
      {
        "_tag": "GameModeContribution",
        "id": "top-down",
        "kind": "declarative",
        "display": { "label": "Top-down Adventure" },
        "runtimeSystemId": "top-down-runtime",
        "settingsFormId": "top-down-settings-form",
        "mapValidatorId": "top-down-map-validator",
        "starter": {
          "templateId": "top-down-starter-v1",
          "label": "Top-down Starter"
        },
        "checklistFacts": [
          {
            "id": "walkable-start",
            "label": "Walkable player start",
            "sources": ["map", "game-mode"]
          }
        ],
        "capabilities": {
          "renderer": "top-down.renderer",
          "starter": "top-down.starter"
        }
      }
    ]
  }
}
```

The same manifest must also contribute the referenced runtime system, generic
settings form, and validator. Its Node entry exports `validateMap` and the
generic `exportModeData`; its runtime entry owns simulation. Only if the mode
needs a bundled Pixi projector or custom starter does the desktop add the
matching capability registration.

Example Arena is the executable non-Battle-Royale contract proof. It uses the
generic settings UI, validator and Ship exporter while registering only the
bundled renderer and starter capabilities.

## Behavior contributions

Game-mode manifests may add declarative `behaviorEntries` and
`behaviorTemplates`. Entries are typed events, conditions, or actions and name
one capability plus typed input/output metadata. Templates must list every
capability used by their WHEN, IF, and DO invocations. Registry projection is
stable regardless of plugin load order and fails closed on duplicate entry or
template ids, cross-owner capability claims, missing/wrong-kind invocations,
unknown capabilities, and omitted capabilities.

These declarations are data, not executable renderer UI. The renderer receives
the decoded effective registry and resolves safe icons and controls itself.
Native TypeScript plugins use `@tileborne/game-sdk` declaration merging for
compile-time event/action/query/capability types; an executable capability still
requires an explicit trusted host registration. Battle Royale and Example Arena
are the maintained first-party and neutral fixtures for this contract.

## Plugin-author release checklist

- Register exactly one game mode and every referenced runtime, settings, validator, HUD, and capability id in the manifest.
- Keep neutral editor/build orchestration free of concrete plugin imports and plugin-id branches.
- Provide deterministic starter output, stable migrations, readiness diagnostics with owner/deep-link metadata, and an opaque mode-data exporter.
- Test disabled, missing, malformed, and incompatible plugin states; unknown capabilities must fail actionably.
- Prove project content and selected maps survive build, copy the artifact outside the workspace, import its exported worker/room class, and execute it without source-tree paths.
- Cover keyboard access, focus, empty/error states, failed persistence, crash recovery, large asset collections, local multiplayer lifecycle, and terminal results.
- Document creator steps, runtime/hosting prerequisites, known limitations, and one reproducible end-to-end acceptance scenario.

# ADR-0027: HUD framework — layout as plugin data + shared chassis

- Status: Accepted
- Date: 2026-06-09
- Deciders: Tileborne core team
- Tags: runtime, game-client, hud, plugins, desktop, boundaries

## Context

The playtest HUD (health bar, minimap, scoreboard, kill feed, zone status,
weapon panel, …) was hardcoded in the desktop renderer: fixed widgets, fixed
positions, and battle-royale-specific world-to-HUD derivation duplicated in
the Electron main process. Tileborne is an open editor — WHICH HUD elements a
game mode shows, WHERE they sit, and HOW MANY there are must be game-mode
data, not engine code, and users must be able to rearrange everything.

ADR-0024 left "HUD widgets + neutral gameplay-event-stream contracts" open as
a sibling in this slot; ADR-0022 established the architectural pattern
(neutral chassis in `@tileborne/game-client`, contracts in
`plugin-api`/`core`, content from plugins, branding from products).

## Decision

The HUD follows the same 3-way ownership split as the menu framework:
**contracts** (neutral schemas) ⊕ **chassis** (generic renderer) ⊕
**content as data** (plugin-contributed layout), plus a 3-layer
customisation merge.

### Contract ownership

| Concern                                                                                                                                                                                   | Owner                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `HudLayout` / `HudWidgetPlacement` / `HudAnchor` schemas, `CORE_HUD_WIDGETS`, `standardHudLayout()`                                                                                       | `@tileborne/core` (`src/hud/hud-layout.ts`)                                          |
| `RuntimeHudLayout` contribution slot, `decodeHudLayout`, `resolveEffectiveHudLayout`                                                                                                      | `@tileborne/plugin-api` (`hud-layout-registry.ts`)                                   |
| HUD state wire schema (`PlaytestRuntimeHud`, `PlaytestRuntimeHudEvent`)                                                                                                                   | `@tileborne/ipc-contracts`                                                           |
| HUD chassis: `HudOverlay`, widget components for `CORE_HUD_WIDGETS`, anchor slots, drag-and-drop edit mode, `deriveHudWidgetContext`, `HudMetrics`/`HudState` view types + format helpers | `@tileborne/game-client` (`src/hud/`)                                                |
| Custom widget registration CONTRACT (`HudWidgetRegistration`, `findInvalidHudWidgetRegistrations`, `hudWidgetComponents`)                                                                 | `@tileborne/game-client` (`src/hud/hud-widget-registry.ts`)                          |
| Custom widget COMPONENTS (executable React for plugin-declared kinds)                                                                                                                     | the game-mode plugin (shipped client only, ADR-0004); composed by `apps/game-client` |
| Default HUD layout for a game mode (DATA in `tileborne-plugin.json` → `contributions.hudLayouts`) + world-to-HUD derivation (`derivePlaytestHudWorldState`)                               | the game-mode plugin (e.g. `packages/plugin-battle-royale`)                          |
| Editor integration: `PlaytestHudOverlay` wrapper (match-end Victory dialog), visual HUD editor (`useHudEditing`, `PlaytestHudEditor`), user/project persistence                           | `apps/desktop` renderer                                                              |

### 1. HUD layout is DATA (`@tileborne/core`)

A `HudLayout` is `{ id, widgets: HudWidgetPlacement[] }`; each placement is
`{ id, kind, anchor, order, enabled, offset? }`. There are nine anchors
(`top-left` … `bottom-right`). `kind` is an open branded string: the engine
ships eleven baseline kinds under `CORE_HUD_WIDGETS` (`core.LocalPlayerStatus`,
`core.TeamRoster`, `core.AliveCount`, `core.Minimap`, `core.Scoreboard`,
`core.ZoneStatus`, `core.PickupPrompt`, `core.WeaponPanel`, `core.KillFeed`,
`core.EventToast`, `core.DamageIndicator`). Custom kinds (e.g.
`arena.manaBar`) are namespaced dotted identifiers; the `core.` namespace is
engine-reserved. A kind without a registered component renders NOTHING in
play mode and a draggable placeholder chip in HUD-edit mode, so custom
placements never break the editor and stay re-anchorable there.

### 2. Plugins contribute their default HUD declaratively

Game-mode plugins declare a `RuntimeHudLayout` contribution in their manifest
(ADR-0001 declarative-first; discovered via the plugin registry, code import
only as bundled fallback):

```jsonc
// tileborne-plugin.json → contributions
"hudLayouts": [
  {
    "_tag": "DeclarativeRuntimeHudLayoutContribution",
    "id": "br-hud-layout",
    "kind": "declarative",
    "display": { "label": "Battle Royale HUD" },
    "data": {
      "id": "br-default-hud",
      "widgets": [
        { "id": "local-player", "kind": "core.LocalPlayerStatus", "anchor": "top-left", "order": 0, "enabled": true }
        // …
      ]
    }
  }
]
```

`describeGameMode` (plugin-api) surfaces the layout on the
`GameModeDescriptor` (`hudLayoutContributionId` + `hudLayout`); the desktop
IPC `GameModeView` mirrors it to the renderer.

### 3. Effective layout = plugin default ⊕ project layout ⊕ user overlay

`resolveEffectiveHudLayout` merges three layers (later layers override
matching widget ids; the desktop plugin bridge resolves this in
`resolvePlaytestPlugin`):

1. **Plugin default** — the manifest contribution (fallback:
   `standardHudLayout()`).
2. **Project layout** — persisted in the project manifest settings under the
   `hudLayout` key (`apps/desktop/src/renderer/lib/project-hud-layout.ts`);
   travels with the project.
3. **User overlay** — per-machine personal customisation in `localStorage`
   under `tileborne:hud:user-overlay:v1`
   (`apps/desktop/src/renderer/lib/playtest-user-hud.ts`).

### 4. Visual HUD editor in the playtest

The playtest viewports expose an edit mode (`useHudEditing` +
`PlaytestHudEditor`): all nine anchors become drop zones, widgets become
draggable, and the panel offers anchor select, enable/disable, reordering,
"save for me" (user overlay), "save for project" (project settings), and
reset. The overlay itself stays a pure renderer — mutations happen in the
owning editor state (`hud-layout-editing.ts` pure functions).

### 5. World-to-HUD derivation is plugin-owned (SSOT)

The plugin's runtime bundle exports `derivePlaytestHudWorldState(world,
tickCount)`; the desktop runtime host consumes it via
`createPlaytestRuntimeHudTracker(deriver)` and only adds host concerns
(event ring buffer, game-over latch). The engine contains no battle-royale
HUD gameplay logic.

### 6. Chassis lives in `@tileborne/game-client`

`HudOverlay` (anchor slots, widget registry, editing drag-and-drop, insets
per ADR-0014 `hudInsets`) is shared by the editor playtest and the shipped
game client. The desktop `PlaytestHudOverlay` is a thin wrapper that adds
the editor-owned match-end Victory dialog (modal flows are not anchored HUD
widgets — same split as ADR-0022). Boundary rules apply unchanged:
`@tileborne/game-client` imports no plugin packages and contains no brand
tokens; `@tileborne/runtime` stays React-free.

### 7. Custom widget COMPONENTS via `HudWidgetRegistration`

The HUD sibling of `MenuSectionRegistration` (ADR-0022): a registration
pairs a custom `kind` with the React component that renders it. Shipped-
runtime plugins ship executable React per ADR-0004; the app (e.g.
`apps/game-client`) composes plugin widget registrations (+ brand extras)
and passes them to `RuntimeRoot` (`hudWidgets`/`hudMetrics`/`hudLayout`/
`hudInsets`) or directly to `HudOverlay` (`customWidgets`). Rules, enforced
by `findInvalidHudWidgetRegistrations` + defensively by the chassis:

- kinds are namespaced dotted identifiers (`arena.manaBar`), no duplicates;
- the `core.` namespace cannot be claimed — engine baseline kinds always
  win, so core widgets render identically in editor and shipped client;
- the EDITOR never executes registrations (ADR-0001 declarative-only): it
  renders custom kinds as movable placeholders in HUD-edit mode.

`RuntimeRoot` mounts the HUD chassis over the canvas during `in-match`
whenever `hudMetrics` are present; the pause scrim layers above it. The
shipped client app carries the same Tailwind pipeline as the desktop editor
(`apps/game-client/src/index.css` imports the `@tileborne/ui` theme and
`@source`s the ui + game-client package sources), so chassis widgets are
styled identically on both surfaces.

## How to use it (dev guide)

- **Plugin author — ship a default HUD**: add a `hudLayouts` contribution to
  your `tileborne-plugin.json` (see §2). Stick to `CORE_HUD_WIDGETS` kinds
  for editor-rendered widgets; custom kinds are allowed and skipped by the
  editor chassis.
- **Plugin author — feed HUD data**: export `derivePlaytestHudWorldState`
  from your runtime bundle to map your ECS world to the neutral HUD state
  slice (`localPlayer`, `scoreboard`, `minimap`, `zoneStatus`, …).
- **Plugin author — program a custom widget** (shipped client): declare the
  placement in your layout (`{ "kind": "arena.manaBar", "anchor":
"bottom-left", … }`), export a `HudWidgetRegistration[]` from a client
  subpath (mirror `@tileborne/plugin-battle-royale/menu`):

```tsx
import type { HudWidgetRegistration } from '@tileborne/game-client';

export const arenaHudWidgets: readonly HudWidgetRegistration[] = [
  {
    kind: 'arena.manaBar',
    source: 'plugin',
    Component: ({ ctx }) => <ManaBar player={ctx.localPlayer} />,
  },
];
```

The app validates with `findInvalidHudWidgetRegistrations` and passes the
list to `RuntimeRoot hudWidgets={…}`. In the editor playtest the widget
shows as a movable placeholder (declarative-only there).

- **Engine dev — add a new baseline widget kind**: add the kind to
  `CORE_HUD_WIDGETS` (`packages/core/src/hud/hud-layout.ts`), implement the
  widget component and register it in `HUD_WIDGET_REGISTRY`
  (`packages/game-client/src/hud/hud-overlay.tsx`), and extend the
  `PlaytestRuntimeHud` schema in `ipc-contracts` if it needs new state.
- **Editor dev — render a HUD**: pass `metrics` (+ optional `layout`,
  `hudInsets`, `editing`, `onMoveWidget`) to `HudOverlay` from
  `@tileborne/game-client`; resolve the effective layout through
  `resolvePlaytestPlugin` / `resolveEffectiveHudLayout`, never by reading a
  single layer directly.
- **Where a HUD bug gets fixed first**: widget rendering/positioning →
  `@tileborne/game-client` chassis; wrong values → the plugin's
  `derivePlaytestHudWorldState` (singleplayer) or the multiplayer client
  mapping; merge/persistence issues → desktop `playtest-plugin-bridge` /
  `project-hud-layout` / `playtest-user-hud`.

## Options considered

- **A (chosen) — layout as core schema + plugin-api slot, chassis in
  `game-client`**: symmetric with ADR-0022; reusable by editor and shipped
  client; declarative per ADR-0001.
- **B — separate `tileborne-plugins/hud` interface plugin owning the
  chassis**: rejected; a plugin owning the neutral chassis inverts ownership
  (every game mode would depend on another plugin's React internals) and
  duplicates the ADR-0022 chassis home.
- **C — keep HUD in the desktop renderer with a config file**: rejected;
  not reusable for the shipped game client and keeps the editor as a second
  source of truth.

## Consequences

- Positive: HUD is fully user-customisable (position, count, visibility)
  with per-project and per-user persistence; plugins own their HUD content
  and world-state mapping; one chassis serves editor and shipped client.
- Positive: desktop gained a `@tileborne/game-client` dependency — the
  package is now genuinely shared, matching its ADR-0022 charter.
- Positive: plugins can ship entirely custom HUD widgets for the shipped
  client (`HudWidgetRegistration`), while the editor stays declarative-only
  and still lets users re-anchor those widgets via placeholders.
- Negative: `@tileborne/game-client` now depends on
  `@tileborne/ipc-contracts` for the HUD state schema (acceptable: it is the
  neutral wire-contract package already shared with the game host).
- Open (follow-up): the multiplayer client (`playtest-multiplayer-client.ts`)
  still maps wire snapshots to HUD state in the desktop renderer; folding
  that into the plugin's projector path is the remaining SSOT refinement.
  Free-pixel `offset` editing (beyond anchor + order) is schema-supported
  but has no editor UI yet.

## References

- Implementation: `packages/core/src/hud/hud-layout.ts`,
  `packages/plugin-api/src/hud-layout-registry.ts`,
  `packages/game-client/src/hud/`,
  `apps/desktop/src/renderer/lib/playtest-plugin-bridge.ts`,
  `apps/desktop/src/renderer/hooks/use-hud-editing.ts`,
  `packages/plugin-battle-royale/src/hud/world-state.ts`
- Related: [ADR-0001](./0001-plugin-ui-model-declarative-first.md),
  [ADR-0014](./0014-runtime-rendering-via-plugin-projector.md),
  [ADR-0022](./0022-game-menu-framework-ownership-split.md),
  [ADR-0023](./0023-genre-neutral-game-mode-contracts.md),
  [ADR-0024](./0024-gameplay-input-keybinds.md)

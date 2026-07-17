# ADR-0022: Game-menu framework + 3-way ownership split

- Status: Accepted
- Date: 2026-06-01
- Deciders: Tileborne core team
- Tags: runtime, game-client, menu, plugins, branding, boundaries

## Context

Tileborne ships **no browser game-client shell today**: `tileborne game build
--target cloudflare` produces only a game-host worker (`apps/game-host`
bundles `worker.js` + plugin runtime + assets; no client HTML/JS).
`@tileborne/runtime` is HEADLESS (ECS / loop / net / renderer; no `ui/` dir)
and must stay worker-safe — the runtime entry must not import React
(`docs/03-runtime-game-host.md` §15.1; boundary test in
`packages/boundary-tests`).

We need a game-menu system: boot splash, main menu (Play / Settings /
Credits / Quit), pause overlay, end-of-match results, plus a place for
battle-royale lobby/loadout/match-rules/private-room surfaces and for
product branding (logo / palette / copy / legal) and product-only menu
tabs (Account / Leaderboard / Profile). Per ADR-0009/0017 the engine must
stay plugin- and brand-neutral (no `petwars` / `grassland` / `erw` /
`.pwmap` tokens, no plugin-name imports). Context: plandb decision
`c-0n9y`, constraint `c-r94v`.

## Decision

The menu is a **3-way split**, with these locked product decisions:

### 1. Framework home — NEW `@tileborne/game-client` package

A new browser package `@tileborne/game-client` owns the game-client UI
shell + menu framework + baseline generic menu. `@tileborne/runtime` stays
HEADLESS / React-free / worker-safe (no React is added there). This is
Option A from `c-0n9y` (recommended over a `@tileborne/runtime/ui`
subpath, which would risk pulling React into the runtime entry bundle).

### 2. BR mode menu surfaces — built in `packages/plugin-battle-royale`

The neutral, brand-free BR surfaces (lobby/matchmaking, loadout +
model/skin select, match-rules, private-room create/join) are contributed
by the battle-royale plugin via the new menu-section contribution. Zero
branding. Shipped-runtime plugins MAY ship executable React per ADR-0004
(distinct from ADR-0001 declarative-only rule that governs the editor
renderer).

### 3. Client app — brand-NEUTRAL `apps/game-client` template

`apps/game-client` is a brand-neutral template app entry; products overlay
branding via `BrandConfig`. The game-host (`apps/game-host`) serves the
client static assets (it serves none today).

### 4. Account / Leaderboard / Profile are PRODUCT-level

Account / Leaderboard / Profile are petwars-product concerns (ADR-0017
Verification Round 1, deleted row 13), NOT Tileborne core. The engine and
plugin ship NO account/leaderboard/profile UI. The engine/plugin expose
only a generic menu **extension slot** + `BrandConfig.menuExtensions`;
products supply those tabs and their components at build time.

### Contract ownership

| Concern                                                                                            | Owner                                                                |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Generic menu framework + baseline menu + client shell                                              | `@tileborne/game-client`                                             |
| Menu slot/contribution CONTRACTS (`RuntimeMenuSection`, slot ids)                                  | `@tileborne/plugin-api` (sibling to `RuntimeLobbyPanelContribution`) |
| `BrandConfig` schema (title/logo/palette/lobbyCopy/legal/servers/assetPackId/mapId/menuExtensions) | `@tileborne/core` (Effect Schema)                                    |
| BR menu surfaces                                                                                   | `packages/plugin-battle-royale`                                      |
| Branding + product-only menu tabs                                                                  | `petwars-product` (external, via `BrandConfig`)                      |

### State machine

`boot -> menu(main) -> lobby/matchmaking -> in-match(HUD) -> results ->
menu`, with an Esc **pause** overlay over `in-match`. Named slots:
`main.primaryActions`, `main.secondaryActions`, `main.tabs`,
`settings.tabs`, `pause.actions`, `results.actions`.

### Boundary rules (ADR-0009/0017)

Engine packages (`@tileborne/game-client`, contracts) have NO plugin/brand
names or game-specific literals (no `petwars` / `erw` / `.pwmap` /
plugin-name imports). `@tileborne/runtime` stays React-free. Boundary
tests are extended to prove this.

## Architecture-ownership record

- **Runtime owner** (where it executes): the shipped browser game-client
  (`apps/game-client` mounting `@tileborne/game-client` `RuntimeRoot` over
  the Pixi canvas), served by `apps/game-host`.
- **First-fix layer** (where a menu bug is first patched): the menu state
  machine + components in `@tileborne/game-client`.
- **Canonical long-term owner**: `@tileborne/game-client` for the chassis;
  `@tileborne/plugin-api` for contracts; `@tileborne/core` for
  `BrandConfig`; `plugin-battle-royale` for BR surfaces; products for
  branding/account.
- **Competing owners that are WRONG**: `@tileborne/runtime` headless entry
  (must stay React-free), `apps/desktop` renderer (editor, not the shipped
  game), `apps/game-host` (server only), the engine owning BR/brand
  specifics (ADR-0017 neutrality), and a plugin or product owning the menu
  chassis.
- **Cleanup direction**: supersedes/feeds `t-p2-accessibility-ui-plan`
  (pause/settings/results polish) — that work is not duplicated; the
  menu-framework parent owns the chassis it builds on.

## Options considered

- **A (chosen) — new `@tileborne/game-client` package**: clean React-free
  runtime boundary; symmetric with the editor's package split.
- **B — `@tileborne/runtime/ui` subpath**: matches a spec literal but
  risks React leaking into the runtime entry bundle and complicates the
  headless/worker boundary test.
- **C — menu chassis in the plugin or product**: rejected; violates
  neutrality and prevents reuse across plugins/brands.

## Consequences

- Positive: runtime stays headless; menu chassis is reusable across
  plugins and brands; account/leaderboard stay out of OSS.
- Positive: products integrate purely through `BrandConfig` +
  `menuExtensions` + section registrations at build time.
- Negative: one more package + app to maintain; the app build must compose
  plugin + brand section registrations (executable React, statically
  bundled per ADR-0004).

## References

- plandb: decision `c-0n9y`, constraint `c-r94v`, parent `t-menu-system`
- `docs/03-runtime-game-host.md` §5 (client UX), §15.1 (React-free runtime)
- Related: [ADR-0001](./0001-plugin-ui-model-declarative-first.md),
  [ADR-0004](./0004-cloudflare-build-time-plugin-bundling.md),
  [ADR-0009](./0009-three-repo-split-private-petwars-boundary.md),
  [ADR-0017](./0017-petwars-feature-parity-roadmap.md)

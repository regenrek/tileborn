# Tileborne v0.1.0 — Live-CDP acceptance walkthrough

Human-readable script for the orchestrator. The executable runner is
[`live-cdp-walkthrough.mjs`](./live-cdp-walkthrough.mjs).

## Prerequisites

- Desktop app already running with CDP: `pnpm --filter @tileborne/desktop dev:cdp`
- CDP HTTP endpoint reachable at `http://127.0.0.1:9323` (override with `TILEBORNE_CDP_URL`)
- Do **not** restart the dev server as part of this walkthrough

## Done-definition source

`docs/01-spec.md` has no dedicated **Done definition** section. Bullets below are
derived from:

1. **`t-v0-finale`** — final live-CDP acceptance criteria (polished editor, sample
   pack, map gen, BR install, 2-player local miniflare match, zone shrink, kills,
   win-screen, zero stubs/placeholders/console errors)
2. **`t-p4-e2e`** — local E2E composite (clean boot, sample pack, map generate, BR
   plugin, multiplayer host/join, BR loop, CLI §12 sweep themes, no stubs)
3. **Refined v0.1.0 scope** — local-first, no stubs, polished UI, real BR loop (no
   deploy/publish steps)

Each numbered step maps to one Done-definition bullet. Screenshots land in
`.refs/v0.1.0-walkthrough/NN-name.png`.

## Run

```bash
node scripts/live-cdp-walkthrough.mjs
```

Exit code is **0** only if every step passes. The runner stops on the first failure,
prints `PASS`/`FAIL` per step, and saves a screenshot after each step attempt.

Optional env:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TILEBORNE_CDP_URL` | `http://127.0.0.1:9323` | CDP discovery base URL |
| `WALKTHROUGH_BR_TIMEOUT_MS` | `300000` | Max wait for BR loop (step 8) |
| `WALKTHROUGH_STEP_TIMEOUT_MS` | `60000` | Default per-step wait |

---

## Step 01 — Boot check

**Done bullet:** Contributor reaches a working, polished editor shell with no renderer
console errors.

1. Connect CDP to the primary Tileborne renderer page (`type: page`, not DevTools).
2. Assert `#root` has child nodes.
3. Assert home hero (`h1` text **Tileborne**) is visible.
4. Assert no `console.error` or uncaught page errors were collected since connect.

**Screenshot:** `01-boot-check.png`

---

## Step 02 — Project create

**Done bullet:** Project lifecycle works from the home surface (create → persist →
recents).

1. On home, click **Create project**.
2. Fill **Project name** (runner uses a timestamped `CDP Walkthrough …` name).
3. Submit (**Create project** / `[data-testid="create-project-submit"]`).
4. Assert navigation to `/projects/:id` and the project appears under **Recent
   projects** (or **All projects**).

**Screenshot:** `02-project-create.png`

---

## Step 03 — Asset pack (sample fixture)

**Done bullet:** Bundled sample CC0 pack imports and renders real tile imagery.

1. Open **Asset library** (`/projects/:id/assets`).
2. Click **Import sample tileset**.
3. Wait for import job completion and pack card
   `[data-testid="asset-pack-card-pack:660e8400-e29b-41d4-a716-446655440010"]`.
4. Assert `[data-testid="asset-pack-preview-thumb"]` image has non-zero layout box.

**Screenshot:** `03-asset-pack.png`

---

## Step 04 — Map generate

**Done bullet:** Procedural map generation (⌘G) produces a persisted map and opens the
editor viewport.

1. Return to the project (sidebar **Maps** or project overview).
2. Open **Generate map** dialog (`⌘G` / top-bar **Generate Map**).
3. Choose a preset (**Dungeon rooms** / `dungeon`).
4. Submit **Generate** (`[data-testid="generate-map-submit"]`).
5. Assert dialog closes, sidebar map list (`[data-testid="sidebar-map-list"]`) is
   non-empty, and map editor canvas is visible.

**Screenshot:** `04-map-generate.png`

---

## Step 05 — Plugin install (Battle Royale)

**Done bullet:** In-tree Battle Royale plugin installs from **Bundled** and shows
**Enabled** status.

1. Open **Plugin manager** (`/projects/:id/plugins`).
2. In **Bundled plugins**, click **Install** on Battle Royale
   (`[data-testid="install-battle-royale-manager"]`).
3. Assert toast **Battle Royale plugin installed**.
4. Assert lifecycle badge text **Enabled** (and **Installed**).

**Screenshot:** `05-plugin-install-br.png`

---

## Step 06 — Playtest (single)

**Done bullet:** Single-player playtest runs the real plugin runtime (non-zero ticks,
players, fresh plugin events).

1. Open the generated map in the editor.
2. **Playtest menu** → **Single (local-only)**.
3. Assert `[data-testid="playtest-viewport"]` visible.
4. Poll `[data-testid="playtest-runtime-status"]` until:
   - `tickCount > 0` (matches `Tick N`)
   - `playerCount > 0` (matches `Players: N`)
   - `lastPluginEvent` matches `onInit` or `onTick:<n>` and is not stale (`onTick:0`
     only briefly).
5. Stop playtest (**Stop playtest** / Esc confirm) before multiplayer.

**Screenshot:** `06-playtest-single.png`

---

## Step 07 — Playtest (multiplayer host)

**Done bullet:** Local miniflare host surfaces room + WS URLs; second client joins and
both viewports render players.

1. **Playtest menu** → **Host (multiplayer local)**.
2. Assert `[data-testid="playtest-host-dialog"]` with non-empty
   `[data-testid="playtest-host-room-url"]` and `[data-testid="playtest-host-ws-url"]`.
3. Click **Open second client** (`[data-testid="playtest-host-open-second-client"]`).
4. Connect CDP to the new renderer target; wait for auto-join via `joinBase`/`joinRoom`
   search params.
5. On the host window, click **Join as host**.
6. Assert both windows show `[data-testid="playtest-multiplayer-viewport"]` with
   `[data-testid="playtest-multiplayer-player-count"]` reporting `≥ 1` player.

**Screenshot:** `07-playtest-multiplayer-host.png` (primary window)

---

## Step 08 — BR loop

**Done bullet:** Real BR gameplay — zone shrink, eliminations, match completion with a
winner.

1. With both clients live, poll (up to `WALKTHROUGH_BR_TIMEOUT_MS`):
   - **Zone shrink:** multiplayer store `sessionState.zone.radius` decreases from its
     initial snapshot (dev import of `playtest-multiplayer-store`; fallback: zone status
     text transitions toward **Zone shrinking**).
   - **Kills:** multiplayer player marker count or snapshot player count drops below the
     starting value.
   - **GameOver / winner:** exactly one player marker remains, or `[data-testid="playtest-win-dialog"]` appears if HUD path is active.
2. Record the surviving player id / winner name when detectable.

**Screenshot:** `08-br-loop.png`

---

## Step 09 — Stop hosting

**Done bullet:** Multiplayer host teardown cleans up UI chrome.

1. On the host window, click **Stop hosting** (`[data-testid="playtest-stop-hosting"]`
   or host dialog **Stop hosting**).
2. Assert `[data-testid="playtest-local-host-pill"]` is absent.
3. Close/disconnect secondary CDP target.

**Screenshot:** `09-stop-hosting.png`

---

## Step 10 — Theme + shortcuts

**Done bullet:** Polished global UX — theme toggle and command palette.

1. Navigate to **Settings** (`/settings`).
2. Select **Dark** theme; assert `document.documentElement` has class `dark`.
3. Dispatch `⌘K` / `Ctrl+K`; assert command palette dialog/input is visible.

**Screenshot:** `10-theme-shortcuts.png`

---

## Step 11 — Bottom drawer tabs

**Done bullet:** Bottom drawer exposes Jobs, Logs, Problems, Playtest, Runtime with
real content or empty-state CTAs.

1. Open a project map editor route.
2. Open bottom drawer (store flag or command palette **Toggle bottom drawer**).
3. For each tab (**Jobs**, **Logs**, **Problems**, **Playtest**, **Runtime**):
   - Activate tab (`⌘1` … `⌘5` or tab trigger click).
   - Assert panel renders either list/content **or** dashed empty-state card (title +
     description; optional CTA button).

**Screenshot:** `11-bottom-drawer.png`

---

## Step 12 — No stub / not-implemented DOM text

**Done bullet:** Zero user-visible stub or placeholder strings in the live UI.

1. Walk primary renderer DOM (`document.body.innerText`).
2. Fail if case-insensitive `/not implemented|stub/` matches anywhere.

**Screenshot:** `12-no-stub-text.png`

---

## Orchestrator notes

- Step order is intentional: single playtest validates plugin runtime before
  multiplayer; BR loop runs while the local host is up; hosting stops before settings
  polish checks.
- Step 8 may take several minutes with default BR zone timing (`waitSec: 60`). Increase
  `WALKTHROUGH_BR_TIMEOUT_MS` if the orchestrator times out early.
- Syntax-check only (no live CDP execution in CI for this file):

  ```bash
  node --check scripts/live-cdp-walkthrough.mjs
  ```

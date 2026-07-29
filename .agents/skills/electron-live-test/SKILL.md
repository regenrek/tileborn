---
name: electron-live-test
description: Verify Tileborne Electron UI, renderer, Pixi/canvas, gameplay, input, or native-window behavior through the real running app. Use for live UI testing, CDP inspection, visual gameplay checks, Electron driving, screenshots/OCR, console or network diagnosis, and before adding tests for user-visible behavior.
---

# Tileborne Electron Live Verification

Treat the running Electron app as the primary source of truth for user-visible
behavior. Keep the verification bounded to one affected operating path.

## Workflow

1. State the exact user flow and visible expected result.
2. Confirm whether the user-managed Electron CDP session is already running.
   Do not start or restart it. If it is unavailable, ask the user to run:

   ```sh
   pnpm --filter @tileborne/desktop dev:cdp
   ```

3. Observe the affected flow once before editing when the issue is
   reproducible.
4. Use the narrowest suitable live tool:
   - `chrome-devtools-tileborn` for the renderer, React/DOM state,
     source-mapped console errors, network requests, and performance traces.
   - `native-devtools` for native window chrome, OS dialogs, screenshot/OCR,
     and visual targeting inside Pixi/canvas.
   - `playwright` only when an existing repeatable Electron smoke path is the
     relevant acceptance path or the user explicitly requests automation.
5. Make the smallest implementation change that addresses the observed
   behavior.
6. Repeat the same flow once. Visually confirm the expected result and inspect
   only the relevant console or network surface for new errors.
7. Stop and report the flow checked, what changed visibly, and any remaining
   limitation.

## Limits

- Follow the verification budget in the repository `AGENTS.md`.
- Do not create a test, fixture, metric, debug export, counter, event ledger,
  screenshot suite, or proof artifact merely to verify a visual result.
- Do not replace a visual check with a DOM, event-count, snapshot, or headless
  surrogate.
- If one existing automated check is useful, target a single file. For an
  existing Electron smoke file, use:

  ```sh
  pnpm --filter @tileborne/desktop test:electron-smoke -- <smoke-file>
  ```

- Do not run the full `test:electron-smoke`, `test:desktop-smoke`, `test:all`,
  root `pnpm test`, or release gates for ordinary live UI verification.
- After one informed fix, a repeated failure should produce a concise blocker
  report, not another open-ended repair/test loop.

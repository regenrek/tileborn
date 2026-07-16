# Battle Royale creator 1.0 release evidence

Status: **creator/gameplay release oracle and self-contained Forge production package proven**.

Evidence classes are intentionally separate: `current automated`, `prior live Electron`, and `fresh live Electron`. Automated artifact execution must never be reported as fresh UI evidence.

## Acceptance matrix

| Release clause | Status | Evidence |
| --- | --- | --- |
| Fresh no-CLI New Game, starter, save/reopen, recovery | Prior live Electron | Planr `log-86034029` (5/5) and `log-9feb02bc` (6/6) |
| Invalid readiness, blocked action, deep-link correction, valid Single | Prior live Electron | `log-b84c1a00` |
| Real labeled content, authored rules/weapon, Single runtime | Prior live Electron | `log-5a442560` |
| Real visual import, slicing, clips, geometry, reload, playtest | Prior live Electron | `log-eae9ddd5`; keyboard/paging `log-f08ea0fa` |
| Dirty cancel/save, failed-save close block, relaunch recovery | Prior live Electron | `log-86034029`, `log-9feb02bc` |
| Ship parity, selected startup map, copied artifact boot/join | Prior live Electron + current automated | `log-62e22d68`; `packages/cli/src/ship-pipeline.integration.test.ts` |
| Real exported `PlaytestRoom`, authored map/content, two clients, terminal results | Current automated | Focused CLI integration test; copied artifact contains `Creator Health Flask`, Ada and Grace reach active/reconnect/finished, and both appear in durable results |
| 2,000-asset bounded rendering and on-demand previews | Prior live + automated | `log-ace6e0e6` (14/14), IPC batching `log-8d7c867d` |
| Keyboard, focus, destructive, empty/error behavior | Prior live + automated | `log-f08ea0fa`; Sprite Studio radiogroup, document lifecycle, readiness gate, Problems, content failure-preservation tests |
| Crash-safe map/project/lock persistence and exact-owner recovery | Current automated | `log-0c8e12a0`, `log-a9d787b4`; 16 transaction tests and 117 services-app tests |
| Plugin-neutral Example Arena and BR regression | Prior live Electron + automated | `log-53eabbf2`; copied Example artifact `log-2eca69db` |
| Fresh live Electron local multiplayer with two actual UI clients through outcome | **Fresh live Electron pass** | Room `lobby-FTKM9B`: two visible renderer pages explicitly ready 2/2, reached active tick 59, and froze at the first authoritative `GameOver` on tick 160. Guest rendered **Defeat** and host rendered **Victory**, both naming Player 2. Authoritative reads while both clients remained visible returned lobby `finished`, durable results with player-1 placement 2 / player-2 placement 1, and playtest metrics `finished`, tick 160, two connected clients, zero queued inputs. Guest **Back** then showed `Left multiplayer room`; `/results` remained 200 and unchanged, proving a participant cannot stop the owner-hosted room. Receipts: `/tmp/tileborne-br-ftkm9b-guest-active.png`, `/tmp/tileborne-br-ftkm9b-guest-defeat.png`, `/tmp/tileborne-br-ftkm9b-host-victory.png`. |
| Full Electron Forge package completion and isolated boot | **Current packaged-app pass** | Authorized root `pnpm build` completed 23/23 tasks. Forge deployed a lockfile-derived 29-package runtime closure and produced the arm64 macOS `.app`. The canonical packaged smoke copied that fresh app outside the workspace, launched `CFBundleExecutable` with isolated home/user-data, reached a visible packaged renderer with `window.tileborne`, resolved `esbuild` and `miniflare` only under `Contents/Resources`, found no escaping runtime symlinks or live workspace `require`s, and exited cleanly (2/2). Planr: `log-3b61814d`, `log-ddcc1214`. |

## Current automated commands

The release run records exact exit status in Planr. Required gates are:

```sh
pnpm --filter @tileborne/cli exec vitest run --config vitest.config.ts src/ship-pipeline.integration.test.ts
pnpm --filter @tileborne/desktop test
pnpm --filter @tileborne/services-app test
pnpm --filter @tileborne/services-build test
pnpm --filter @tileborne/game-host test
pnpm --filter @tileborne/plugin-battle-royale test
pnpm test:boundaries
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @tileborne/desktop test:packaged-smoke
git diff --check
```

Local-listen integration tests require permission to bind Miniflare to `127.0.0.1`. All waits in the copied-artifact lifecycle are bounded so a denied listen, stalled socket, poll, alarm, or shutdown fails with a named timeout.

## Production package proof

The Forge package is now verified as a self-contained runtime artifact. The successful root build completed all 23 tasks, the package hook deployed the 29-package binary-backed runtime closure, and the 2/2 copied-app smoke proved that the fresh `.app` starts independently of the repository and reaches a visible renderer. This packaged-app proof remains separate from the fresh two-client gameplay receipt above; neither is substituted for the other.

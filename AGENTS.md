<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `pnpm dlx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Live Electron Testing

- When the user asks for live browser testing, live UI verification, Electron app driving, native desktop automation, MCP browser control, screenshots/OCR, or CDP interaction, load the project skill `.cursor/skills/electron-live-test/SKILL.md` and follow it.
- Prefer Chrome DevTools MCP for Tileborne's Electron renderer and React shell when CDP inspection, console/network debugging, source-mapped renderer stacks, or performance traces are needed. Use Playwright Electron smoke tests for repeatable verification. Keep native-devtools-mcp for native window chrome, OS dialogs, screenshot/OCR, Pixi/canvas visual targeting, or Android/native coverage that Chrome DevTools MCP and Playwright do not cover.
- On this machine, the Codex MCP server names are `chrome-devtools-tileborn`, `playwright`, and `native-devtools`.
- The dev server is assumed to be user-managed. Do not start or restart it unless the user explicitly asks; if CDP is needed, ask the user to run `pnpm --filter @tileborne/desktop dev:cdp` or confirm that it is already running.

## Licensing

- Public OSS packages and apps use `"license": "MIT"` with the single root [`LICENSE`](./LICENSE) file (no per-package copy).
- Private workspace tools (`@tileborne/boundary-tests`, `@tileborne/test-fixtures`) use `"private": true` and `"license": "UNLICENSED"`.
- CC0 sample fixtures live under `packages/test-fixtures/fixtures/` with per-directory `PROVENANCE.md`.

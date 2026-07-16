# QA Acceptance Tests

## Acceptance

1. **Integration receipt:** before/after git inventories prove every original change was committed, intentionally ignored as reproducible output, retained as user work, or documented; final candidate tree is clean.
2. **Canonical Planr:** source plans remain auditable, stale duplicate Working Palette product plans are archived, current plan checks, and its build map has no orphan acceptance criteria.
3. **Hermetic baseline:** fresh checkout/install runs typecheck, lint, full tests, builds, boundaries, docs, CLI e2e, game-host smoke, desktop smoke, packaged smoke, and clean-checkout smoke.
4. **Compatibility/recovery:** legacy fixtures migrate with verified backups; current fixtures no-op; future/corrupt fixtures fail without mutation; injected crashes restore old or complete new state.
5. **Creator experience:** fresh profile completes starter -> author -> readiness repair -> save/reopen -> multiplayer playtest -> diagnostics -> Ship using keyboard-accessible flows.
6. **Performance:** 2,000+ asset and large-reference fixtures meet approved budgets; IPC preview/reference hydration remains bounded/on-demand; save/reopen/playtest/package measurements are recorded.
7. **Artifact:** desktop package boots from its packaged location; shipped game copied to an isolated external cwd starts and passes health, room creation, summary/results, and representative behavior execution.
8. **Release matrix:** each OS/arch, signer/notarizer, updater, crash reporter, deploy, and publication step is proven or explicitly blocks/limits release.

## Regression

- Root workspace: frozen install, typecheck, lint, tests, build, boundaries, formatting check, docs build.
- Desktop: renderer/unit, Electron goal oracle, Ship Game, packaged runtime closure, accessibility, clean profile.
- Runtime/game-host: behavior isolation/budgets, room lifecycle/recovery, bundled worker verification, local Miniflare/CLI ship pipeline.
- Security: path containment, import/nondeterminism restrictions, secret scan, artifact tamper checks, journal/backup corruption.
- Performance: stable representative fixtures with deterministic count/size budgets plus trace-backed native latency evidence.

## Manual Scenarios

- macOS install/launch/open/save/reopen/playtest/Ship, quit during save/build, relaunch/recover, artifact copy and boot.
- Native platform install/update/uninstall smoke for every claimed platform.
- Offline first run and missing-credential behavior.
- Keyboard-only onboarding, readiness repair, behavior authoring, recovery, and shipping.
- Review diagnostic export for privacy and actionable language.

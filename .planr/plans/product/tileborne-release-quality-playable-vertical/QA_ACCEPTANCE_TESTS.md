# QA Acceptance Tests

## Acceptance

- Five fresh generated-map starts: eight distinct safe spawns, zero involuntary damage
  for three seconds, valid zone, no collision/hazard overlap.
- Native Electron: movement, continuous pointer aim, three shots, reload, pickup,
  damage, elimination, pause/resume, factual results, lobby, redeploy, and stop.
- Browser game client repeats the same canonical control/combat/session path.
- Visual review at normal zoom confirms readable terrain, character, weapon, projectile,
  pickup, hazard, zone, HUD, and elimination layers with no unrelated sprite stacking.
- Audio review confirms distinct movement/weapon/impact/damage/pickup/zone/UI cues and
  independent music/SFX controls without repetitive clipping or false event feedback.
- Keyboard-only flow and remapping cover start, play, pause, results, redeploy, and exit;
  color-independent status communication and reduced effects are verified.
- Three consecutive runs produce no relevant console errors and Stop leaves no session.

## Regression

- Reuse existing canonical suites for core coordinates/input, services-build assembly,
  BR spawn/combat/projector, game-client shell/HUD, and desktop IPC/session ownership.
- Add at most one focused regression in the owning suite per durable bug invariant;
  do not create parallel end-to-end suites or proof-only production hooks.

## Manual Scenarios

- Fresh default project with no editor expertise.
- `map-fix-check` and `petwars3` restored projects that reproduced the 2026-08-01 failures.
- 1440×900 Electron with real keyboard/mouse, normal and reduced-effects settings.
- Character/weapon/tileset variants at actual camera zoom, including dense combat.

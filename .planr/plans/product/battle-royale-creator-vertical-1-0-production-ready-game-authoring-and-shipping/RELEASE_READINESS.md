# Release Readiness

## Packaging

- Desktop development and packaged builds pass.
- Ship Game artifact is deterministic for identical project inputs.
- Startup map, active mode, project content, assets, visual models, HUD/input and
  rules are present in the produced package.
- Artifact launches locally and reaches the authored BR match.
- License/provenance output covers bundled and imported sample assets where the
  existing product contract requires it.

## Documentation

- Fresh-user Battle Royale creator guide.
- Readiness/problem resolution guide.
- Object, weapon, item, loot, visual and animation authoring reference.
- Save/recovery and Ship Game behavior.
- First-party game-mode extension guide with Example Arena/top-down example.
- Known limits clearly separate local creator 1.0 from cloud/matchmaking scope.

## Verification

- Every TASK item has Planr log evidence and all created review items are closed.
- Focused and workspace-level checks are green or an explicit owner-approved
  exclusion is recorded before completion.
- Goal Oracle is captured in live Electron and executed artifact evidence.
- Fresh-profile, persistence/recovery, two-client multiplayer, accessibility and
  2,000-asset performance evidence is present.
- No open in-scope approval, blocking diagnostic, or unresolved review finding.
- `planr plan audit pln-059cc827 --json` returns `holds: true`.

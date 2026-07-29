# QA Acceptance Tests

## Acceptance

- Generate map -> package -> runtime proves distributed placements and valid zone.
- Title/lobby ticks are frozen and HP unchanged until Start Match.
- Native pointer changes aim; native left click creates an aimed projectile.
- WASD local presentation changes within one frame and reconciles without visible snap.
- Escape freezes local ticks; resume restarts; stop/project switch leaves zero running sessions.
- Crosshair is centered and overlay controls remain usable.
- Each accepted shot emits one fire event and one matching audio/VFX trigger.

## Regression

- Existing map editor placement, BR simulation, multiplayer snapshot interpolation,
  remappable controls, HUD editing, build package, and game-host tests stay green.

## Manual Scenarios

- Electron playtest at 1440x900 with real mouse and keyboard.
- Browser game client on localhost using the Browser plugin.
- Three-shot magazine, reload, movement+aim, pause/resume, results, and project switch.

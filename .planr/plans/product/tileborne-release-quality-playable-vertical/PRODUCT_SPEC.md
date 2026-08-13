# Product Specification

## Problem

Tileborne can open a generated map and start a local Battle Royale runtime, but the
result is not presently a playable game by contemporary standards. In four live
Electron runs across `map-fix-check` and `petwars3` on 2026-08-01, players spawned
on or inside hazardous/oversized props, lost health at tick 9, and in one map died
within roughly 10–12 seconds without a fair combat opportunity. Characters,
weapons, crates, hazards, and terrain used incompatible visual scales; the camera
could follow but the world was not readable. Five repeated renderer-capability
errors appeared across playtest mounts. Results contained headings but no useful
placement or combat outcome, and both Redeploy and Lobby terminated the entire
playtest session. These failures prevent meaningful judgment of movement, aim,
weapon feel, balance, or fun.

Against current benchmarks, the gap is material: top-down action is expected to
be immediately legible, responsive, tactically fair, and reinforced by coherent
animation, impact VFX, sound, HUD, and accessible controls.

## Users

- A creator generating their first Tileborne game and expecting the default to be genuinely playable.
- A keyboard-and-mouse player evaluating the Battle Royale vertical.
- An engine/plugin developer using the vertical as a neutral runtime quality oracle.

## Observed Critic Findings

### P0 — blocks playability

- Unsafe deterministic opening: environment traps apply damage-over-time, slow,
  and stun almost immediately after Start Match; safe spawn clearance is not upheld.
- Runtime scene composition is not readable: sprite/prop/world scale and overlap
  obscure the avatar, threats, pickups, collision boundaries, and aiming context.
- `capabilities.renderer` is declared by the bundled plugin but reaches the map
  playtest as undefined on repeated mounts, producing five console errors.
- Movement, pointer aim, fire, reload, hit confirmation, and weapon cadence cannot
  be fairly evaluated while the avatar starts disabled/damaged inside scene clutter.

### P1 — blocks a credible vertical

- Match results contain no placement/elimination/survival facts.
- Redeploy and Lobby both stop the complete playtest instead of preserving the
  expected match/session distinction.
- HUD hierarchy competes with the canvas; status effects appear as raw technical
  labels and controls/results lack meaningful state communication.
- The Maltipoo sprite, weapons, props, terrain, colored debug-like circles, grid,
  and overlays do not form one art direction or consistent world scale.
- No observable authored feedback stack establishes weapon identity: anticipation,
  muzzle flash, projectile/tracer, impact, damage reaction, elimination, sound,
  and restrained camera response must agree with authoritative events.
- The default flow begins behind 15 readiness warnings without explaining which
  are safe for playtest and which invalidate visual/gameplay quality.

### P2 — release-quality completeness

- Controls need an in-context reminder and full remapping/keyboard-only coverage.
- Critical state must not rely on color alone; reduced flash/shake and independent
  music/SFX controls are required.
- The vertical needs stable frame pacing, clean console output, coherent audio,
  readable animation states, and a short replayable match cadence.

## Requirements

- A fresh generated map reserves hazard-, collision-, and opponent-free spawn
  safety space. No player takes environmental damage before deliberate movement
  into a telegraphed hazard.
- Authoring pixels convert to runtime tiles exactly once. Runtime positions,
  collision, camera, minimap, projectile math, sprite footprint, and VFX radius
  share an explicit unit/scale contract.
- Active game-mode discovery exposes the declared renderer capability before the
  viewport mounts; missing capability is a visible blocking state, never repeated
  console noise with a half-mounted runtime.
- WASD/directional movement responds within one displayed frame locally; camera
  following is smooth and preserves spatial orientation. Pointer aim is continuous,
  click fires toward the cursor, reload and ammo are truthful, and pause freezes
  local simulation.
- Combat feedback originates from accepted gameplay events and combines readable
  animation, muzzle/impact/damage/elimination VFX, coherent sound, and restrained
  screen response. Input rejection never produces false feedback.
- One 2D visual bible defines pixels-per-world-unit, character footprint, weapon
  attachment, prop footprint, anchor/pivot, layer order, palette, outline/value
  contrast, animation timing, VFX scale, shadow, and UI icon rules.
- Results report placement, eliminations, damage/survival summary, and match end
  reason. Redeploy starts a fresh match within the current playtest; Lobby returns
  to the current playtest lobby; only Stop exits the playtest session.
- The first-run flow communicates controls, objective, safe deployment, pickups,
  zone pressure, damage, and death without requiring editor knowledge.
- All core gameplay is keyboard-accessible and remappable; important information
  uses shape/text/audio in addition to color; reduced-effects and separate audio
  controls are available.

## Success Criteria

- Five consecutive fresh-map solo runs start with eight distinct valid spawns and
  no involuntary player damage for the first three seconds.
- A player can complete movement, 360-degree aim, three shots, reload, pickup,
  damage, elimination, pause/resume, results, lobby, redeploy, and stop flows.
- The local avatar and every threat/pickup remain identifiable at normal play zoom;
  no generated opening composition visually stacks unrelated full-size sprites.
- Results contain real match facts, Redeploy/Lobby preserve session semantics, and
  Stop leaves zero live sessions.
- No relevant renderer/main console errors occur through three consecutive runs.
- Live Electron verification confirms responsive controls and coherent visual/audio
  feedback; one closest existing automated check protects each durable invariant.

## Users

## Requirements

## Success Criteria

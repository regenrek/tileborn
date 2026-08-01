# Design System

## Principles

- Gameplay silhouette and threat readability outrank decorative density.
- One world scale governs terrain, characters, props, hitboxes, effects, and camera.
- Cute character art can coexist with lethal combat, but proportions and feedback
  must be deliberate rather than a collage of full-size source sprites.
- Feedback is layered, short, event-backed, and never hides the next decision.

## Components

- Visual bible with pixels-per-world-unit, anchors, footprints, layers, palette,
  outlines, shadows, animation cadence, weapon sockets, and VFX size limits.
- Authored terrain tileset with clear walkable/non-walkable language and landmarks.
- Character set with idle, eight/four-direction locomotion as chosen, attack/fire,
  reload, hit, down/elimination, and optional interaction states.
- Weapon set with consistent grip/attachment, muzzle origin, projectile/tracer,
  impact, ammo icon, and rarity treatment.
- Hazard, pickup, crate, barrier, zone, and spawn telegraphs with distinct silhouettes.
- HUD hierarchy: local health/armor, weapon/ammo, objective/zone, minimap, event feed,
  contextual pickup prompt, and concise status effects outside the aiming field.

## Accessibility

- Text/icon/shape reinforce all color semantics; contrast is checked at play scale.
- Full input remapping and keyboard-only navigation cover every core action.
- Reduced flashes, reduced camera shake, scalable HUD/text, and separate music/SFX controls.
- Focus order and visible focus remain intact across title, lobby, pause, results, and settings.

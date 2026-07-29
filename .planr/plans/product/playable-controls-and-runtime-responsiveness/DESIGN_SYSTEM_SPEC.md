# Design System

## Principles

- Gameplay canvas is the primary interaction surface while in match.
- Runtime overlays are pointer-transparent except for visible interactive controls.
- Feedback represents accepted gameplay events, not speculative button presses.

## Components

- Centered, pointer-transparent crosshair.
- Compact in-match status/End Match control that does not cover the canvas.
- Existing HUD widgets with collision-free anchor placement.

## Accessibility

- Keyboard fire remains remappable and usable without a mouse.
- Pause, resume, and end-match controls retain semantic buttons and focus order.
- Crosshair is decorative; weapon state remains available as text in the HUD.

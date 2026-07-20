# Design System

## Principles

Creator controls should be labeled, schema-driven, previewable, reversible, and
consistent with existing editor surfaces. The game shell separates project brand
tokens from accessible interaction semantics.

## Components

- Screen tree, shell canvas/preview, property inspector, action/event picker.
- Asset/font/audio pickers with real previews and license badges.
- Focus-order overlay and keyboard/gamepad device preview.
- Deployment target cards, plan diff, progress/log viewer, health receipt, destructive cleanup confirmation.

## Accessibility

- WCAG-oriented contrast and readable type defaults; imported themes surface warnings/errors.
- Full keyboard/gamepad navigation, visible focus, semantic control roles, trapped modal focus, announced async status.
- Reduced-motion preference and no audio-only communication of important state.

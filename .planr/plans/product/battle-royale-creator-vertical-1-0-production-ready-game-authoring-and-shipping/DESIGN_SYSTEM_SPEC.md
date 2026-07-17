# Design System

## Principles

- Show game meaning, labels and real visuals before internal identifiers.
- Make readiness and save state visible, specific and trustworthy.
- Use progressive disclosure: beginner-safe defaults with advanced values nearby.
- Keep the same interaction grammar across map, content, visual and rule editors.
- Never represent missing content with a generic template that appears valid.

## Components

- Typed field controls and reference picker with thumbnail, label and provenance.
- Diagnostic row/group, severity badge, location breadcrumb and Fix/Open action.
- Creator checklist item with derived state and primary next action.
- Document-state indicator and Save/Discard/Recovery dialogs.
- Content definition browser/editor with template/project badges.
- Visual asset card, usage/dependency list and relink state.
- Ship stepper, build progress/log panel and artifact result card.

## Accessibility

- Full keyboard path and visible focus for every primary flow.
- Labels/help/error associations for all fields; no color-only status.
- Announced async save, readiness and build status without excessive chatter.
- Dialog focus trap/restore and safe destructive-action defaults.
- Minimum target size/contrast consistent with the existing UI standard.
- Canvas-only information has equivalent inspector/status text where practical.

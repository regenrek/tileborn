# Design System

## Principles

- Progressive disclosure: a first successful game requires few choices; advanced SDK and release details remain inspectable.
- Ownership-visible diagnostics: status, error, and recovery copy names the object and subsystem responsible.
- Real content representation: use asset/plugin icons or previews, with deterministic fallbacks only when media is unavailable.
- Safe operations are reversible or explicitly confirmed; destructive actions are never implied by generic cleanup wording.

## Components

- Release/readiness checklist with grouped blockers, warnings, passed checks, owner, and navigate/fix actions.
- Version compatibility and recovery dialog with source version, target version, backup path, preview, and cancel.
- Ship preflight/progress/result surfaces with stable job identifiers and artifact receipts.
- Performance feedback shown only when a budget is exceeded, including operation, measured value, budget, and trace link.
- First-run starter cards and contextual empty states using existing Tileborne shell, iconography, focus, and problem-panel patterns.

## Accessibility

- All readiness, recovery, onboarding, and shipping flows are keyboard complete and expose semantic names/status through accessibility APIs.
- Focus moves to the first actionable blocker after failed preflight and returns predictably after dialogs close.
- Status never relies on color alone; progress respects reduced motion; error text remains copyable.
- Live Electron verification covers keyboard navigation and representative screen-reader labels.

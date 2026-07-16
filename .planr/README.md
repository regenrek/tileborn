# Planr repository state

Tileborne versions the stable, reviewable Planr surface:

- `plans/` contains product and build contracts.
- `project/` contains repository ownership, flow, and quality constraints.
- `reviews/` contains the archived review receipts captured for the release
  integration baseline.
- `.claude/agents/` and `.codex/agents/` contain the matching worker and
  reviewer profiles.

`planr.sqlite` is intentionally local runtime state. Picks, heartbeats, logs,
and reviews mutate it during normal work, so committing it would make a clean
product branch non-reproducible. Newly generated `reviews/*.review.md` files
are projections of that live state and are ignored after the archived baseline;
existing tracked receipts remain versioned. No ignored Planr file is deleted by
the release workflow.

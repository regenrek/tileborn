# Release Readiness

## Packaging

No publication in this plan. A packaged candidate is not credible until the live vertical passes.

## Documentation

- Record the visual bible, controls, accessibility options, gameplay loop, and known limits.
- Update accepted ADRs only where implementation proves the proposed decisions.

## Verification

- All P0/P1 acceptance flows pass live in Electron and the browser client.
- Closest owning checks are green; no broad duplicate test infrastructure is added.
- Independent game-feel/art/readability review has no blocking finding.
- Clean checkout can build the same playable vertical without local cache dependence.

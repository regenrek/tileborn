# ADR-0009: Three-repo split and private Petwars boundary

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: repositories, oss, petwars, governance

## Context

Tileborne is an OSS editor/runtime platform. Petwars is a private commercial product built on top. Architecture invariant #7 forbids `petwars`, `grassland`, `erw:`, and `open-editor` tokens in OSS packages after migration. The spec defines three repositories: `tileborne/` (monorepo), `tileborne-plugins/` (OSS plugins), and `petwars/` (private branding, assets, maps, deploy).

## Decision

Adopt a **three-repo split**:

| Repo                  | Visibility    | Contains                                                          |
| --------------------- | ------------- | ----------------------------------------------------------------- |
| **tileborne**         | OSS (MIT TBD) | Core packages, desktop app, game-host template, docs              |
| **tileborne-plugins** | OSS           | Battle-royale, RPG, plugin test harness                           |
| **petwars**           | Private       | Branding, proprietary assets/maps, Wrangler/Alchemy deploy config |

OSS code never imports private repos. Petwars consumes Tileborne via npm/workspace versions and injects branding at build/deploy time. CI boundary tests enforce token and import leaks.

## Options considered

- **A — Monorepo with private subfolder**: Simple locally; risks accidental OSS publication of proprietary assets.
- **B — Petwars as a plugin only**: Insufficient—brand deploy config and proprietary assets need a home outside OSS.
- **C (chosen) — Three-repo split with build-time injection**: Clean OSS boundary; matches Cloudflare deploy flow in spec §14.

## Consequences

- Positive: OSS release (Phase 9) can ship without scrubbing proprietary content.
- Positive: Plugin ecosystem (`tileborne-plugins`) stays reusable across brands.
- Negative: Cross-repo versioning and release coordination required (engine semver, plugin `engineRange`).
- Follow-up: Complete package rename from `@petwars/open-editor-*` to `@tileborne/*`; retire legacy Svelte editor after parity (Phase 8).

## References

- `docs/01-spec.md` §2 (repositories), §14–§15 (deploy, migration phases)
- `docs/03-runtime-game-host.md` §1 (brand vs runtime)
- Related: [ADR-0004](./0004-cloudflare-build-time-plugin-bundling.md), [ADR-0005](./0005-asset-import-trust-license-model.md)
